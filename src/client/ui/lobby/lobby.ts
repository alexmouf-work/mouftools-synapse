// Multiplayer (B8, tracks plan §4–5): the title's Multiplayer card (your name; Create a room, or join with a 4-letter
// code; up to 100 players) and the room's lobby on the title screen (the code, every player and whether their brain
// is in, Build and train, Start race for the host, Leave). While you are in a room it is polled every 1.5 s; when the
// host starts a race, every client fetches the same frozen entries and seed, computes the whole race itself
// (deterministic, so every client sees the same race) and counts down to the server's Go. Nothing is kept in the
// browser's storage: leaving the tab leaves the room.
import { genomeToJSON } from '../../../common/sim/brain';
import { energyRefusal } from '../../../common/sim/energy';
import { validateGenome, type Genome } from '../../../common/sim/spec';
import { createRoom, joinRoom, online, perfOf, raceEntries, roomState, serverNow, startRace, submitBrain, submitResult, validCode, type Me, type RoomState } from '../../net/rooms';
import type { Saved } from '../designer/store';
import type { RaceRow, RaceSetup } from '../race/raceView';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`lobby: #${id} missing`);
  return e as T;
};
const POLL_MS = 1500;
/** A race can still be joined (watched from where it is) this long after Go. */
const JOIN_LATE_MS = 125_000;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export interface LobbyHooks {
  /** Show the lobby (on the title screen) or leave it for the title. */
  show(on: boolean): void;
  /** Build and train: the designer in match mode, in this room. */
  build(): void;
  /** A race has started: show it. */
  race(setup: RaceSetup): void;
}

let me: Me | null = null;
let st: RoomState | null = null;
let timer = 0;
let seenRace = 0;
let shown = false;
let hooks: LobbyHooks;


/** The room you are in, or null. */
export const inRoom = (): Me | null => me;
export const lobbyShown = (): boolean => shown;

// for checks (Playwright)
declare global { interface Window { __room?: { me: Me | null; state: RoomState | null; shown: boolean; error: string; handedIn: boolean } } }
const status = { me: null as Me | null, state: null as RoomState | null, shown: false, error: '', handedIn: false };
window.__room = status;

function error(m: string): void { status.error = m; $('mpErr').textContent = m; }

export function startLobby(h: LobbyHooks): void {
  hooks = h;
  const dlg = $('mpDlg') as HTMLDialogElement;
  $('toMatch').onclick = () => {
    error(online() ? '' : 'Multiplayer isn’t set up on this build.');
    ($('mpCreate') as HTMLButtonElement).disabled = ($('mpJoin') as HTMLButtonElement).disabled = !online();
    dlg.showModal();
  };
  $('mpBack').onclick = () => dlg.close();
  const name = () => ($('mpName') as HTMLInputElement).value.trim().slice(0, 16);
  const go = async (f: () => Promise<Me>) => {
    if (!name()) { error('Choose a name first.'); return; }
    try { enter(await f()); dlg.close(); } catch (e) { error(e instanceof Error ? e.message : String(e)); }
  };
  $('mpCreate').onclick = () => { void go(() => createRoom(name())); };
  $('mpJoin').onclick = () => {
    const c = ($('mpCode') as HTMLInputElement).value.trim();
    if (!validCode(c)) { error('A room code is four letters.'); return; }
    void go(() => joinRoom(c, name()));
  };
  ($('mpCode') as HTMLInputElement).addEventListener('input', (e) => { const i = e.target as HTMLInputElement; i.value = i.value.toUpperCase().replace(/[^A-Z]/g, ''); });
  $('lbBuild').onclick = () => hooks.build();
  $('lbLeave').onclick = () => leave();
  $('lbStart').onclick = () => {
    if (!me) return;
    ($('lbStart') as HTMLButtonElement).disabled = true;
    startRace(me).then(() => poll()).catch((e) => { note(`Couldn’t start: ${e instanceof Error ? e.message : String(e)}`); ($('lbStart') as HTMLButtonElement).disabled = false; });
  };
}

function enter(m: Me): void {
  me = m; status.me = m; st = null; seenRace = 0; status.handedIn = false;
  showLobby(true);
  clearInterval(timer);
  timer = window.setInterval(() => { void poll(); }, POLL_MS);
  void poll(true);
}

function leave(): void {
  clearInterval(timer);
  me = null; st = null; status.me = null; status.state = null;
  showLobby(false);
  hooks.show(false);
}

/** Show or hide the lobby card (on the title screen). */
export function showLobby(on: boolean): void {
  shown = on && !!me; status.shown = shown;
  $('lobbyCard').hidden = !shown;
  $('menuCard').hidden = shown;
  if (shown) { hooks.show(true); render(); }
}

function note(t: string): void { $('lbNote').textContent = t; }

function render(): void {
  if (!me) return;
  $('lbCode').textContent = me.code;
  const ps = st?.players ?? [];
  $('lbCount').textContent = `${ps.length} of 100 players`;
  $('lbList').innerHTML = ps.map((p) => `<li class="${p.id === me!.player ? 'you' : ''}"><span>${esc(p.name)}${p.id === me!.player ? ' (you)' : ''}${p.id === ps[0]?.id ? ' · host' : ''}</span><b>${p.ready ? 'brain in' : 'no brain yet'}</b></li>`).join('');
  const ready = ps.filter((p) => p.ready).length, mineIn = ps.some((p) => p.id === me!.player && p.ready);
  $('lbStart').hidden = !me.host;
  ($('lbStart') as HTMLButtonElement).disabled = ready === 0;
  note(mineIn ? (me.host ? `Your brain is in. ${ready} ready: start the race when everyone is.` : 'Your brain is in. Waiting for the host to start the race.')
    : 'Build and train a brain, then hand it in to race.');
}

/** Hand in a trained brain for the next race (the training view's Hand in). */
export async function handIn(s: Saved): Promise<void> {
  if (!me) return;
  const text = genomeToJSON(s.genome);
  await submitBrain(me, text);
  status.handedIn = true;
  await poll();
}

/** Your result, as the privacy policy says (place, time, distance). */
export function reportResult(row: RaceRow | null, raceNo: number): void {
  if (!me || !row) return;
  submitResult(me, JSON.stringify({ race: raceNo, place: row.place, finish: row.finish, prog: Math.round(Math.max(0, row.prog)) })).catch((e) => console.warn('lobby: result not sent', e));
}

/** A race's entries as every client reads them: valid brains within the match limit, in join order. */
export function setupOf(code: string, entries: { id: string; name: string; brain: string }[], raceSeed: number, goServer: number, mine: string): RaceSetup {
  const ok: { id: string; name: string; genome: Genome }[] = [];
  for (const e of entries) {
    try {
      const g = JSON.parse(e.brain) as Genome;
      validateGenome(g);
      if (energyRefusal(g.spec, 'match')) continue;
      ok.push({ id: e.id, name: e.name, genome: g });
    } catch { /* not a brain: left out, the same on every client */ }
  }
  return { kind: 'room', title: `Room ${code}`, names: ok.map((e) => e.name), genomes: ok.map((e) => e.genome), me: ok.findIndex((e) => e.id === mine), raceSeed, goAt: perfOf(goServer) };
}

async function poll(first = false): Promise<void> {
  if (!me) return;
  let s: RoomState | null;
  try { s = await roomState(me.code); } catch (e) { note(`Can’t reach the room (${e instanceof Error ? e.message : String(e)}); trying again…`); return; }
  if (!me || !s) return;
  st = s; status.state = s;
  if (first) seenRace = s.start_at !== null && serverNow() - s.start_at > JOIN_LATE_MS ? s.race_no : 0;
  if (shown) render();
  if (s.race_no > seenRace && s.race_seed !== null && s.start_at !== null && serverNow() - s.start_at < JOIN_LATE_MS) {
    seenRace = s.race_no;
    const raceNo = s.race_no, seed = s.race_seed, goAt = s.start_at, code = me.code, player = me.player;
    const entries = await raceEntries(code, raceNo);
    if (!me || !entries.length) return;
    const setup = setupOf(code, entries, seed, goAt, player);
    if (shown) hooks.race({ ...setup, raceNo });
    else note(`A race started while you were away (race ${raceNo}).`);
  }
}
