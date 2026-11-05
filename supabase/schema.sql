-- =====================================================================================================================
-- SYNAPSE (synapse.mouftools.com): Multiplayer rooms
-- =====================================================================================================================
-- One Supabase project serves every Mouftools product. Each product keeps its own objects under its own name prefix, so
-- products never collide and one can be removed without touching the others. Everything in this file belongs to
-- Synapse and is named synapse_*:
--   tables     synapse_rooms, synapse_players, synapse_round_brains, synapse_round_entries
--   functions  synapse_open_room, synapse_join_room, synapse_leave_room, synapse_remove_player, synapse_room_state,
--              synapse_start_match, synapse_submit_round_brain, synapse_round_entries, synapse_submit_result,
--              synapse_submit_brain, synapse_start_race, synapse_race_entries (the single race before timed rounds,
--              kept while a deployed build still calls them)
--              (helpers: synapse_hash, synapse_ms, synapse_name, synapse_round_start, synapse_round_freeze,
--              synapse_match_over)
--   cron job   synapse-purge
-- Another product adds its own file with its own prefix (for example `<product>_`) and never edits these objects.
--
-- HOW TO RUN: paste the whole file into the Supabase dashboard's SQL editor and Run. It is idempotent: running it again,
-- on an empty project or on one that already has any earlier version of Synapse's objects, leaves the same result
-- and no errors. It never drops or changes anything that isn't Synapse's.
--
-- What it holds: rooms with 4-letter codes, up to 100 players each, and the room's match: 5 timed rounds that start
-- when the host starts the match, every phase at a fixed time after that on the server's clock. Each round, every
-- player's brain for that round, and the round's entries, frozen as its race's countdown begins, so every client
-- re-runs the same race.
--
-- Security: the browser holds only the anon key. Row-level security is on for every table, with no policies and no
-- table grants for anon, so the tables can't be read or written directly. Everything goes through the functions
-- below (security definer), which check the room code and a per-player secret token. Only the token's SHA-256 is
-- stored. No function lists rooms, so a room is reachable only by its code. Synapse doesn't use the service role key.
--
-- Retention (privacy policy: "deleted within 30 days"): a daily pg_cron job deletes rooms older than 30 days, and
-- their players, brains, round brains, entries and results with them.
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

-- The match (match-flow v2 plan §M2): its number in the room, its seed (each round's race track) and when the host
-- started it (round 1's build; every later phase follows at fixed times, synapse_round_start / synapse_round_freeze).
alter table public.synapse_rooms add column if not exists match_no integer not null default 0;
alter table public.synapse_rooms add column if not exists match_seed bigint;
alter table public.synapse_rooms add column if not exists match_at timestamptz;

-- Each player's brain for a round of the room's match (the canonical genome JSON, as the client wrote it). A player
-- who leaves takes theirs with them until the round's entries are frozen.
create table if not exists public.synapse_round_brains (
  room text not null references public.synapse_rooms (code) on delete cascade,
  match_no integer not null,
  round integer not null check (round between 1 and 5),
  player uuid not null references public.synapse_players (id) on delete cascade,
  brain text not null check (char_length(brain) <= 32000),
  at timestamptz not null default clock_timestamp(),
  primary key (room, match_no, round, player)
);
comment on table public.synapse_round_brains is 'Synapse (synapse.mouftools.com): brains handed in for a round of a Multiplayer match. Deleted with the room.';

-- A round's entries, frozen as its race's countdown begins: a JSON array of {id, name, brain} in join order. Written
-- once, by the first request after the freeze time, and never changed.
create table if not exists public.synapse_round_entries (
  room text not null references public.synapse_rooms (code) on delete cascade,
  match_no integer not null,
  round integer not null check (round between 1 and 5),
  entries text not null,
  frozen_at timestamptz not null default clock_timestamp(),
  primary key (room, match_no, round)
);
comment on table public.synapse_round_entries is 'Synapse (synapse.mouftools.com): a Multiplayer round''s frozen entries. Deleted with the room.';

alter table public.synapse_rooms enable row level security;
alter table public.synapse_players enable row level security;
alter table public.synapse_round_brains enable row level security;
alter table public.synapse_round_entries enable row level security;
revoke all on public.synapse_rooms, public.synapse_players, public.synapse_round_brains, public.synapse_round_entries from anon, authenticated;

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

-- The match's schedule (src/common/schedule.ts has the same numbers; tests/unit/schedule.test.ts checks them):
-- round n's build starts at match_at plus the earlier rounds' lengths. A round is its build (60 s in round 1, then
-- 20 s), then 67.5 s: train 20, hand in 3, the race's countdown 5, the race 30, the cars hold 1.5, standings 8.
create or replace function public.synapse_round_start(p_at timestamptz, p_round integer) returns timestamptz
  language sql immutable as $$
  select p_at + make_interval(secs => coalesce((select sum(b + 67.5) from unnest(array[60,20,20,20,20]) with ordinality as u(b, k)
                                                where k < p_round), 0)::double precision) $$;

-- Round n's entries freeze as its race's countdown begins: its build, then 23 s (train 20, hand in 3).
create or replace function public.synapse_round_freeze(p_at timestamptz, p_round integer) returns timestamptz
  language sql immutable as $$
  select public.synapse_round_start(p_at, p_round) + make_interval(secs => ((array[60,20,20,20,20])[p_round] + 23)::double precision) $$;

-- The match is over once round 5's race has been run: its freeze, then 36.5 s (countdown 5, race 30, hold 1.5).
create or replace function public.synapse_match_over(p_at timestamptz) returns timestamptz
  language sql immutable as $$ select public.synapse_round_freeze(p_at, 5) + make_interval(secs => 36.5) $$;

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
declare pid uuid; joined timestamptz; n text := synapse_name(p_name);
begin
  if char_length(p_token) < 32 then raise exception 'token'; end if;
  if char_length(n) not between 1 and 16 then raise exception 'name'; end if;
  perform 1 from synapse_rooms where code = upper(p_code) for update;
  if not found then raise exception 'no such room'; end if;
  if (select count(*) from synapse_players where room = upper(p_code)) >= 100 then raise exception 'room full'; end if;
  if exists (select 1 from synapse_players where room = upper(p_code) and lower(name) = lower(n)) then raise exception 'name taken'; end if;
  insert into synapse_players (room, name, token_hash) values (upper(p_code), n, synapse_hash(p_token)) returning id, joined_at into pid, joined;
  -- when you joined: a match already under way is yours from the next round's build
  return json_build_object('code', upper(p_code), 'player', pid, 'name', n, 'joined', synapse_ms(joined), 'now', synapse_ms(now()));
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

-- The room as the lobby shows it: players in join order (with when each joined), whether each has a brain in and which
-- is the host; the current match (and the single race of earlier builds).
create or replace function public.synapse_room_state(p_code text) returns json
  language sql security definer set search_path = public, extensions as $$
  select json_build_object(
    'code', r.code, 'race_no', r.race_no, 'race_seed', r.race_seed, 'start_at', synapse_ms(r.start_at),
    'match_no', r.match_no, 'match_seed', r.match_seed, 'match_at', synapse_ms(r.match_at), 'now', synapse_ms(now()),
    'players', coalesce((select json_agg(json_build_object('id', p.id, 'name', p.name, 'ready', p.brain is not null, 'host', p.token_hash = r.host_hash,
                                                           'joined', synapse_ms(p.joined_at)) order by p.joined_at, p.id)
                         from synapse_players p where p.room = r.code), '[]'::json))
  from synapse_rooms r where r.code = upper(p_code) $$;

-- The host starts a match: a new number and seed, round 1's build from now. Not while one is still being raced.
-- The room's earlier matches' brains and entries go.
create or replace function public.synapse_start_match(p_code text, p_token text) returns json
  language plpgsql security definer set search_path = public, extensions as $$
declare r synapse_rooms;
begin
  select * into r from synapse_rooms where code = upper(p_code) and host_hash = synapse_hash(p_token) for update;
  if not found then raise exception 'not the host'; end if;
  if r.match_at is not null and clock_timestamp() < synapse_match_over(r.match_at) then raise exception 'match on'; end if;
  delete from synapse_round_brains where room = r.code;
  delete from synapse_round_entries where room = r.code;
  update synapse_rooms set match_no = match_no + 1, match_seed = floor(random() * 4294967296)::bigint, match_at = now()
    where code = r.code returning * into r;
  return json_build_object('match_no', r.match_no, 'match_seed', r.match_seed, 'match_at', synapse_ms(r.match_at), 'now', synapse_ms(now()));
end $$;

-- Hand in (or replace) your brain for a round of the match: from that round's build until its entries freeze, and
-- only for a round you were in the room for from its build. The room's row is locked, so a brain is either in before
-- the freeze or refused.
create or replace function public.synapse_submit_round_brain(p_player uuid, p_token text, p_match_no integer, p_round integer, p_brain text) returns void
  language plpgsql security definer set search_path = public, extensions as $$
declare p synapse_players; r synapse_rooms;
begin
  select * into p from synapse_players where id = p_player and token_hash = synapse_hash(p_token);
  if not found then raise exception 'not your player'; end if;
  select * into r from synapse_rooms where code = p.room for update;
  if r.match_at is null or r.match_no <> p_match_no or p_round is null or p_round not between 1 and 5 then raise exception 'no such round'; end if;
  if p.joined_at > synapse_round_start(r.match_at, p_round) then raise exception 'not in this round'; end if;
  if clock_timestamp() < synapse_round_start(r.match_at, p_round) then raise exception 'too early'; end if;
  if clock_timestamp() >= synapse_round_freeze(r.match_at, p_round) then raise exception 'too late'; end if;
  if p_brain is null or char_length(p_brain) > 32000 then raise exception 'brain'; end if;
  insert into synapse_round_brains (room, match_no, round, player, brain) values (r.code, p_match_no, p_round, p.id, p_brain)
    on conflict (room, match_no, round, player) do update set brain = excluded.brain, at = clock_timestamp();
end $$;

-- A round's entries: null until its freeze time; then the brains in at that moment, in join order, frozen by the first
-- request (under the room's lock, so a late brain can't slip in) and the same for every client after.
create or replace function public.synapse_round_entries(p_code text, p_match_no integer, p_round integer) returns text
  language plpgsql security definer set search_path = public, extensions as $$
declare r synapse_rooms; e text;
begin
  select entries into e from synapse_round_entries where room = upper(p_code) and match_no = p_match_no and round = p_round;
  if found then return e; end if;
  select * into r from synapse_rooms where code = upper(p_code) for update;
  if not found or r.match_at is null or r.match_no <> p_match_no or p_round is null or p_round not between 1 and 5
     or clock_timestamp() < synapse_round_freeze(r.match_at, p_round) then return null; end if;
  select entries into e from synapse_round_entries where room = r.code and match_no = p_match_no and round = p_round;
  if found then return e; end if;
  e := (select coalesce(json_agg(json_build_object('id', p.id, 'name', p.name, 'brain', b.brain) order by p.joined_at, p.id), '[]'::json)::text
        from synapse_round_brains b join synapse_players p on p.id = b.player
        where b.room = r.code and b.match_no = p_match_no and b.round = p_round);
  insert into synapse_round_entries (room, match_no, round, entries) values (r.code, p_match_no, p_round, e);
  return e;
end $$;

-- Hand in (or replace) your brain for the next race (the single race of earlier builds).
create or replace function public.synapse_submit_brain(p_player uuid, p_token text, p_brain text) returns void
  language plpgsql security definer set search_path = public, extensions as $$
begin
  update synapse_players set brain = p_brain where id = p_player and token_hash = synapse_hash(p_token);
  if not found then raise exception 'not your player'; end if;
end $$;

-- The host starts a race (earlier builds): a new seed, Go 12 s from now, and the entries frozen (every player with a brain in).
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

-- Your result in the last race or round (place, time, distance), as the privacy policy says.
create or replace function public.synapse_submit_result(p_player uuid, p_token text, p_result text) returns void
  language plpgsql security definer set search_path = public, extensions as $$
begin
  update synapse_players set result = p_result where id = p_player and token_hash = synapse_hash(p_token);
  if not found then raise exception 'not your player'; end if;
end $$;

-- Only the twelve room functions are callable from the browser (anon); the helpers are not.
revoke all on function public.synapse_hash(text), public.synapse_ms(timestamptz), public.synapse_name(text),
  public.synapse_round_start(timestamptz, integer), public.synapse_round_freeze(timestamptz, integer),
  public.synapse_match_over(timestamptz) from public, anon, authenticated;
revoke all on function public.synapse_open_room(text), public.synapse_join_room(text, text, text),
  public.synapse_leave_room(uuid, text), public.synapse_remove_player(text, text, uuid), public.synapse_room_state(text),
  public.synapse_start_match(text, text), public.synapse_submit_round_brain(uuid, text, integer, integer, text),
  public.synapse_round_entries(text, integer, integer),
  public.synapse_submit_brain(uuid, text, text), public.synapse_start_race(text, text),
  public.synapse_race_entries(text, integer), public.synapse_submit_result(uuid, text, text) from public, authenticated;
grant execute on function public.synapse_open_room(text), public.synapse_join_room(text, text, text),
  public.synapse_leave_room(uuid, text), public.synapse_remove_player(text, text, uuid), public.synapse_room_state(text),
  public.synapse_start_match(text, text), public.synapse_submit_round_brain(uuid, text, integer, integer, text),
  public.synapse_round_entries(text, integer, integer),
  public.synapse_submit_brain(uuid, text, text), public.synapse_start_race(text, text),
  public.synapse_race_entries(text, integer), public.synapse_submit_result(uuid, text, text) to anon;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Delete match data within 30 days: every day at 03:17 UTC, rooms older than 30 days (players cascade). The job is
--    replaced, not duplicated, when this file runs again.
-- ---------------------------------------------------------------------------------------------------------------------
select cron.unschedule(jobid) from cron.job where jobname = 'synapse-purge';
select cron.schedule('synapse-purge', '17 3 * * *', $$delete from public.synapse_rooms where created_at < now() - interval '30 days'$$);
