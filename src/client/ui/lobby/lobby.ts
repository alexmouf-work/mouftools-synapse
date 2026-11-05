// Multiplayer (B8 rooms; B9 lobby, docs/plans/2026-11-05-lobby-and-landscape.md and reference/multiplayer-lobby-mockup.html):
// a screen of its own over the page. 1. The room code: one 4-letter field; the fourth letter checks the room and a
// real one moves straight on (or Create a room). 2. Your name, on its own screen: the room's code and how many are in,
// "What should we call you?", 1–16 characters (spaces collapsed), a name already in the room refused (the server
// checks too), a preview of your chip, Go in. 3. The lobby: the code, how many are in and ready, the host's Start race
// (2 or more ready); a field of name chips that fit their text and pop in, scattered where they overlap least (rows
// on a short screen once more than 60 are in), filled once that player's brain is in; the host taps a name to remove
// that player; Build your brain, Leave room. While you are in a room it is polled every 1.5 s; when the host starts a
// race, every client fetches the same frozen entries and seed, computes the whole race itself (deterministic, so
// every client sees the same race) and counts down to the server's Go. Nothing is kept in the browser's storage:
// closing the tab leaves the room.
import './lobby.css';
import { genomeToJSON } from '../../../common/sim/brain';
import { energyRefusal } from '../../../common/sim/energy';
import { validateGenome, type Genome } from '../../../common/sim/spec';
import {
  cleanName, joinRoom, leaveRoom, online, openRoom, perfOf, raceEntries, removePlayer, roomState, serverNow, startRace, submitBrain,
  submitResult, ticketFor, validCode, type Me, type RoomPlayer, type RoomState, type Ticket,
} from '../../net/rooms';
import type { Saved } from '../designer/store';
import { RACE_COLORS, type RaceRow, type RaceSetup } from '../race/raceView';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`lobby: #${id} missing`);
  return e as T;
};
const POLL_MS = 1500;
/** A race can still be joined (watched from where it is) this long after Go. */
const JOIN_LATE_MS = 125_000;
const MAX = 100;
const NAME_MAX = 16;
/** Your chip's colour: your car's yellow. The others take the race colours in join order. */
const YOU = '#ffc21a';
/** Scattered: spots tried per new chip (the one overlapping least wins). Rows instead on a short screen past ROWS_PAST. */
const TRIES = 80, ROWS_PAST = 60, PAD = 10;
const SHORT = '(max-height: 540px)';

export const NO_ROOM = 'No room with that code. Check it with the host.';
export const FULL = `That room is full (${MAX} players).`;
export const REMOVED = 'The host removed you from the room.';
const taken = (n: string) => `Someone in this room is already called ${n}. Try another name.`;

export interface LobbyHooks {
  /** Multiplayer's screen is showing (hide the rest) or closed (back to the title). */
  show(on: boolean): void;
  /** Build your brain: the designer in match mode, in this room. */
  build(): void;
  /** A race has started: show it. */
  race(setup: RaceSetup): void;
}

type Screen = 'join' | 'name' | 'lobby';
interface Chip { id: string; el: HTMLElement; fx: number; fy: number; rect: { x: number; y: number; w: number; h: number } | null }

let me: Me | null = null;
let ticket: Ticket | null = null;
let st: RoomState | null = null;
/** The room as the name screen last saw it (its count, and the names already taken). */
let peek: RoomState | null = null;
let timer = 0, nameTimer = 0;
let seenRace = 0;
let screen: Screen | null = null;
let gone = '';
let hooks: LobbyHooks;
const chips = new Map<string, Chip>();
let layout: 'scatter' | 'rows' = 'scatter';
let fontPx = 16;
let kickFor: string | null = null;
let starting = false;

/** The room you are in, or null. */
export const inRoom = (): Me | null => me;
export const lobbyShown = (): boolean => screen === 'lobby';

// for checks (Playwright)
declare global {
  interface Window {
    __room?: {
      me: Me | null; state: RoomState | null; shown: boolean; error: string; handedIn: boolean;
      screen: Screen | null; layout: 'scatter' | 'rows'; fontPx: number;
    };
  }
}
const status = { me: null as Me | null, state: null as RoomState | null, shown: false, error: '', handedIn: false, screen: null as Screen | null, layout: layout as 'scatter' | 'rows', fontPx };
window.__room = status;

function show(s: Screen | null): void {
  screen = s; status.screen = s; status.shown = s === 'lobby';
  $('mp').hidden = s === null;
  $('mpJoinS').hidden = s !== 'join';
  $('mpNameS').hidden = s !== 'name';
  $('mpLobby').hidden = s !== 'lobby';
  clearInterval(nameTimer);
  if (s === 'join') setTimeout(() => $('mpCode').focus(), 0);
  if (s === 'name') { syncName(); setTimeout(() => $('mpName').focus(), 0); nameTimer = window.setInterval(() => { void refreshPeek(); }, POLL_MS); }
  if (s === 'lobby') { hideKick(); render(); }
  if (s !== null) hooks.show(true);
}

function codeError(m: string): void { status.error = m; $('mpCodeErr').textContent = m; }

/** Multiplayer from the title (or after being removed): the code screen, with a message if there is one. */
export function openMultiplayer(msg = ''): void {
  const code = $<HTMLInputElement>('mpCode');
  code.value = ''; code.readOnly = false; code.classList.remove('checking');
  const on = online();
  code.disabled = !on; $<HTMLButtonElement>('mpCreate').disabled = !on;
  show('join');
  codeError(on ? msg : 'Multiplayer isn’t set up on this build.');
}

export function startLobby(h: LobbyHooks): void {
  hooks = h;
  $('toMatch').onclick = () => openMultiplayer();
  // 1. the code: the fourth letter checks the room
  const code = $<HTMLInputElement>('mpCode');
  code.addEventListener('input', () => {
    const v = code.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    if (v !== code.value) code.value = v;
    codeError('');
    if (v.length === 4) void tryCode();
  });
  $('mpJoinF').addEventListener('submit', (e) => { e.preventDefault(); if (code.value.length === 4) void tryCode(); });
  $('mpCreate').onclick = () => { void create(); };
  $('mpBack').onclick = () => { show(null); hooks.show(false); };
  // 2. your name
  $('mpName').addEventListener('input', syncName);
  $('mpNameF').addEventListener('submit', (e) => { e.preventDefault(); void goIn(); });
  $('mpNameBack').onclick = () => { ticket = null; peek = null; openMultiplayer(); };
  // 3. the lobby
  $('lbBuild').onclick = () => hooks.build();
  $('lbLeave').onclick = () => leave();
  $('lbStart').onclick = () => {
    if (!me) return;
    starting = true;
    render();
    startRace(me).then(() => poll()).catch((e) => { note(`Couldn’t start: ${msgOf(e)}`); starting = false; render(); });
  };
  $('lbKick').onclick = (e) => {
    e.stopPropagation();
    const id = kickFor;
    hideKick();
    if (!me || !id) return;
    removePlayer(me, id).then(() => poll()).catch((err) => note(`Couldn’t remove that player: ${msgOf(err)}`));
  };
  $('lbField').addEventListener('click', hideKick);
  let rt = 0;
  addEventListener('resize', () => { cancelAnimationFrame(rt); rt = requestAnimationFrame(() => { if (screen === 'lobby') relayout(); }); });
  // closing the tab leaves the room (so your name is free again)
  addEventListener('pagehide', () => { if (me) leaveRoom(me, true).catch(() => undefined); });
}

const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function tryCode(): Promise<void> {
  const code = $<HTMLInputElement>('mpCode'), c = code.value;
  if (!validCode(c) || code.readOnly) return;
  code.classList.add('checking'); code.readOnly = true;
  let s: RoomState | null = null, err = '';
  try { s = await roomState(c); } catch (e) { err = `Can’t reach the rooms (${msgOf(e)}). Try again.`; }
  code.classList.remove('checking'); code.readOnly = false;
  if (screen !== 'join' || code.value !== c) return;
  if (!err && !s) err = NO_ROOM;
  else if (!err && s && s.players.length >= MAX) err = FULL;
  if (err) { codeError(err); code.focus(); code.select(); return; }
  ticket = ticketFor(c); peek = s;
  nameScreen(false);
}

async function create(): Promise<void> {
  const b = $<HTMLButtonElement>('mpCreate');
  b.disabled = true;
  try {
    ticket = await openRoom();
    peek = null;
    nameScreen(true);
  } catch (e) { codeError(`Couldn’t open a room: ${msgOf(e)}`); }
  b.disabled = !online();
}

function nameScreen(isNew: boolean): void {
  if (!ticket) return;
  $('mpNameCode').textContent = ticket.code;
  $('mpNameT').textContent = isNew ? 'Your room is ready. What should we call you?' : 'What should we call you?';
  $<HTMLInputElement>('mpName').value = $<HTMLInputElement>('mpName').value.trim();
  $('mpNameErr').textContent = '';
  peekCount();
  $('mpPreview').style.setProperty('--c', YOU);
  show('name');
}

function peekCount(): void {
  const n = peek?.players.length ?? 0;
  $('mpNameN').textContent = String(n);
  $('mpNameSub').textContent = n === 1 ? 'player in' : 'players in';
}

async function refreshPeek(): Promise<void> {
  if (!ticket || screen !== 'name') return;
  try { const s = await roomState(ticket.code); if (s && screen === 'name') { peek = s; peekCount(); syncName(); } } catch { /* try again next time */ }
}

/** The name as typed: spaces collapsed (a leading one dropped), the counter, the preview, a name already taken. */
function syncName(): void {
  const input = $<HTMLInputElement>('mpName');
  const v = input.value.replace(/\s+/g, ' ').replace(/^ /, '').slice(0, NAME_MAX);
  if (v !== input.value) input.value = v;
  const n = cleanName(v);
  $('mpNameCount').textContent = `${v.length} / ${NAME_MAX}`;
  ($('mpPreview').lastChild as HTMLElement).textContent = n || 'Your name';
  const dup = !!n && !!peek?.players.some((p) => p.name.toLowerCase() === n.toLowerCase());
  const err = dup ? taken(n) : '';
  if (err || $('mpNameErr').textContent!.startsWith('Someone')) $('mpNameErr').textContent = err;
  $<HTMLButtonElement>('mpGo').disabled = !n || dup;
}

async function goIn(): Promise<void> {
  syncName();
  const go = $<HTMLButtonElement>('mpGo');
  if (go.disabled || !ticket) return;
  const n = cleanName($<HTMLInputElement>('mpName').value);
  go.disabled = true;
  try {
    enter(await joinRoom(ticket, n));
  } catch (e) {
    const m = msgOf(e);
    if (m === 'no such room') { ticket = null; openMultiplayer(NO_ROOM); return; }
    $('mpNameErr').textContent = m === 'name taken' ? taken(n) : m === 'room full' ? FULL : `Couldn’t go in: ${m}`;
    status.error = $('mpNameErr').textContent!;
    if (m === 'name taken') await refreshPeek();
    go.disabled = false;
    syncName();
  }
}

function enter(m: Me): void {
  me = m; status.me = m; st = null; seenRace = 0; status.handedIn = false; gone = ''; starting = false;
  ticket = null; peek = null;
  for (const c of chips.values()) c.el.remove();
  chips.clear();
  show('lobby');
  clearInterval(timer);
  timer = window.setInterval(() => { void poll(); }, POLL_MS);
  void poll(true);
}

function stop(): void {
  clearInterval(timer);
  me = null; st = null; status.me = null; status.state = null;
}

function leave(): void {
  if (me) leaveRoom(me).catch((e) => console.warn('lobby: leave not sent', e));
  stop();
  show(null);
  hooks.show(false);
}

/** Show the lobby (back from building or a race), or close Multiplayer's screen. Removed meanwhile: the code screen says so. */
export function showLobby(on: boolean): void {
  if (!on) { show(null); return; }
  if (me) show('lobby');
  else openMultiplayer(gone);
}

function note(t: string): void { $('lbNote').textContent = t; }

const BASE_NOTE = 'Build and train a brain, then hand it in. The race uses the brains that are in when the host starts.';

function render(): void {
  if (!me || screen !== 'lobby') return;
  $('lbCode').textContent = me.code;
  const ps = st?.players ?? [];
  const ready = ps.filter((p) => p.ready).length, mineIn = ps.some((p) => p.id === me!.player && p.ready);
  $('lbCount').textContent = `${ps.length} / ${MAX}`;
  $('lbCountSub').textContent = `${ps.length === 1 ? 'player' : 'players'} · ${ready} ready`;
  $('lbHostSide').hidden = !me.host;
  $('lbPlayerSide').hidden = me.host;
  const start = $<HTMLButtonElement>('lbStart');
  start.disabled = starting || ready < 2;
  start.textContent = starting ? 'Starting…' : ready < 2 ? 'Start race' : `Start race (${ready})`;
  $('lbBuild').textContent = mineIn ? 'Brain handed in · Edit' : 'Build your brain';
  if (!$('lbNote').textContent || /^(Build and train|Your brain is in)/.test($('lbNote').textContent!)) {
    note(!mineIn ? BASE_NOTE : me.host ? 'Your brain is in. Start the race when two or more are ready.' : 'Your brain is in. You can still edit it until the host starts.');
  }
  $('lbEmpty').hidden = ps.length > 0;
  chipsOf(ps);
}

// ---- the chips ----
const field = () => $('lbField');
/** Others' colours: the race colours in join order, skipping you (your own chip is your car's yellow). */
function colours(ps: RoomPlayer[]): Map<string, string> {
  const out = new Map<string, string>();
  let k = 0;
  for (const p of ps) out.set(p.id, p.id === me?.player ? YOU : RACE_COLORS[k++ % RACE_COLORS.length]);
  return out;
}

function chipsOf(ps: RoomPlayer[]): void {
  const f = field(), col = colours(ps), ids = new Set(ps.map((p) => p.id));
  const host = !!me?.host;
  for (const [id, c] of chips) {
    if (ids.has(id)) continue;
    chips.delete(id);
    if (kickFor === id) hideKick();
    c.el.classList.add('leaving');
    setTimeout(() => c.el.remove(), 230);
  }
  const fresh: Chip[] = [];
  ps.forEach((p, k) => {
    let c = chips.get(p.id);
    if (!c) {
      const el = document.createElement('span'), i = document.createElement('i'), t = document.createElement('span');
      t.textContent = p.name;
      el.append(i, t);
      el.dataset.id = p.id;
      el.addEventListener('click', (ev) => {
        if (!me?.host || p.id === me.player) return;
        ev.stopPropagation();
        showKick(p.id, p.name);
      });
      f.appendChild(el);
      c = { id: p.id, el, fx: -1, fy: -1, rect: null };
      chips.set(p.id, c);
      fresh.push(c);
    }
    const mine = p.id === me?.player;
    c.el.className = `chip${p.ready ? ' ready' : ''}${mine ? ' me' : ''}${host && !mine ? ' tap' : ''}${kickFor === p.id ? ' picked' : ''}`;
    c.el.style.setProperty('--c', col.get(p.id)!);
    c.el.style.zIndex = String(k + 1);
    c.el.title = `${p.name}${p.host ? ' (host)' : ''}: ${p.ready ? 'brain handed in' : 'still building'}`;
  });
  const before = fontPx, mode = layout;
  fit(ps.length);
  if (layout !== mode || Math.abs(fontPx - before) > 0.4) relayout();
  else if (layout === 'scatter') for (const c of fresh) place(c);
}

/** Font size follows how full the room is; rows instead of scattered on a short screen once more than 60 are in. */
function fit(n: number): void {
  const f = field(), W = f.clientWidth, H = f.clientHeight;
  layout = matchMedia(SHORT).matches && n > ROWS_PAST ? 'rows' : 'scatter';
  fontPx = Math.max(11, Math.min(17, Math.sqrt((W * H) / Math.max(n, 8)) / 6.2));
  if (!Number.isFinite(fontPx)) fontPx = 16;
  f.classList.toggle('rows', layout === 'rows');
  f.style.setProperty('--fs', `${fontPx.toFixed(1)}px`);
  status.layout = layout; status.fontPx = fontPx;
}

const overlap = (a: NonNullable<Chip['rect']>, b: NonNullable<Chip['rect']>) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** Scattered: try spots at random (display only, not the sim) and keep the one overlapping least. */
function place(c: Chip): void {
  const f = field(), W = f.clientWidth, H = f.clientHeight, w = c.el.offsetWidth, h = c.el.offsetHeight;
  const sx = Math.max(1, W - w - 2 * PAD), sy = Math.max(1, H - h - 2 * PAD);
  const others = [...chips.values()].filter((o) => o !== c && o.rect).map((o) => o.rect!);
  let best = { x: PAD, y: PAD, w, h }, score = Infinity;
  for (let k = 0; k < TRIES; k++) {
    const r = { x: PAD + Math.random() * sx, y: PAD + Math.random() * sy, w, h };
    let s = 0;
    for (const o of others) s += overlap(r, o);
    if (s < score) { best = r; score = s; }
    if (s === 0) break;
  }
  // kept as fractions of the free space, so the layout holds when the window is resized
  c.fx = (best.x - PAD) / sx; c.fy = (best.y - PAD) / sy;
  apply(c);
}
function apply(c: Chip): void {
  const f = field(), W = f.clientWidth, H = f.clientHeight, w = c.el.offsetWidth, h = c.el.offsetHeight;
  const x = PAD + c.fx * Math.max(1, W - w - 2 * PAD), y = PAD + c.fy * Math.max(1, H - h - 2 * PAD);
  c.el.style.left = `${x}px`; c.el.style.top = `${y}px`;
  c.rect = { x, y, w, h };
}
function relayout(): void {
  fit(chips.size);
  hideKick();
  if (layout === 'rows') { for (const c of chips.values()) { c.el.style.left = c.el.style.top = ''; c.rect = null; } return; }
  for (const c of chips.values()) c.rect = null;
  for (const c of chips.values()) (c.fx < 0 ? place(c) : apply(c));
}

// ---- the host removes a player ----
function showKick(id: string, name: string): void {
  const k = $('lbKick'), c = chips.get(id);
  if (!c) return;
  for (const o of chips.values()) o.el.classList.remove('picked');
  kickFor = id; c.el.classList.add('picked');
  k.textContent = `Remove ${name}`;
  k.hidden = false;
  const r = c.el.getBoundingClientRect(), f = field().getBoundingClientRect();
  const x = Math.min(Math.max(4, r.left - f.left), f.width - k.offsetWidth - 4);
  const below = r.bottom - f.top + 4;
  const y = below + k.offsetHeight > f.height ? r.top - f.top - k.offsetHeight - 4 : below;
  k.style.left = `${x}px`; k.style.top = `${y + field().scrollTop}px`;
}
function hideKick(): void {
  $('lbKick').hidden = true;
  if (kickFor) chips.get(kickFor)?.el.classList.remove('picked');
  kickFor = null;
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
  try { s = await roomState(me.code); } catch (e) { note(`Can’t reach the room (${msgOf(e)}); trying again…`); return; }
  if (!me) return;
  // removed by the host, or the room is gone: out of the room (the code screen says so, now or when you come back)
  if (!s || !s.players.some((p) => p.id === me!.player)) {
    gone = s ? REMOVED : 'That room has closed.';
    stop();
    if (screen === 'lobby') openMultiplayer(gone);
    return;
  }
  st = s; status.state = s;
  if (first) seenRace = s.start_at !== null && serverNow() - s.start_at > JOIN_LATE_MS ? s.race_no : 0;
  if (screen === 'lobby') render();
  if (s.race_no > seenRace && s.race_seed !== null && s.start_at !== null && serverNow() - s.start_at < JOIN_LATE_MS) {
    seenRace = s.race_no;
    const raceNo = s.race_no, seed = s.race_seed, goAt = s.start_at, code = me.code, player = me.player;
    const entries = await raceEntries(code, raceNo);
    if (!me || !entries.length) return;
    starting = false;
    const setup = setupOf(code, entries, seed, goAt, player);
    if (screen === 'lobby') { show(null); hooks.race({ ...setup, raceNo }); }
    else note(`A race started while you were away (race ${raceNo}).`);
  }
}
