// The music (docs/plans/2026-11-04-sound.md; reference implementation of the phrase engine: reference/sound-test.html).
// Three tracks, each on its own gain (levels from music.json, all measured to the same loudness):
// - lounge: the sandbox designer's music ("Airport Lounge", 130 BPM), a 128-bar loop joined on itself with the same
//   one-beat cross-fade the phrase engine uses.
// - race (and build): one 152 BPM track cut into ten 8-bar phrases, scheduled on the bar grid about a second ahead.
//   Neighbours in the original join seamlessly (a short splice); jumps cross-fade over one beat on the downbeat. Build
//   (intro ↔ breakdown) plays on the title screen; race runs drive → lift → push → soar and round again.
//   A race start jumps into the intro's build-up (bar 4) and gets back the time of the drop (Go), with the countdown
//   every two beats before it.
// - winner: plays once when the player wins (win(); nothing calls it until matches exist), then back to the mode's music.
// Between tracks (principal 2026-11-04: "smoothly but quickly transitioning between tracks"): an equal-power
// cross-fade of about 0.6 s, centred on the next beat of the outgoing track; a race start from the lounge starts the
// intro's build-up (bar 4) on that beat, so Go still lands on the drop. Same-track joins stay as they are.
// The title's quiet pool is fetched first, then the lounge, then the rest; decoding waits for the first gesture, and
// the music never stops after that.
import meta from '../../assets/music/music.json';
import { audio, whenReady, type Buses } from './audio';
import { blip } from './sfx';

export type Mode = 'lounge' | 'build' | 'race';
type Join = 'butt' | 'xfade';
interface Voice { src: AudioBufferSourceNode; g: GainNode }
interface Playing extends Voice { name: string; at: number; bar0: number; end: number }

const URLS = import.meta.glob('../../assets/music/*.mp3', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const urlOf = (file: string): string => {
  const u = URLS[`../../assets/music/${file}`];
  if (!u) throw new Error(`music: no file ${file}`);
  return u;
};

export const BEAT = meta.beat, BAR = meta.bar, PRE = meta.pre;
const PHRASE_BARS = meta.bars;
const L = meta.tracks.lounge;
const LOUNGE_LOOP = L.bars * 4 * L.beat; // s
const XFADE = 0.6, WIN_FADE = XFADE; // s: a cross-fade between different tracks
// what follows what; "natural" pairs were next to each other in the original, so they join seamlessly
const NEXT: Record<'build' | 'race', Record<string, string>> = {
  build: { intro: 'breakdown', breakdown: 'intro' },
  race: {
    'drive-a': 'drive-b', 'drive-b': 'lift-a', 'lift-a': 'lift-b', 'lift-b': 'push-a', 'push-a': 'push-b',
    'push-b': 'soar-a', 'soar-a': 'soar-b', 'soar-b': 'drive-a', intro: 'drive-a', breakdown: 'intro',
  },
};
const NATURAL = new Set(['breakdown>intro', 'intro>drive-a', 'drive-a>drive-b', 'drive-b>lift-a', 'lift-a>lift-b', 'lift-b>push-a', 'push-a>push-b', 'push-b>soar-a', 'soar-a>soar-b']);

let mode: Mode = 'build';
/** The phrase engine: current and queued phrase (null while the lounge or the winner has the floor). */
let cur: Playing | null = null, nxt: Playing | null = null;
/** The lounge loop: current copy and when it ends (null when not playing). */
let lounge: (Voice & { start: number; end: number }) | null = null;
let winner: (Voice & { end: number }) | null = null;
let race: RaceStart | null = null;
const files = new Map<string, Promise<ArrayBuffer>>();
const buffers = new Map<string, AudioBuffer>();
let bus: { race: GainNode; lounge: GainNode; winner: GainNode } | null = null;
let phrasesReady = false, buildReady = false, started = false;

const fetchBuf = (file: string): Promise<ArrayBuffer> => fetch(urlOf(file)).then((r) => {
  if (!r.ok) throw new Error(`music: ${file} ${r.status}`);
  return r.arrayBuffer();
});

const BUILD = ['intro', 'breakdown'];
/** Start fetching (call after first paint; it never blocks the page): the title's pool, then the lounge, then the rest. */
export function preloadMusic(): void {
  if (files.size) return;
  const fileOf = (name: string) => (meta.phrases.find((p) => p.name === name) as { file: string }).file;
  for (const n of BUILD) files.set(n, fetchBuf(fileOf(n)));
  const first = Promise.all(BUILD.map((n) => files.get(n))).catch(() => undefined);
  const lounge = first.then(() => fetchBuf(L.file));
  files.set('lounge', lounge);
  const later = lounge.catch(() => undefined);
  for (const p of meta.phrases) if (!files.has(p.name)) files.set(p.name, later.then(() => fetchBuf(p.file)));
  files.set('winner', later.then(() => fetchBuf(meta.tracks.winner.file)));
  whenReady((b) => { void begin(b); });
}

const dbGain = (db: number): number => Math.pow(10, db / 20);

async function decode(b: Buses, name: string): Promise<void> {
  buffers.set(name, await b.ctx.decodeAudioData(await (files.get(name) as Promise<ArrayBuffer>)));
}

async function begin(b: Buses): Promise<void> {
  if (started) return;
  started = true;
  const g = (db: number) => { const n = b.ctx.createGain(); n.gain.value = dbGain(db); n.connect(b.music); return n; };
  bus = { race: g(meta.tracks.race.gainDb), lounge: g(L.gainDb), winner: g(meta.tracks.winner.gainDb) };
  setInterval(tick, 50);
  // each track starts as soon as the screen's own music is decoded; the rest follows
  await Promise.all(BUILD.map((n) => decode(b, n)));
  buildReady = true;
  if (mode === 'build' && !cur) cur = play('intro', b.ctx.currentTime + 0.3, 0, 'butt');
  await decode(b, 'lounge');
  // the sandbox may have been opened while the lounge was still decoding: the build pool played on until now
  if (mode === 'lounge' && !lounge && !winner) { if (cur) toLounge(); else startLounge(b.ctx.currentTime + 0.3, 0.02); }
  await Promise.all(meta.phrases.filter((p) => !BUILD.includes(p.name)).map((p) => decode(b, p.name)));
  phrasesReady = true;
  if (mode === 'race' && !cur) enterPhrases('race');
  await decode(b, 'winner');
}

/** True once the mode's music is running. */
export const musicPlaying = (): boolean => winner !== null || (mode === 'lounge' ? lounge !== null : cur !== null);
/** True once every track is decoded. */
export const musicReady = (): boolean => phrasesReady && buffers.has('winner');
export const musicMode = (): Mode => mode;
export const phraseNow = (): string | null => (winner ? 'winner' : lounge ? 'lounge' : cur?.name ?? null);
export const winnerSeconds = (): number => buffers.get('winner')?.duration ?? 0;

const curve = (up: boolean): Float32Array => {
  const c = new Float32Array(64);
  for (let i = 0; i < 64; i++) { const t = i / 63; c[i] = up ? Math.sin((t * Math.PI) / 2) : Math.cos((t * Math.PI) / 2); }
  return c;
};

const need = (): Buses => { const b = audio(); if (!b) throw new Error('music: no audio yet'); return b; };
const now = (): number => need().ctx.currentTime;

/** Start buffer `name` on `out` so that its offset `off` is heard at `when`, fading in equal-power over `fade` s from `at`. */
function voice(name: string, out: AudioNode, at: number, off: number, fade: number): Voice {
  const { ctx } = need();
  const buf = buffers.get(name);
  if (!buf) throw new Error(`music: ${name} not decoded`);
  const src = ctx.createBufferSource(), g = ctx.createGain();
  src.buffer = buf; src.connect(g).connect(out);
  g.gain.setValueAtTime(0, at);
  g.gain.setValueCurveAtTime(curve(true), at, fade);
  const t = ctx.currentTime;
  src.start(Math.max(at, t), Math.max(0, off + Math.max(0, t - at)));
  return { src, g };
}

/**
 * Fade a voice out equal-power over `dur` s from `at`, then stop it. A fade-in still running is cut where it stands
 * (held, not jumped), and the fade-out starts from that level, so nothing clicks.
 */
function release(v: Voice, at: number, dur: number): void {
  const t = now(), a = Math.max(at, t), gp = v.g.gain;
  const level = a > t + 0.01 ? 1 : gp.value;
  if (gp.cancelAndHoldAtTime) gp.cancelAndHoldAtTime(a); else { gp.cancelScheduledValues(a); gp.setValueAtTime(level, a); }
  const c = curve(false).map((x) => x * level);
  gp.setValueCurveAtTime(c, a + 0.001, dur);
  try { v.src.stop(a + dur + 0.05); } catch { /* already stopping */ }
}

// ---- the phrase engine (race, build) ----

/** Play phrase `name` so that its bar `fromBar` lands on context time `when` (join 'track': a cross-track fade-in). */
function play(name: string, when: number, fromBar = 0, join: Join | 'track' = 'butt'): Playing {
  const lead = join === 'track' ? XFADE / 2 : join === 'xfade' ? BEAT / 2 : 0.012;
  const v = voice(name, (bus as NonNullable<typeof bus>).race, when - lead, PRE + fromBar * BAR - lead, lead * 2 > 0.03 ? lead * 2 : 0.024);
  return { ...v, name, at: when, bar0: when - fromBar * BAR, end: when + (PHRASE_BARS - fromBar) * BAR };
}

function fadeOut(p: Playing, when: number, join: Join): void {
  const lead = join === 'xfade' ? BEAT / 2 : 0.012, at = when - lead, dur = join === 'xfade' ? BEAT : 0.024;
  p.g.gain.cancelScheduledValues(at);
  p.g.gain.setValueAtTime(1, at);
  p.g.gain.setValueCurveAtTime(curve(false), at, dur);
  p.src.stop(at + dur + 0.05);
}

/** Drop a queued phrase and undo the current one's queued fade-out, so it can carry on or be re-joined. */
function cancelNext(): void {
  if (!nxt || !cur) return;
  try { nxt.src.stop(); } catch { /* not started */ }
  nxt = null;
  const t = now() + 0.02, gp = cur.g.gain;
  if (gp.cancelAndHoldAtTime) gp.cancelAndHoldAtTime(t); else gp.cancelScheduledValues(t);
  gp.setValueAtTime(1, t + 0.01);
  try { cur.src.stop(cur.end + 2 * BEAT); } catch { /* already stopping */ }
}

/** The next beat of the track playing now (the lounge's or the race track's), at least 0.1 s away. */
function nextBeat(): number {
  const t = now() + 0.1;
  if (lounge) return lounge.start + Math.ceil((t - lounge.start) / L.beat) * L.beat;
  if (cur) return cur.bar0 + Math.ceil((t - cur.bar0) / BEAT) * BEAT;
  return t;
}

/** The next bar line (every `every` bars) of the current phrase at least `min` s away. */
function nextBar(min = 0.15, every = 1): number {
  const c = cur as Playing;
  const k = Math.ceil((now() + min - c.bar0) / (BAR * every));
  return c.bar0 + k * every * BAR;
}

/** Into the intro's build-up on the next bar (or carry on if already in it); returns that intro's bar 0. */
function intoBuildUp(): number {
  const c = cur as Playing, into = (now() - c.bar0) / BAR;
  if (c.name === 'intro' && into >= 3.9 && into < 5.4) { cancelNext(); return c.bar0; }
  const t = nextBar();
  cancelNext();
  fadeOut(c, t, 'xfade');
  c.end = t;
  nxt = play('intro', t, 4, 'xfade');
  return nxt.bar0;
}

/**
 * The phrase engine takes over in mode m (from the lounge, or from silence): on the lounge's next beat, race starts the
 * intro at bar 4 (its build-up, then the drop) and build the intro from its start, with a 0.6 s cross-fade. Returns
 * the intro's bar 0.
 */
function enterPhrases(m: 'build' | 'race'): number {
  const t = lounge ? nextBeat() : now() + 0.1;
  if (lounge) { release(lounge, t - XFADE / 2, XFADE); lounge = null; }
  cur = play('intro', t, m === 'race' ? 4 : 0, 'track');
  nxt = null;
  return cur.bar0;
}

// ---- the lounge ----

/** A copy of the lounge loop heard from its loop start at `when`, fading in over `fade` s centred on it. */
function startLounge(when: number, fade: number): void {
  const lead = Math.min(fade / 2, L.pre);
  const v = voice('lounge', (bus as NonNullable<typeof bus>).lounge, when - lead, L.pre - lead, fade);
  lounge = { ...v, start: when, end: when + LOUNGE_LOOP };
}

/** The phrase engine hands over to the lounge: a 0.6 s cross-fade centred on the outgoing track's next beat. */
function toLounge(): void {
  const c = cur as Playing, t = nextBeat();
  cancelNext();
  release(c, t - XFADE / 2, XFADE);
  cur = null;
  startLounge(t, XFADE);
}

/** The scheduler: keeps the next phrase (or the next lounge copy) queued about a second ahead. */
function tick(): void {
  const b = audio();
  if (!b || !bus) return;
  const t = b.ctx.currentTime;
  if (winner) {
    if (t >= winner.end - WIN_FADE - 0.05) { const w = winner; winner = null; release(w, t, WIN_FADE); resume(WIN_FADE); }
    return;
  }
  if (lounge && lounge.end - t < 1.2) {
    // the loop joins itself with a one-beat cross-fade on the phrase line
    const old = lounge, at = old.end - L.beat / 2;
    release(old, at, L.beat);
    const v = voice('lounge', bus.lounge, at, L.pre - L.beat / 2, L.beat);
    lounge = { ...v, start: old.end, end: old.end + LOUNGE_LOOP };
  }
  if (!cur) return;
  if (!nxt && cur.end - t < 1.2 && (mode === 'race' || mode === 'build')) {
    const name = NEXT[mode][cur.name] ?? (mode === 'race' ? 'drive-a' : 'breakdown');
    const join: Join = NATURAL.has(`${cur.name}>${name}`) ? 'butt' : 'xfade';
    fadeOut(cur, cur.end, join);
    nxt = play(name, cur.end, 0, join);
  }
  if (nxt && t >= nxt.at) { cur = nxt; nxt = null; }
}

/** The mode's music again, fading in over `fade` s (after the winner). */
function resume(fade: number): void {
  if (mode === 'lounge') { if (buffers.has('lounge')) startLounge(now() + fade, fade); return; }
  if (mode === 'race' ? !phrasesReady : !buildReady) return;
  const t = now() + fade;
  cur = mode === 'race' ? play('drive-a', t, 0, 'track') : play('breakdown', t, 0, 'track');
  nxt = null;
}

/**
 * Title = build (the race track's quiet pool); sandbox designer = lounge; training and drive = race. Before the music
 * has started, it only records the mode to start in.
 */
export function setMode(m: Mode): void {
  if (m === mode) return;
  const was = mode;
  mode = m;
  race = null;
  if (!bus || winner) return; // not started yet, or the winner hands over when it ends
  tick();
  if (m === 'lounge') {
    if (!cur) { if (!lounge && buffers.has('lounge')) startLounge(now() + 0.1, XFADE); return; }
    if (buffers.has('lounge')) toLounge(); // else still decoding: the phrase engine plays on, begin() crosses when ready
    return;
  }
  if (m === 'race' ? !phrasesReady : !buildReady) return; // begin() enters the phrase engine once they are decoded
  if (was === 'lounge' || !cur) { enterPhrases(m); return; }
  if (m === 'race') { intoBuildUp(); return; }
  // race → build: into the breakdown at the next half-phrase (4-bar) line
  const t = nextBar(0.15, 4);
  cancelNext();
  if (t >= cur.end - 0.01) return; // the phrase ends there anyway: the scheduler takes it
  fadeOut(cur, t, 'xfade');
  cur.end = t;
  nxt = play('breakdown', t, 0, 'xfade');
}

export interface RaceStart { ticks: number[]; go: number }

/** Forget a race start in progress (leaving a race: its blips are cancelled by sfx, so a new start must not share it). */
export function cancelRace(): void { race = null; }

/**
 * A race start that follows the music: into the intro's build-up, countdown blips every two beats from bar 6 beat 3,
 * Go on the drop. Returns the context times of 5, 4, 3, 2, 1 and Go, or null if the race music can't play yet.
 */
export function startRace(): RaceStart | null {
  if (!bus || !phrasesReady || winner) return null;
  tick();
  if (race && race.go > now()) return race; // a countdown is already running: share it
  const bar0 = mode !== 'race' || !cur ? (mode = 'race', enterPhrases('race')) : intoBuildUp();
  const go = bar0 + PHRASE_BARS * BAR;
  const ticks = [0, 1, 2, 3, 4].map((i) => go - (10 - 2 * i) * BEAT);
  race = { ticks, go };
  ticks.forEach((t) => blip(t, false));
  blip(go, true);
  return race;
}

/** The player won: the winner music cross-fades in over 0.5 s, plays once, then the mode's music comes back. */
export function win(): void {
  if (!bus || !buffers.has('winner') || winner) return;
  const t = now();
  if (lounge) { release(lounge, t, WIN_FADE); lounge = null; }
  if (cur) { if (nxt) { try { nxt.src.stop(); } catch { /* not started */ } nxt = null; } release(cur, t, WIN_FADE); cur = null; }
  race = null;
  const v = voice('winner', bus.winner, t, 0, WIN_FADE);
  winner = { ...v, end: t + (buffers.get('winner') as AudioBuffer).duration };
}
