-- Synapse Multiplayer (B8, B9 lobby): rooms with 4-letter codes, up to 100 players, every player's brain, and each race's
-- frozen entries so every client re-runs the same race. Run this once in the Supabase dashboard (SQL editor) of the
-- project whose URL and anon key are SUPABASE_PROJECT_URL and SUPABASE_ANON_KEY in Vercel. It is safe to run again.
--
-- Security: the browser holds only the anon key. Row-level security is on for both tables with no policies and no
-- table grants for anon, so the tables can't be read or written directly; everything goes through the functions
-- below (security definer), which check the room code and a per-player secret token (only its SHA-256 is stored).
-- No function lists rooms, so a room is reachable only by its code. The service role key is not used by Synapse.
--
-- Retention (privacy policy: "deleted within 30 days"): a daily pg_cron job deletes rooms older than 30 days, and
-- their players, brains, entries and results with them.

create extension if not exists pgcrypto;
create extension if not exists pg_cron;

create table if not exists public.rooms (
  code text primary key check (code ~ '^[A-Z]{4}$'),
  host_hash text not null,
  created_at timestamptz not null default now(),
  race_no integer not null default 0,
  race_seed bigint,
  start_at timestamptz,
  -- the race's entries, frozen when the host starts it: a JSON array of {id, name, brain} in join order
  entries text
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  room text not null references public.rooms (code) on delete cascade,
  name text not null check (char_length(name) between 1 and 16),
  token_hash text not null,
  -- the canonical genome JSON, exactly as the client wrote it (text, not jsonb, so every client parses the same bits)
  brain text check (brain is null or char_length(brain) <= 32000),
  result text check (result is null or char_length(result) <= 1000),
  joined_at timestamptz not null default clock_timestamp()
);
create index if not exists players_room on public.players (room, joined_at, id);

alter table public.rooms enable row level security;
alter table public.players enable row level security;
revoke all on public.rooms, public.players from anon, authenticated;

create or replace function public.synapse_hash(t text) returns text
  language sql immutable as $$ select encode(digest(t, 'sha256'), 'hex') $$;

create or replace function public.synapse_ms(t timestamptz) returns bigint
  language sql immutable as $$ select (extract(epoch from t) * 1000)::bigint $$;

-- A room's name rule (B9): spaces collapsed and trimmed, 1–16 characters, unique in the room ignoring case.
create or replace function public.synapse_name(n text) returns text
  language sql immutable as $$ select btrim(regexp_replace(coalesce(n, ''), '\s+', ' ', 'g')) $$;

-- B9: a room is opened before its host picks a name (the name screen shows the code), so create_room is gone.
drop function if exists public.create_room(text, text);

-- Open a room (a fresh code, no players yet); its host joins it next with the same token.
create or replace function public.open_room(p_token text) returns json
  language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if char_length(p_token) < 32 then raise exception 'token'; end if;
  loop
    c := (select string_agg(chr(65 + floor(random() * 26)::int), '') from generate_series(1, 4));
    begin
      insert into rooms (code, host_hash) values (c, synapse_hash(p_token));
      exit;
    exception when unique_violation then -- taken: draw another
    end;
  end loop;
  return json_build_object('code', c, 'now', synapse_ms(now()));
end $$;

-- Join a room by its code (up to 100 players; a name nobody in the room has, ignoring case).
create or replace function public.join_room(p_code text, p_name text, p_token text) returns json
  language plpgsql security definer set search_path = public as $$
declare pid uuid; n text := synapse_name(p_name);
begin
  if char_length(p_token) < 32 then raise exception 'token'; end if;
  if char_length(n) not between 1 and 16 then raise exception 'name'; end if;
  perform 1 from rooms where code = upper(p_code) for update;
  if not found then raise exception 'no such room'; end if;
  if (select count(*) from players where room = upper(p_code)) >= 100 then raise exception 'room full'; end if;
  if exists (select 1 from players where room = upper(p_code) and lower(name) = lower(n)) then raise exception 'name taken'; end if;
  insert into players (room, name, token_hash) values (upper(p_code), n, synapse_hash(p_token)) returning id into pid;
  return json_build_object('code', upper(p_code), 'player', pid, 'name', n, 'now', synapse_ms(now()));
end $$;

-- Leave the room (your name is free again).
create or replace function public.leave_room(p_player uuid, p_token text) returns void
  language plpgsql security definer set search_path = public as $$
begin
  delete from players where id = p_player and token_hash = synapse_hash(p_token);
end $$;

-- The host removes another player from the room.
create or replace function public.remove_player(p_code text, p_token text, p_player uuid) returns void
  language plpgsql security definer set search_path = public as $$
begin
  perform 1 from rooms where code = upper(p_code) and host_hash = synapse_hash(p_token);
  if not found then raise exception 'not the host'; end if;
  delete from players where id = p_player and room = upper(p_code) and token_hash <> synapse_hash(p_token);
end $$;

-- The room as the lobby shows it: players in join order, whether each has a brain in and which is the host; the
-- current race.
create or replace function public.room_state(p_code text) returns json
  language sql security definer set search_path = public as $$
  select json_build_object(
    'code', r.code, 'race_no', r.race_no, 'race_seed', r.race_seed, 'start_at', synapse_ms(r.start_at), 'now', synapse_ms(now()),
    'players', coalesce((select json_agg(json_build_object('id', p.id, 'name', p.name, 'ready', p.brain is not null, 'host', p.token_hash = r.host_hash) order by p.joined_at, p.id)
                         from players p where p.room = r.code), '[]'::json))
  from rooms r where r.code = upper(p_code) $$;

-- Hand in (or replace) your brain for the next race.
create or replace function public.submit_brain(p_player uuid, p_token text, p_brain text) returns void
  language plpgsql security definer set search_path = public as $$
begin
  update players set brain = p_brain where id = p_player and token_hash = synapse_hash(p_token);
  if not found then raise exception 'not your player'; end if;
end $$;

-- The host starts a race: a new seed, Go 12 s from now, and the entries frozen (every player with a brain in).
create or replace function public.start_race(p_code text, p_token text) returns json
  language plpgsql security definer set search_path = public as $$
declare r rooms;
begin
  update rooms set race_no = race_no + 1, race_seed = floor(random() * 4294967296)::bigint, start_at = now() + interval '12 seconds',
    entries = (select coalesce(json_agg(json_build_object('id', p.id, 'name', p.name, 'brain', p.brain) order by p.joined_at, p.id), '[]'::json)::text
               from players p where p.room = rooms.code and p.brain is not null)
  where code = upper(p_code) and host_hash = synapse_hash(p_token) returning * into r;
  if not found then raise exception 'not the host'; end if;
  return json_build_object('race_no', r.race_no, 'race_seed', r.race_seed, 'start_at', synapse_ms(r.start_at), 'now', synapse_ms(now()));
end $$;

-- A race's frozen entries (only the current race's).
create or replace function public.race_entries(p_code text, p_race_no integer) returns text
  language sql security definer set search_path = public as $$
  select entries from rooms where code = upper(p_code) and race_no = p_race_no $$;

-- Your result in the last race (place, time, distance), as the privacy policy says.
create or replace function public.submit_result(p_player uuid, p_token text, p_result text) returns void
  language plpgsql security definer set search_path = public as $$
begin
  update players set result = p_result where id = p_player and token_hash = synapse_hash(p_token);
  if not found then raise exception 'not your player'; end if;
end $$;

revoke all on function public.open_room(text), public.join_room(text, text, text), public.leave_room(uuid, text),
  public.remove_player(text, text, uuid), public.room_state(text), public.submit_brain(uuid, text, text),
  public.start_race(text, text), public.race_entries(text, integer), public.submit_result(uuid, text, text) from public;
grant execute on function public.open_room(text), public.join_room(text, text, text), public.leave_room(uuid, text),
  public.remove_player(text, text, uuid), public.room_state(text), public.submit_brain(uuid, text, text),
  public.start_race(text, text), public.race_entries(text, integer), public.submit_result(uuid, text, text) to anon;

-- Delete match data within 30 days: every day at 03:17 UTC, rooms older than 30 days (players cascade).
select cron.unschedule(jobid) from cron.job where jobname = 'synapse-purge';
select cron.schedule('synapse-purge', '17 3 * * *', $$delete from public.rooms where created_at < now() - interval '30 days'$$);
