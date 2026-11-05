// A local stand-in for the Supabase project (B8, B9 lobby): the same functions as supabase/schema.sql, behind the same
// PostgREST shape (POST /rest/v1/rpc/<name>, JSON arguments, the anon key in `apikey` and `Authorization: Bearer`),
// in memory. The multiplayer check runs the app against it; the real service is first tried on the preview.
// `skew` lets a check move the server's time; `seed` makes race and match seeds reproducible. A match's rounds follow
// the same schedule as the schema's synapse_round_start / synapse_round_freeze (src/common/schedule.ts).
import { createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { CONFIG } from '../../src/common/config';
import { matchOverMs, roundTimes } from '../../src/common/schedule';

interface Player { id: string; room: string; name: string; tokenHash: string; brain: string | null; result: string | null; joined: number; joinedAt: number }
interface Room {
  code: string; hostHash: string; created: number; raceNo: number; raceSeed: number | null; startAt: number | null; entries: string | null;
  matchNo: number; matchSeed: number | null; matchAt: number | null;
  /** Round brains of the current match, by round then player id; frozen entries by round. */
  brains: Map<number, Map<string, string>>; frozen: Map<number, string>;
}

const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const MAX_PLAYERS = 100;

export interface StandIn {
  url: string; key: string; rooms: Map<string, Room>; players: Player[];
  /** Server time offset (ms), to check that clients follow the server's clock. */
  skew: number;
  calls: string[];
  close(): Promise<void>;
  /** Call a function as a client would (for seeding a room with extra players from Node). */
  rpc(fn: string, args: Record<string, unknown>): unknown;
}

export async function startStandin(key = 'standin-anon-key', seed = 1): Promise<StandIn> {
  const rooms = new Map<string, Room>(), players: Player[] = [];
  let s = seed >>> 0, joinClock = 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const state: StandIn = { url: '', key, rooms, players, skew: 0, calls: [], close: async () => {}, rpc: () => null };
  const now = () => Date.now() + state.skew;
  const fail = (m: string): never => { throw Object.assign(new Error(m), { status: 400 }); };
  // synapse_name: spaces collapsed and trimmed, 1–16 characters
  const name = (n: unknown) => { const v = String(n ?? '').replace(/\s+/g, ' ').trim(); if (v.length < 1 || v.length > 16) fail('name'); return v; };
  const token = (t: unknown) => { const v = String(t ?? ''); if (v.length < 32) fail('token'); return v; };
  const join = (code: string, n: unknown, t: unknown) => {
    const v = name(n);
    if (inRoom(code).some((p) => p.name.toLowerCase() === v.toLowerCase())) fail('name taken');
    const p: Player = { id: randomUUID(), room: code, name: v, tokenHash: hash(token(t)), brain: null, result: null, joined: ++joinClock, joinedAt: now() };
    players.push(p);
    return p;
  };
  // leaving takes your round brains with you (the schema's on delete cascade), until a round's entries are frozen
  const drop = (p: Player | undefined) => {
    if (!p) return;
    players.splice(players.indexOf(p), 1);
    for (const b of rooms.get(p.room)?.brains.values() ?? []) b.delete(p.id);
  };
  const roundOk = (r: Room, matchNo: unknown, round: unknown): number => {
    const n = Number(round);
    if (r.matchAt === null || r.matchNo !== matchNo || !Number.isInteger(n) || n < 1 || n > CONFIG.rounds.count) fail('no such round');
    return n;
  };
  const inRoom = (code: string) => players.filter((p) => p.room === code).sort((a, b) => a.joined - b.joined || (a.id < b.id ? -1 : 1));
  const mine = (id: unknown, t: unknown) => players.find((p) => p.id === id && p.tokenHash === hash(String(t))) ?? fail('not your player');
  const fns: Record<string, (a: Record<string, unknown>) => unknown> = {
    synapse_open_room: (a) => {
      token(a.p_token);
      let code = '';
      do code = Array.from({ length: 4 }, () => String.fromCharCode(65 + Math.floor(rnd() * 26))).join(''); while (rooms.has(code));
      rooms.set(code, { code, hostHash: hash(String(a.p_token)), created: now(), raceNo: 0, raceSeed: null, startAt: null, entries: null, matchNo: 0, matchSeed: null, matchAt: null, brains: new Map(), frozen: new Map() });
      return { code, now: now() };
    },
    synapse_join_room: (a) => {
      const code = String(a.p_code ?? '').toUpperCase();
      token(a.p_token); name(a.p_name);
      if (!rooms.has(code)) fail('no such room');
      if (inRoom(code).length >= MAX_PLAYERS) fail('room full');
      const p = join(code, a.p_name, a.p_token);
      return { code, player: p.id, name: p.name, joined: p.joinedAt, now: now() };
    },
    synapse_leave_room: (a) => { drop(players.find((p) => p.id === a.p_player && p.tokenHash === hash(String(a.p_token)))); return undefined; },
    synapse_remove_player: (a) => {
      const r = rooms.get(String(a.p_code ?? '').toUpperCase()), h = hash(String(a.p_token));
      if (!r || r.hostHash !== h) return fail('not the host');
      drop(players.find((p) => p.id === a.p_player && p.room === r.code && p.tokenHash !== h));
      return undefined;
    },
    synapse_room_state: (a) => {
      const r = rooms.get(String(a.p_code ?? '').toUpperCase());
      if (!r) return null;
      return { code: r.code, race_no: r.raceNo, race_seed: r.raceSeed, start_at: r.startAt, match_no: r.matchNo, match_seed: r.matchSeed, match_at: r.matchAt, now: now(), players: inRoom(r.code).map((p) => ({ id: p.id, name: p.name, ready: p.brain !== null, host: p.tokenHash === r.hostHash, joined: p.joinedAt })) };
    },
    synapse_submit_brain: (a) => {
      const b = String(a.p_brain ?? '');
      if (b.length > 32000) fail('brain');
      mine(a.p_player, a.p_token).brain = b;
      return undefined;
    },
    synapse_start_race: (a) => {
      const r = rooms.get(String(a.p_code ?? '').toUpperCase());
      if (!r || r.hostHash !== hash(String(a.p_token))) return fail('not the host');
      r.raceNo++; r.raceSeed = Math.floor(rnd() * 4294967296); r.startAt = now() + 12_000;
      r.entries = JSON.stringify(inRoom(r.code).filter((p) => p.brain !== null).map((p) => ({ id: p.id, name: p.name, brain: p.brain })));
      return { race_no: r.raceNo, race_seed: r.raceSeed, start_at: r.startAt, now: now() };
    },
    synapse_start_match: (a) => {
      const r = rooms.get(String(a.p_code ?? '').toUpperCase());
      if (!r || r.hostHash !== hash(String(a.p_token))) return fail('not the host');
      if (r.matchAt !== null && now() < r.matchAt + matchOverMs()) return fail('match on');
      r.matchNo++; r.matchSeed = Math.floor(rnd() * 4294967296); r.matchAt = now(); r.brains = new Map(); r.frozen = new Map();
      return { match_no: r.matchNo, match_seed: r.matchSeed, match_at: r.matchAt, now: now() };
    },
    synapse_submit_round_brain: (a) => {
      const p = mine(a.p_player, a.p_token), r = rooms.get(p.room)!, n = roundOk(r, a.p_match_no, a.p_round), t = roundTimes(n);
      if (p.joinedAt > r.matchAt! + t.start) fail('not in this round');
      if (now() < r.matchAt! + t.start) fail('too early');
      if (now() >= r.matchAt! + t.freeze || r.frozen.has(n)) fail('too late');
      const b = String(a.p_brain ?? '');
      if (b.length > 32000) fail('brain');
      if (!r.brains.has(n)) r.brains.set(n, new Map());
      r.brains.get(n)!.set(p.id, b);
      return undefined;
    },
    synapse_round_entries: (a) => {
      const r = rooms.get(String(a.p_code ?? '').toUpperCase());
      const n = Number(a.p_round);
      if (!r || r.matchAt === null || r.matchNo !== a.p_match_no || !Number.isInteger(n) || n < 1 || n > CONFIG.rounds.count) return null;
      if (!r.frozen.has(n)) {
        if (now() < r.matchAt + roundTimes(n).freeze) return null;
        const b = r.brains.get(n) ?? new Map<string, string>();
        r.frozen.set(n, JSON.stringify(inRoom(r.code).filter((p) => b.has(p.id)).map((p) => ({ id: p.id, name: p.name, brain: b.get(p.id) }))));
      }
      return r.frozen.get(n)!;
    },
    synapse_race_entries: (a) => { const r = rooms.get(String(a.p_code ?? '').toUpperCase()); return r && r.raceNo === a.p_race_no ? r.entries : null; },
    synapse_submit_result: (a) => {
      const v = String(a.p_result ?? '');
      if (v.length > 1000) fail('result');
      mine(a.p_player, a.p_token).result = v;
      return undefined;
    },
  };
  state.rpc = (fn, args) => fns[fn](args);
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey, authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    const m = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(req.url ?? '');
    const send = (code: number, body?: unknown) => { res.writeHead(code, { ...cors, 'Content-Type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)); };
    if (req.method !== 'POST' || !m || !fns[m[1]]) { send(404, { message: 'not found' }); return; }
    if (req.headers.apikey !== key || req.headers.authorization !== `Bearer ${key}`) { send(401, { message: 'no api key' }); return; }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      state.calls.push(m[1]);
      try {
        const out = fns[m[1]](body ? JSON.parse(body) as Record<string, unknown> : {});
        if (out === undefined) { res.writeHead(204, cors); res.end(); } else send(200, out);
      } catch (e) { send((e as { status?: number }).status ?? 500, { message: e instanceof Error ? e.message : String(e) }); }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('standin: no address');
  state.url = `http://127.0.0.1:${addr.port}`;
  state.close = () => new Promise<void>((r) => server.close(() => r()));
  return state;
}
