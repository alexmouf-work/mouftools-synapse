-- =====================================================================================================================
-- SYNAPSE (synapse.mouftools.com): Multiplayer rooms
-- =====================================================================================================================
-- One Supabase project serves every Mouftools product. Each product keeps its own objects under its own name prefix, so
-- products never collide and one can be removed without touching the others. Everything in this file belongs to
-- Synapse and is named synapse_*:
--   tables     synapse_rooms, synapse_players
--   functions  synapse_open_room, synapse_join_room, synapse_leave_room, synapse_remove_player, synapse_room_state,
--              synapse_submit_brain, synapse_start_race, synapse_race_entries, synapse_submit_result
--              (helpers: synapse_hash, synapse_ms, synapse_name)
--   cron job   synapse-purge
-- Another product adds its own file with its own prefix (for example `<product>_`) and never edits these objects.
--
-- HOW TO RUN: paste the whole file into the Supabase dashboard's SQL editor and Run. It is idempotent: running it again,
-- on an empty project or on one that already has any earlier version of Synapse's objects, leaves the same result
-- and no errors. It never drops or changes anything that isn't Synapse's.
--
-- What it holds: rooms with 4-letter codes, up to 100 players each, every player's brain, and each race's frozen
-- entries, so every client re-runs the same race.
--
-- Security: the browser holds only the anon key. Row-level security is on for both tables, with no policies and no
-- table grants for anon, so the tables can't be read or written directly. Everything goes through the functions
-- below (security definer), which check the room code and a per-player secret token. Only the token's SHA-256 is
-- stored. No function lists rooms, so a room is reachable only by its code. Synapse doesn't use the service role key.
--
-- Retention (privacy policy: "deleted within 30 days"): a daily pg_cron job deletes rooms older than 30 days, and
-- their players, brains, entries and results with them.
-- =====================================================================================================================

-- Extensions are shared by the whole project; "if not exists" leaves any already enabled where they are. On Supabase
-- pgcrypto lives in the `extensions` schema, so the functions below search `public, extensions`.
create extension if not exists pgcrypto;
create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Earlier versions of this file used unprefixed names (public.rooms, public.players, open_room, ...). Remove those,
--    but only if they are recognisably Synapse's: the table must have Synapse's columns. Nothing else is touched.
-- ---------------------------------------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'rooms' and column_name = 'host_hash')
     and exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'rooms' and column_name = 'race_seed') then
    drop function if exists public.create_room(text, text);
    drop function if exists public.open_room(text);
    drop function if exists public.join_room(text, text, text);
    drop function if exists public.leave_room(uuid, text);
    drop function if exists public.remove_player(text, text, uuid);
    drop function if exists public.room_state(text);
    drop function if exists public.submit_brain(uuid, text, text);
    drop function if exists public.start_race(text, text);
    drop function if exists public.race_entries(text, integer);
    drop function if exists public.submit_result(uuid, text, text);
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'players' and column_name = 'token_hash') then
      drop table public.players;
    end if;
    drop table public.rooms;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Tables. "if not exists", then "add column if not exists", so an older Synapse table gains any new column.
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.synapse_rooms (
  code text primary key check (code ~ '^[A-Z]{4}$'),
  host_hash text not null,
  created_at timestamptz not null default now()
);
alter table public.synapse_rooms add column if not exists race_no integer not null default 0;
alter table public.synapse_rooms add column if not exists race_seed bigint;
alter table public.synapse_rooms add column if not exists start_at timestamptz;
-- the race's entries, frozen when the host starts it: a JSON array of {id, name, brain} in join order
alter table public.synapse_rooms add column if not exists entries text;
comment on table public.synapse_rooms is 'Synapse (synapse.mouftools.com): Multiplayer rooms. Deleted after 30 days.';

create table if not exists public.synapse_players (
  id uuid primary key default gen_random_uuid(),
  room text not null references public.synapse_rooms (code) on delete cascade,
  name text not null check (char_length(name) between 1 and 16),
  token_hash text not null,
  joined_at timestamptz not null default clock_timestamp()
);
-- the canonical genome JSON, exactly as the client wrote it (text, not jsonb, so every client parses the same bits)
alter table public.synapse_players add column if not exists brain text check (brain is null or char_length(brain) <= 32000);
alter table public.synapse_players add column if not exists result text check (result is null or char_length(result) <= 1000);
create index if not exists synapse_players_room on public.synapse_players (room, joined_at, id);
comment on table public.synapse_players is 'Synapse (synapse.mouftools.com): players in a Multiplayer room. Deleted with the room.';

alter table public.synapse_rooms enable row level security;
alter table public.synapse_players enable row level security;
revoke all on public.synapse_rooms, public.synapse_players from anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Functions ("create or replace": re-running updates them in place).
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.synapse_hash(t text) returns text
  language sql immutable set search_path = public, extensions as $$ select encode(digest(t, 'sha256'), 'hex') $$;

create or replace function public.synapse_ms(t timestamptz) returns bigint
  language sql immutable as $$ select (extract(epoch from t) * 1000)::bigint $$;

-- A room's name rule: spaces collapsed and trimmed, 1–16 characters, unique in the room ignoring case.
create or replace function public.synapse_name(n text) returns text
  language sql immutable as $$ select btrim(regexp_replace(coalesce(n, ''), '\s+', ' ', 'g')) $$;

-- Open a room (a fresh code, no players yet); its host joins it next with the same token.
create or replace function public.synapse_open_room(p_token text) returns json
  language plpgsql security definer set search_path = public, extensions as $$
declare c text;
begin
  if char_length(p_token) < 32 then raise exception 'token'; end if;
  loop
    c := (select string_agg(chr(65 + floor(random() * 26)::int), '') from generate_series(1, 4));
    begin
      insert into synapse_rooms (code, host_hash) values (c, synapse_hash(p_token));
      exit;
    exception when unique_violation then -- taken: draw another
    end;
  end loop;
  return json_build_object('code', c, 'now', synapse_ms(now()));
end $$;

-- Join a room by its code (up to 100 players; a name nobody in the room has, ignoring case).
create or replace function public.synapse_join_room(p_code text, p_name text, p_token text) returns json
  language plpgsql security definer set search_path = public, extensions as $$
declare pid uuid; n text := synapse_name(p_name);
begin
  if char_length(p_token) < 32 then raise exception 'token'; end if;
  if char_length(n) not between 1 and 16 then raise exception 'name'; end if;
  perform 1 from synapse_rooms where code = upper(p_code) for update;
  if not found then raise exception 'no such room'; end if;
  if (select count(*) from synapse_players where room = upper(p_code)) >= 100 then raise exception 'room full'; end if;
  if exists (select 1 from synapse_players where room = upper(p_code) and lower(name) = lower(n)) then raise exception 'name taken'; end if;
  insert into synapse_players (room, name, token_hash) values (upper(p_code), n, synapse_hash(p_token)) returning id into pid;
  return json_build_object('code', upper(p_code), 'player', pid, 'name', n, 'now', synapse_ms(now()));
end $$;

-- Leave the room (your name is free again).
create or replace function public.synapse_leave_room(p_player uuid, p_token text) returns void
  language plpgsql security definer set search_path = public, extensions as $$
begin
  delete from synapse_players where id = p_player and token_hash = synapse_hash(p_token);
end $$;

-- The host removes another player from the room.
create or replace function public.synapse_remove_player(p_code text, p_token text, p_player uuid) returns void
  language plpgsql security definer set search_path = public, extensions as $$
begin
  perform 1 from synapse_rooms where code = upper(p_code) and host_hash = synapse_hash(p_token);
  if not found then raise exception 'not the host'; end if;
  delete from synapse_players where id = p_player and room = upper(p_code) and token_hash <> synapse_hash(p_token);
end $$;

-- The room as the lobby shows it: players in join order, whether each has a brain in and which is the host; the
-- current race.
create or replace function public.synapse_room_state(p_code text) returns json
  language sql security definer set search_path = public, extensions as $$
  select json_build_object(
    'code', r.code, 'race_no', r.race_no, 'race_seed', r.race_seed, 'start_at', synapse_ms(r.start_at), 'now', synapse_ms(now()),
    'players', coalesce((select json_agg(json_build_object('id', p.id, 'name', p.name, 'ready', p.brain is not null, 'host', p.token_hash = r.host_hash) order by p.joined_at, p.id)
                         from synapse_players p where p.room = r.code), '[]'::json))
  from synapse_rooms r where r.code = upper(p_code) $$;

-- Hand in (or replace) your brain for the next race.
create or replace function public.synapse_submit_brain(p_player uuid, p_token text, p_brain text) returns void
  language plpgsql security definer set search_path = public, extensions as $$
begin
  update synapse_players set brain = p_brain where id = p_player and token_hash = synapse_hash(p_token);
  if not found then raise exception 'not your player'; end if;
end $$;

-- The host starts a race: a new seed, Go 12 s from now, and the entries frozen (every player with a brain in).
create or replace function public.synapse_start_race(p_code text, p_token text) returns json
  language plpgsql security definer set search_path = public, extensions as $$
declare r synapse_rooms;
begin
  update synapse_rooms set race_no = race_no + 1, race_seed = floor(random() * 4294967296)::bigint, start_at = now() + interval '12 seconds',
    entries = (select coalesce(json_agg(json_build_object('id', p.id, 'name', p.name, 'brain', p.brain) order by p.joined_at, p.id), '[]'::json)::text
               from synapse_players p where p.room = synapse_rooms.code and p.brain is not null)
  where code = upper(p_code) and host_hash = synapse_hash(p_token) returning * into r;
  if not found then raise exception 'not the host'; end if;
  return json_build_object('race_no', r.race_no, 'race_seed', r.race_seed, 'start_at', synapse_ms(r.start_at), 'now', synapse_ms(now()));
end $$;

-- A race's frozen entries (only the current race's).
create or replace function public.synapse_race_entries(p_code text, p_race_no integer) returns text
  language sql security definer set search_path = public, extensions as $$
  select entries from synapse_rooms where code = upper(p_code) and race_no = p_race_no $$;

-- Your result in the last race (place, time, distance), as the privacy policy says.
create or replace function public.synapse_submit_result(p_player uuid, p_token text, p_result text) returns void
  language plpgsql security definer set search_path = public, extensions as $$
begin
  update synapse_players set result = p_result where id = p_player and token_hash = synapse_hash(p_token);
  if not found then raise exception 'not your player'; end if;
end $$;

-- Only the nine room functions are callable from the browser (anon); the helpers are not.
revoke all on function public.synapse_hash(text), public.synapse_ms(timestamptz), public.synapse_name(text) from public, anon, authenticated;
revoke all on function public.synapse_open_room(text), public.synapse_join_room(text, text, text),
  public.synapse_leave_room(uuid, text), public.synapse_remove_player(text, text, uuid), public.synapse_room_state(text),
  public.synapse_submit_brain(uuid, text, text), public.synapse_start_race(text, text),
  public.synapse_race_entries(text, integer), public.synapse_submit_result(uuid, text, text) from public, authenticated;
grant execute on function public.synapse_open_room(text), public.synapse_join_room(text, text, text),
  public.synapse_leave_room(uuid, text), public.synapse_remove_player(text, text, uuid), public.synapse_room_state(text),
  public.synapse_submit_brain(uuid, text, text), public.synapse_start_race(text, text),
  public.synapse_race_entries(text, integer), public.synapse_submit_result(uuid, text, text) to anon;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Delete match data within 30 days: every day at 03:17 UTC, rooms older than 30 days (players cascade). The job is
--    replaced, not duplicated, when this file runs again.
-- ---------------------------------------------------------------------------------------------------------------------
select cron.unschedule(jobid) from cron.job where jobname = 'synapse-purge';
select cron.schedule('synapse-purge', '17 3 * * *', $$delete from public.synapse_rooms where created_at < now() - interval '30 days'$$);
