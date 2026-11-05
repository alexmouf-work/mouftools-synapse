// Multiplayer rooms (B8, tracks plan §4–5, legal plan "Supabase keys"): the client side of supabase/schema.sql. Every
// call is one of the database's functions over PostgREST (POST /rest/v1/rpc/<name>) with the anon key, which the build
// maps in from SUPABASE_PROJECT_URL and SUPABASE_ANON_KEY (vite.config.ts `define`; the service role key is never
// read by the build). Nothing is stored in the browser: your player's secret token lives in memory for the tab.
// The server's clock (`now` in each reply) sets when Go is, so every client counts down to the same moment.

export interface RoomPlayer { id: string; name: string; ready: boolean }
export interface RoomState { code: string; race_no: number; race_seed: number | null; start_at: number | null; now: number; players: RoomPlayer[] }
export interface Entry { id: string; name: string; brain: string }
export interface Me { code: string; player: string; token: string; name: string; host: boolean }

const URL_ = __SUPABASE_URL__.replace(/\/+$/, ''), KEY = __SUPABASE_ANON_KEY__;
/** True if this build was given a Supabase project (else Multiplayer says it isn't set up). */
export const online = (): boolean => URL_ !== '' && KEY !== '';

/** Server time − local time (ms), from the latest reply (half the round trip assumed each way). */
let offset = 0;
export const serverNow = (): number => Date.now() + offset;
/** A server time (ms since 1970) as performance.now() time. */
export const perfOf = (serverMs: number): number => performance.now() + (serverMs - serverNow());

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  if (!online()) throw new Error('Multiplayer isn’t set up on this build.');
  const t0 = Date.now();
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args),
  });
  const text = await r.text();
  if (!r.ok) {
    let m = `${r.status}`;
    try { m = (JSON.parse(text) as { message?: string }).message ?? m; } catch { /* not JSON */ }
    throw new Error(m);
  }
  const out = text ? JSON.parse(text) as T : (undefined as T);
  const now = (out as { now?: number } | null)?.now;
  if (typeof now === 'number') offset = now - (t0 + Date.now()) / 2;
  return out;
}

const newToken = (): string => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

export async function createRoom(name: string): Promise<Me> {
  const token = newToken(), r = await rpc<{ code: string; player: string }>('create_room', { p_name: name, p_token: token });
  return { code: r.code, player: r.player, token, name, host: true };
}
export async function joinRoom(code: string, name: string): Promise<Me> {
  const token = newToken(), r = await rpc<{ code: string; player: string }>('join_room', { p_code: code.toUpperCase(), p_name: name, p_token: token });
  return { code: r.code, player: r.player, token, name, host: false };
}
export const roomState = (code: string): Promise<RoomState | null> => rpc('room_state', { p_code: code });
export const submitBrain = (me: Me, brain: string): Promise<void> => rpc('submit_brain', { p_player: me.player, p_token: me.token, p_brain: brain });
export const startRace = (me: Me): Promise<{ race_no: number; race_seed: number; start_at: number }> => rpc('start_race', { p_code: me.code, p_token: me.token });
export async function raceEntries(code: string, raceNo: number): Promise<Entry[]> {
  const t = await rpc<string | null>('race_entries', { p_code: code, p_race_no: raceNo });
  return t ? JSON.parse(t) as Entry[] : [];
}
export const submitResult = (me: Me, result: string): Promise<void> => rpc('submit_result', { p_player: me.player, p_token: me.token, p_result: result });

/** A room code as typed: four letters A–Z. */
export const validCode = (c: string): boolean => /^[A-Za-z]{4}$/.test(c);
