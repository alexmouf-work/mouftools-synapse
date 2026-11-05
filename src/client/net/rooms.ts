// Multiplayer rooms (B8, B9 lobby; tracks plan §4–5, legal plan "Supabase keys"): the client side of supabase/schema.sql. Every
// call is one of the database's functions over PostgREST (POST /rest/v1/rpc/<name>) with the anon key, which the build
// maps in from SUPABASE_PROJECT_URL and SUPABASE_ANON_KEY (vite.config.ts `define`; the service role key is never
// read by the build). Nothing is stored in the browser: your player's secret token lives in memory for the tab.
// The server's clock (`now` in each reply) sets when every phase of a match starts (common/schedule.ts), so every
// client builds, trains and counts down to Go at the same moments.

export interface RoomPlayer { id: string; name: string; ready: boolean; host: boolean; /** When they joined (server ms). */ joined: number }
export interface RoomState {
  code: string; race_no: number; race_seed: number | null; start_at: number | null;
  /** The room's match (match-flow v2 §M2): its number (0: none yet), seed, and start (server ms; round 1's build). */
  match_no: number; match_seed: number | null; match_at: number | null;
  now: number; players: RoomPlayer[];
}
export interface Entry { id: string; name: string; brain: string }
/** You in a room; `joined` is when (server ms): a match already under way is yours from the next round's build. */
export interface Me { code: string; player: string; token: string; name: string; host: boolean; joined: number }

const URL_ = __SUPABASE_URL__.replace(/\/+$/, ''), KEY = __SUPABASE_ANON_KEY__;
/** True if this build was given a Supabase project (else Multiplayer says it isn't set up). */
export const online = (): boolean => URL_ !== '' && KEY !== '';

/** Server time − local time (ms), from the latest reply (half the round trip assumed each way). */
let offset = 0;
export const serverNow = (): number => Date.now() + offset;
/** Checks only (a phase timer's skipTo in a room): this client's view of the server's clock moves on by ms. */
export const shiftClock = (ms: number): void => { offset += ms; };
/** A server time (ms since 1970) as performance.now() time. */
export const perfOf = (serverMs: number): number => performance.now() + (serverMs - serverNow());

async function rpc<T>(fn: string, args: Record<string, unknown>, keepalive = false): Promise<T> {
  if (!online()) throw new Error('Multiplayer isn’t set up on this build.');
  const t0 = Date.now();
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args), keepalive,
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

/** A name as the room keeps it (the server's synapse_name): spaces collapsed, trimmed; 1–16 characters to be valid. */
export const cleanName = (n: string): string => n.replace(/\s+/g, ' ').trim();
/** A room you may join: its code and your secret token (the host's is the one the room was opened with). */
export interface Ticket { code: string; token: string; host: boolean }
/** Open a room (B9): the code first, the host's name on the next screen. */
export async function openRoom(): Promise<Ticket> {
  const token = newToken(), r = await rpc<{ code: string }>('synapse_open_room', { p_token: token });
  return { code: r.code, token, host: true };
}
export const ticketFor = (code: string): Ticket => ({ code: code.toUpperCase(), token: newToken(), host: false });
export async function joinRoom(t: Ticket, name: string): Promise<Me> {
  const r = await rpc<{ code: string; player: string; name: string; joined: number }>('synapse_join_room', { p_code: t.code, p_name: cleanName(name), p_token: t.token });
  return { code: r.code, player: r.player, token: t.token, name: r.name, host: t.host, joined: r.joined };
}
/** Leave the room (keepalive: it still goes out as the tab closes). */
export const leaveRoom = (me: Me, keepalive = false): Promise<void> => rpc('synapse_leave_room', { p_player: me.player, p_token: me.token }, keepalive);
/** The host removes another player. */
export const removePlayer = (me: Me, player: string): Promise<void> => rpc('synapse_remove_player', { p_code: me.code, p_token: me.token, p_player: player });
export const roomState = (code: string): Promise<RoomState | null> => rpc('synapse_room_state', { p_code: code });
/** The host starts a match: round 1's build from now, on every client. */
export const startMatch = (me: Me): Promise<{ match_no: number; match_seed: number; match_at: number }> => rpc('synapse_start_match', { p_code: me.code, p_token: me.token });
/** Hand in your brain for a round (until its entries freeze, as the race's countdown begins). */
export const submitRoundBrain = (me: Me, matchNo: number, round: number, brain: string): Promise<void> =>
  rpc('synapse_submit_round_brain', { p_player: me.player, p_token: me.token, p_match_no: matchNo, p_round: round, p_brain: brain });
/** A round's frozen entries, in join order; null until the freeze. */
export async function roundEntries(code: string, matchNo: number, round: number): Promise<Entry[] | null> {
  const t = await rpc<string | null>('synapse_round_entries', { p_code: code, p_match_no: matchNo, p_round: round });
  return t ? JSON.parse(t) as Entry[] : null;
}
export const submitResult = (me: Me, result: string): Promise<void> => rpc('synapse_submit_result', { p_player: me.player, p_token: me.token, p_result: result });

/** A room code as typed: four letters A–Z. */
export const validCode = (c: string): boolean => /^[A-Za-z]{4}$/.test(c);
