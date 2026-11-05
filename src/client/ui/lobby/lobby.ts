// Multiplayer (B8 rooms; B9 lobby, docs/plans/2026-11-05-lobby-and-landscape.md and reference/multiplayer-lobby-mockup.html):
// a screen of its own over the page. 1. The room code: one 4-letter field; the fourth letter checks the room and a
// real one moves straight on (or Create a room). 2. Your name, on its own screen: the room's code and how many are in,
// "What should we call you?", 1–16 characters (spaces collapsed), a name already in the room refused (the server
// checks too), a preview of your chip, Go in. 3. The lobby: the code, how many are in, the host's Start match (2 or
// more in); a field of name chips that fit their text and pop in, scattered where they overlap least (rows on a short
// screen once more than 60 are in); the host taps a name to remove that player; Leave room. The host (tracks-v2 T2):
// a "Host" tag on their chip and "Host: <name>" in the header; when the host leaves, the server hands the room to the
// player who joined earliest. The Settings panel: max players (2–100, never below the number in; the server refuses a
// join past it) and the map (the same three modes as vs CPU), set by the host, read-only for the others, locked while
// a match is on. While you are in a room it is polled every 1.5 s; when the host starts a match, every client follows
// its 5 timed rounds from the server's clock (ui/rounds/roomRounds.ts, match-flow v2 §M2): no buttons until the final
// standings, whose Play again comes back here. Joined mid-match, you watch from here until the next round's build. Your
// name is remembered on the device (`synapse.name`, as vs CPU's); closing the tab leaves the room.
import './lobby.css';
import { matchOverMs } from '../../../common/schedule';
import {
  cleanName, joinRoom, leaveRoom, mapOfState, online, openRoom, removePlayer, roomState, serverNow, setSettings, startMatch,
  ticketFor, validCode, type Me, type RoomPlayer, type RoomState, type Ticket,
} from '../../net/rooms';
import { seedOfFamily, FAMILIES } from '../../../common/sim/track';
import type { MapSetting } from '../../../common/sim/match';
import { createPicker, loadName, mapText, saveName, trackOf, type Picker } from '../tracks/tracks';
import { TrackMap } from '../training/map';
import { RACE_COLORS } from '../race/raceView';
import type { RoomMatchInfo } from '../rounds/roomRounds';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`lobby: #${id} missing`);
  return e as T;
};
const POLL_MS = 1500;
const MAX = 100;
const NAME_MAX = 16;
/** Your chip's colour: your car's yellow. The others take the race colours in join order. */
const YOU = '#ffc21a';
/** Scattered: spots tried per new chip (the one overlapping least wins). Rows instead on a short screen past ROWS_PAST. */
const TRIES = 80, ROWS_PAST = 60, PAD = 10;
const SHORT = '(max-height: 540px)';

export const NO_ROOM = 'No room with that code. Check it with the host.';
export const full = (n: number): string => `That room is full (${n} players).`;
export const REMOVED = 'The host removed you from the room.';
const taken = (n: string) => `Someone in this room is already called ${n}. Try another name.`;

export interface LobbyHooks {
  /** Multiplayer's screen is showing (hide the rest) or closed (back to the title). */
  show(on: boolean): void;
  /** The host started a match (or one is under way as you come in): follow it. */
  match(info: RoomMatchInfo): void;
  /** You are out of the room mid-match (removed, or the room closed): stop following it. */
  lost(): void;
}

type Screen = 'join' | 'name' | 'lobby';
interface Chip { id: string; el: HTMLElement; fx: number; fy: number; rect: { x: number; y: number; w: number; h: number } | null }

let me: Me | null = null;
let ticket: Ticket | null = null;
let st: RoomState | null = null;
/** The room as the name screen last saw it (its count, and the names already taken). */
let peek: RoomState | null = null;
let timer = 0, nameTimer = 0;
let seenMatch = 0;
/** Joined mid-match: the lobby says so while you watch. */
let watching = '';
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
      me: Me | null; state: RoomState | null; shown: boolean; error: string; watching: string;
      screen: Screen | null; layout: 'scatter' | 'rows'; fontPx: number;
      /** The room's settings as the panel shows them, and whether you may change them now. */
      settings: { max: number; map: MapSetting; locked: boolean; editable: boolean } | null;
    };
  }
}
const status = { me: null as Me | null, state: null as RoomState | null, shown: false, error: '', watching: '', screen: null as Screen | null, layout: layout as 'scatter' | 'rows', fontPx, settings: null as { max: number; map: MapSetting; locked: boolean; editable: boolean } | null };
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
  $('lbLeave').onclick = () => leave();
  $('lbStart').onclick = () => {
    if (!me) return;
    starting = true;
    render();
    hostStart().catch((e) => { note(`Couldn’t start: ${msgOf(e)}`); starting = false; render(); });
  };
  // the host's settings: max players as typed (Enter or leaving the field), the map from its dialog
  const max = $<HTMLInputElement>('lbMax');
  max.addEventListener('change', () => sendMax());
  max.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendMax(); } });
  $('lbMapBtn').onclick = () => openMapDialog();
  $('mdNo').onclick = () => ($('mapDlg') as HTMLDialogElement).close();
  $('mdGo').onclick = () => {
    ($('mapDlg') as HTMLDialogElement).close();
    if (mapPicker && st) send(st.max_players, mapPicker.get());
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
  else if (!err && s && s.players.length >= (s.max_players ?? MAX)) err = full(s.max_players ?? MAX);
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
  const nm = $<HTMLInputElement>('mpName');
  nm.value = nm.value.trim() || loadName(); // your name from last time (vs CPU's too)
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
    if (m === 'name taken' || m === 'room full') await refreshPeek();
    $('mpNameErr').textContent = m === 'name taken' ? taken(n) : m === 'room full' ? full(peek?.max_players ?? MAX) : `Couldn’t go in: ${m}`;
    status.error = $('mpNameErr').textContent!;
    go.disabled = false;
    syncName();
  }
}

function enter(m: Me): void {
  saveName(m.name);
  me = m; status.me = m; st = null; seenMatch = 0; watching = ''; status.watching = ''; gone = ''; starting = false;
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

/** Leave the room (its Leave room button, or Main menu after asking). */
export function leaveCurrentRoom(): void { leave(); }

function leave(): void {
  if (me) leaveRoom(me).catch((e) => console.warn('lobby: leave not sent', e));
  stop();
  show(null);
  hooks.show(false);
}

/** Show the lobby (back from building or a race), or close Multiplayer's screen. Removed meanwhile: the code screen says so. */
export function showLobby(on: boolean): void {
  if (!on) { watching = ''; status.watching = ''; show(null); return; }
  if (me) show('lobby');
  else openMultiplayer(gone);
}

/** Joined mid-match: the lobby, saying when you join in, until the round's race (roomRounds). */
export function watchMatch(text: string): void {
  watching = text; status.watching = text;
  showLobby(true);
}
/** The room's players as last polled. */
export const roomPlayers = (): RoomPlayer[] => st?.players ?? [];
/** The host's Start match: the match starts on every client from the next poll. */
async function hostStart(): Promise<void> {
  if (!me) return;
  await startMatch(me);
  await poll();
}
/** A match is on (from its start until round 5's race is over): the settings are locked, and Start match waits. */
const locked = (s: RoomState | null): boolean => !!s && s.match_at !== null && serverNow() - s.match_at < matchOverMs();

// ---- the host's settings (tracks-v2 T2) ----
let mapPicker: Picker | null = null;
let mapMap: TrackMap | null = null;
let mapShown = '';
/** Send the host's settings; the next poll shows them (refused mid-match, or below the number in: says why). */
function send(maxPlayers: number, map: MapSetting): void {
  if (!me || !me.host) return;
  setSettings(me, maxPlayers, map).then(() => poll()).catch((e) => {
    const m = msgOf(e);
    note(m === 'match on' ? 'The settings are locked while a match is on.' : m === 'max players' ? 'Max players can’t be below the number in the room.' : `Couldn’t change the settings: ${m}`);
    render();
  });
}
function sendMax(): void {
  const input = $<HTMLInputElement>('lbMax');
  if (!st || !me?.host || input.disabled) return;
  const lo = Math.max(2, st.players.length), v = Math.round(Number(input.value));
  const n = Number.isFinite(v) ? Math.max(lo, Math.min(MAX, v)) : st.max_players;
  input.value = String(n);
  if (n !== st.max_players) send(n, mapOfState(st));
}
function openMapDialog(): void {
  if (!st || !me?.host || locked(st)) return;
  if (!mapPicker) {
    mapPicker = createPicker({ kind: 'match', value: mapOfState(st), id: 'lbMapPick' });
    $('mdPick').appendChild(mapPicker.el);
  } else mapPicker.set(mapOfState(st));
  ($('mapDlg') as HTMLDialogElement).showModal();
  requestAnimationFrame(() => mapPicker?.redraw());
}
/** The Settings panel: editable for the host (unless a match is on), read-only for everyone else. */
function renderSettings(s: RoomState): void {
  const host = !!me?.host, lock = locked(s), n = s.players.length;
  $('lbSet').classList.toggle('ro', !host || lock);
  $('lbSetState').textContent = lock ? 'Locked while the match is on.' : host ? 'You’re the host: these are yours to set.' : 'Set by the host.';
  const max = $<HTMLInputElement>('lbMax');
  max.min = String(Math.max(2, n)); max.max = String(MAX);
  max.disabled = !host || lock;
  if (document.activeElement !== max) max.value = String(s.max_players);
  $('lbMaxHint').textContent = host && !lock ? `${Math.max(2, n)}–${MAX}` : '';
  const map = mapOfState(s), key = JSON.stringify(map);
  $('lbMapT').textContent = mapText(map);
  const btn = $<HTMLButtonElement>('lbMapBtn');
  btn.hidden = !host; btn.disabled = lock;
  const c = $<HTMLCanvasElement>('lbMapC');
  c.hidden = map.mode === 'each';
  if (key !== mapShown || !c.hidden) {
    mapShown = key;
    if (!c.hidden) {
      mapMap ??= new TrackMap(c);
      mapMap.setTrack(trackOf(map.mode === 'track' ? map.seed : seedOfFamily(map.family, FAMILIES.indexOf(map.family) + 1)));
      mapMap.draw([]);
    }
  }
  status.settings = { max: s.max_players, map, locked: lock, editable: host && !lock };
}

function note(t: string): void { $('lbNote').textContent = t; }

const BASE_NOTE = 'When the host starts, everyone plays 5 timed rounds together: build, train, race.';

function render(): void {
  if (!me || screen !== 'lobby') return;
  $('lbCode').textContent = me.code;
  const ps = st?.players ?? [];
  $('lbCount').textContent = `${ps.length} / ${st?.max_players ?? MAX}`;
  $('lbCountSub').textContent = ps.length === 1 ? 'player' : 'players';
  const hostP = ps.find((p) => p.host);
  $('lbHost').innerHTML = hostP ? `<span>Host</span><b></b>` : '';
  if (hostP) $('lbHost').querySelector('b')!.textContent = hostP.name;
  $('lbHost').setAttribute('aria-label', hostP ? `Host: ${hostP.name}` : '');
  $('lbHostSide').hidden = !me.host || !!watching;
  $('lbPlayerSide').hidden = me.host && !watching;
  $('lbPlayerSide').innerHTML = watching ? '<b>Watching</b>A match is on' : '<b>You\'re in</b>Waiting for the host to start';
  const start = $<HTMLButtonElement>('lbStart');
  start.disabled = starting || ps.length < 2 || locked(st);
  if (st) renderSettings(st);
  start.textContent = starting ? 'Starting…' : 'Start match';
  note(watching || (me.host && ps.length < 2 ? `${BASE_NOTE} Start when someone else is in.` : BASE_NOTE));
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
  const fresh: Chip[] = [], moved: Chip[] = [];
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
    c.el.className = `chip${mine ? ' me' : ''}${p.host ? ' host' : ''}${host && !mine ? ' tap' : ''}${kickFor === p.id ? ' picked' : ''}`;
    // the host's tag, before the name (the name stays the chip's last part); it moves with the host
    const tag = c.el.querySelector('b.tag');
    if (p.host && !tag) { const b = document.createElement('b'); b.className = 'tag'; b.textContent = 'Host'; c.el.insertBefore(b, c.el.lastChild); if (layout === 'scatter' && c.fx >= 0) moved.push(c); }
    else if (!p.host && tag) tag.remove();
    c.el.style.setProperty('--c', col.get(p.id)!);
    c.el.style.zIndex = String(k + 1);
    c.el.title = `${p.name}${p.host ? ' (host)' : ''}`;
  });
  const before = fontPx, mode = layout;
  fit(ps.length);
  if (layout !== mode || Math.abs(fontPx - before) > 0.4) relayout();
  else if (layout === 'scatter') { for (const c of fresh) place(c); for (const c of moved) apply(c); }
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

async function poll(first = false): Promise<void> {
  if (!me) return;
  let s: RoomState | null;
  try { s = await roomState(me.code); } catch (e) { note(`Can’t reach the room (${msgOf(e)}); trying again…`); return; }
  if (!me) return;
  // removed by the host, or the room is gone: out of the room (the code screen says so, now or when you come back)
  if (!s || !s.players.some((p) => p.id === me!.player)) {
    gone = s ? REMOVED : 'That room has closed.';
    const playing = screen !== 'lobby' || !!watching;
    stop();
    if (playing) hooks.lost();
    if (screen === 'lobby' || playing) openMultiplayer(gone);
    return;
  }
  st = s; status.state = s;
  // the host can change (the server hands the room on when the host leaves)
  const host = s.players.find((p) => p.id === me!.player)!.host;
  if (host !== me.host) { me.host = host; hideKick(); }
  // a match already over as you come in is not yours; one under way is (you watch until the next round's build)
  if (first && s.match_at !== null && serverNow() - s.match_at >= matchOverMs()) seenMatch = s.match_no;
  if (screen === 'lobby') render();
  if (s.match_no > seenMatch && s.match_at !== null && s.match_seed !== null) {
    seenMatch = s.match_no;
    starting = false; watching = ''; status.watching = '';
    hooks.match({ me: me, matchNo: s.match_no, seed: s.match_seed, at: s.match_at, map: mapOfState(s) });
  }
}
