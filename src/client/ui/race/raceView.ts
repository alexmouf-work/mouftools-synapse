// The race view (B7 vs CPU, B8 Multiplayer; tracks plan §4 and the coordinator's vs CPU calls of 2026-11-05): up to
// 100 cars on a race track drawn from the race seed. The whole race is computed first (common/sim/match.ts runRace, the
// same function a Node replay or any other client uses, so every client sees the same race), then played back in real
// time: the grid two by two behind the line with the players listed, "5, 4, 3, 2, 1, Go" (vs CPU: the drive view's
// countdown on the music's beat; a room: Go at the moment the server set, so every client starts together), then a
// room's 2 laps capped at 120 s or a vs CPU round's 30 s (rounds plan 2026-11-05: no laps, scored by the signed distance
// covered), with the standings in the sidebar over a map of every car (sidebar plan 2026-11-05: places 1–3 and the
// racers nearest you, 10 rows) and your live brain in the camera's corner; then the results (a room) or the round's
// standings (vs CPU, shown by ui/rounds). Distances are signed (ruling 2026-11-05). A car going the wrong way for 3 s is put back by the sim (race.ts putBack); "Wrong way"
// flashes over your car from 1 s of it until 1 s after. Your car is the drive view's yellow car (no beams: match-flow v2); the nearest others (at most MAX_RIVALS) are solid
// cars in their own colours, the rest only dots on the map. Cars pass through each other. Finishing first plays the
// winner music.
import cpuData from '../../../assets/cpu/brains.json';
import { CONFIG } from '../../../common/config';
import { compile, nodeRate, type Net } from '../../../common/sim/brain';
import { CPU_NAMES, cpuRounds } from '../../../common/sim/cpu';
import { gridCar, LAPPED, rank, recordCar, ROUND_RACE, runRace, type RaceLength, type RaceResult } from '../../../common/sim/match';
import type { Recording } from '../../../common/sim/race';
import type { Genome } from '../../../common/sim/spec';
import { MAX_RIVALS, type DrivePose, type RivalPose } from '../../render/drive';
import type { Stage } from '../../render/stage';
import { sampleOf } from '../../render/trackMesh';
import type { Dot } from '../../render/ghosts';
import { countdownTo, raceCountdown } from '../../audio/countdown';
import { win } from '../../audio/music';
import { Engine } from '../../audio/sfx';
import { getStage, hideArena, showArena } from '../arena';
import type { Saved } from '../designer/store';
import { TrackMap } from '../training/map';
import { BrainPanel } from '../drive/brainPanel';
import { SpikeTrains } from '../drive/spikes';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`race: #${id} missing`);
  return e as T;
};
const HZ = CONFIG.tick.hz, M = CONFIG.match;
const RESULTS_AFTER_S = CONFIG.rounds.hold; // the cars hold this long after the race ends, then the results show
const LISTED = 10; // racers list rows: places 1–3, then the racers nearest you (sidebar plan 2026-11-05)
const WRONG_WAY = M.wrongWayTicks;
const WRONG_SHOW = HZ; // "Wrong way" shows once progress has fallen this many ticks, and this long after the reset
const YOU = '#ffc21a';
/** The other cars' colours, in entry order (cycled past ten). Yellow is yours. */
export const RACE_COLORS = ['#e8475f', '#3f8cff', '#2fc28a', '#b46cff', '#ff8a3d', '#29c6d6', '#f06bc1', '#9aa3b5', '#6fd14a', '#5b6cff'];
const fmtT = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;
const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const ord = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
/** Distance as shown: signed (ruling 2026-11-05: going backwards counts as negative). */
export const shownDist = (m: number): number => m;
/** "1.23 km", "−0.05 km". */
export const fmtKm = (m: number): string => { const v = (Math.abs(m) / 1000).toFixed(2); return `${m < 0 && v !== '0.00' ? '−' : ''}${v} km`; };
/**
 * Which standings rows the sidebar lists (indices into the order): all of them up to `rows`; otherwise places 1–3, then
 * the rows nearest place p (yours), `rows` in all; `gap` is true where the two groups don't meet (a "⋯" row goes there).
 */
export function listRows(n: number, p: number, rows = LISTED): { idx: number[]; gap: boolean } {
  if (n <= rows) return { idx: Array.from({ length: n }, (_, i) => i), gap: false };
  const k = rows - 3, start = Math.max(3, Math.min(p - Math.floor(k / 2), n - k));
  return { idx: [0, 1, 2, ...Array.from({ length: k }, (_, i) => start + i)], gap: start > 3 };
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/**
 * A results or standings table's rows (principal 2026-11-05: "only show 10 racers at a time"): the sidebar's rule
 * (listRows) on the table's own order, `you` the index of your row (−1 watching: the top 10); a "⋯" row where places
 * 1–3 and the rows nearest you don't meet. `row(i)` renders the row at index i of the order.
 */
export function tableRows(n: number, you: number, row: (i: number) => string, cols = 4): string {
  const L = listRows(n, Math.max(0, you));
  return L.idx.map((i, j) => `${L.gap && j === 3 ? `<tr class="gap" aria-hidden="true"><td colspan="${cols}">⋯</td></tr>` : ''}${row(i)}`).join('');
}

/** One race to show: who drives (in entry order), which car is yours (−1: watching), the seed, and for a room when Go is. */
export interface RaceSetup {
  kind: 'cpu' | 'room';
  title: string;
  names: string[];
  genomes: Genome[];
  me: number;
  raceSeed: number;
  /** The track's seed, if the match's map chose it (else the race seed's own). */
  trackSeed?: number;
  /** A room's Go (performance.now() ms), the same moment on every client; vs CPU counts down on the music. */
  goAt?: number;
  /** A room's race number (its result is reported with it). */
  raceNo?: number;
  /** Laps in a capped time, or a timed race (a round, vs CPU or a room's). */
  len?: RaceLength;
  /** The race already computed with these genomes, seed and length (recording car `me`): not run again. */
  result?: RaceResult;
}
export interface RaceRow { name: string; place: number; finish: number | null; prog: number; slot: number; dist: number }
export interface RaceStatus {
  state: 'grid' | 'racing' | 'results';
  kind: 'cpu' | 'room'; me: number;
  raceSeed: number; trackSeed: number; family: string; hash: string; names: string[];
  /** Grid slot of each car (entry order). */
  slots: number[];
  /** Final standings, best first (known from the start: the race is computed before it plays). */
  results: RaceRow[];
  /** Your place (0 when watching), and whether the winner music was asked for. */
  place: number; won: boolean;
  /** Main-thread ms the race took to compute. */
  computeMs: number;
  /** Playback time (s from Go), the race's end (s), frames drawn, whether Go has passed. */
  t: number; end: number; frames: number; go: boolean; webgl: boolean; goAt: number;
  countdown: string; countdownSeen: string[]; countdownMusic: boolean;
  /** "Wrong way" is showing over your car this frame. */
  wrongWay: boolean;
  /** The players in order now ('Grid' before Go, then the standings): names; and the rows the sidebar shows ("⋯" a gap). */
  listed: () => string[];
  shown: () => string[];
  /** Cars drawn in 3-D (yours or the one followed, then the others) as world [x, y, z, visible, car index], and map dots. */
  drawn: () => number[][]; dots: () => number;
  seek(seconds: number): void;
  /** Checks only: true holds the playback where it is (the clock stops; frames still draw). */
  hold: boolean;
  /**
   * Following a racer (follow-a-racer plan): the car the camera and the brain card follow, the card's title and its
   * values this frame, your own brain's values this frame (null watching), how far the camera's aim is from the
   * followed car (m), the camera's mode and its cuts (s on the camera's clock, and why).
   */
  following: () => number; cardTitle: () => string; cardVals: () => number[] | null; ownVals: () => number[] | null;
  lookOff: () => number; cam: () => { mode: string; cuts: { t: number; why: string }[] };
  /** Where car k's dot is on the sidebar map (CSS px in the page), or null. */
  dotAt: (k: number) => { x: number; y: number } | null;
  /** Seek, snap the camera, draw that frame and audit bloom on it (deterministic). */
  auditAt(seconds: number, mask?: boolean): { over: number; max: number; mask?: string };
  probe?: () => { mean: number; sd: number; w: number; h: number };
}
declare global { interface Window { __race?: RaceStatus } }
export interface RaceHooks {
  back(): void;
  /** Another race with the same brain. */
  again?(): void;
  /** Called once at Go. */
  go?(): void;
  /** A vs CPU round: called once when the race is over, instead of the results (the round's standings follow). */
  ended?(race: RaceResult): void;
  /** Called once when the results show: your row (or null when watching). */
  result?(row: RaceRow | null): void;
}

function newSeed(): number { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0]; }
/** `?race=` (the checks) picks the first vs CPU race's seed; Race again always draws a new one. */
export function firstSeed(): number {
  const q = new URLSearchParams(location.search).get('race');
  return q !== null && /^\d+$/.test(q) ? Number(q) : newSeed();
}
/**
 * A vs CPU round's race (round 1–5): you (car 0, under your name) and the nine CPU players' brains for that round, 30 s,
 * on the track the match's map gives (tracks-v2 T2; the race seed's own by default).
 */
export function roundSetup(saved: Saved, round: number, raceSeed: number, o: { name?: string; trackSeed?: number } = {}): RaceSetup {
  const cpu = cpuRounds(cpuData)[round - 1];
  return { kind: 'cpu', title: `Round ${round} of ${CONFIG.rounds.count}`, names: [o.name ?? 'You', ...CPU_NAMES], genomes: [saved.genome, ...cpu.map((b) => b.genome)], me: 0, raceSeed, trackSeed: o.trackSeed, len: ROUND_RACE };
}
export const newRaceSeed = newSeed;

let raf = 0;
let map: TrackMap | null = null;
/** Leaving now (Main menu): whatever the open race needs to stop. */
let leaveNow: () => void = () => undefined;
export function leaveRace(): void { leaveNow(); leaveNow = () => undefined; }

export async function openRace(setup: RaceSetup, hooks: RaceHooks): Promise<void> {
  cancelAnimationFrame(raf);
  showArena('race');
  const { names, genomes, me, raceSeed } = setup, n = genomes.length;
  const c0 = performance.now();
  const len = setup.len ?? LAPPED, timed = len.laps === 0;
  const race: RaceResult = setup.result ?? runRace(genomes, raceSeed, (k) => k === me, len, setup.trackSeed);
  const computeMs = performance.now() - c0;
  const { track, cars } = race;
  // the car the camera and the brain card follow (follow-a-racer plan): yours (watching: the first) until you pick
  // another in the racers list or on the map; every race starts on yours again
  const mine = me >= 0, own = mine ? me : 0;
  let follow = own, picked = false;
  const rec0 = cars[own].rec, end = race.endTicks / HZ, goal = len.laps * track.len;
  /** Each followed car's run with its brain's activity (yours is recorded by the race; another's is replayed once). */
  const recs = new Map<number, Recording>();
  if (mine) recs.set(me, rec0);
  const recOf = (k: number): Recording => { let r = recs.get(k); if (!r) { r = recordCar(genomes[k], track, cars[k].slot, len); recs.set(k, r); } return r; };
  const results: RaceRow[] = race.ranking.map((k, i) => ({ name: names[k], place: i + 1, finish: cars[k].finish, prog: cars[k].prog, slot: cars[k].slot, dist: cars[k].dist }));
  const place = mine ? race.ranking.indexOf(me) + 1 : 0;
  const grid = cars.map((c) => gridCar(track, c.slot));
  const colorOf = (k: number) => (k === me ? YOU : RACE_COLORS[(mine && k > me ? k - 1 : k) % RACE_COLORS.length]);
  const R = Math.min(MAX_RIVALS, n - 1);

  const stage: Stage | null = await getStage();
  if (stage) {
    await stage.setTrack(track, 'drive');
    stage.drive.setRivals(R);
    stage.drive.setMode('chase', reduce());
  }
  map ??= new TrackMap($('rcMap') as HTMLCanvasElement);
  map.setTrack(track);
  $('rcTitle').textContent = setup.title;
  $('rcResults').hidden = true;
  $('rcAgain').hidden = !hooks.again;
  $('rcBack').textContent = setup.kind === 'room' ? 'Back to room' : 'Back';
  $('rcCars').textContent = `${n} cars`;
  $('rcLapK').textContent = timed ? 'Distance' : 'Lap';
  $('rcLeave').hidden = !!hooks.ended; // a round: Main menu leaves the match
  // your live brain in the camera's corner (sidebar plan): its nodes are recorded for your car only
  // the corner brain card: the followed racer's brain, firing as in the replay
  interface Card { k: number; net: Net; rec: Recording; nN: number; panel: BrainPanel; spikes: SpikeTrains; every: Uint8Array; rates: Float64Array; vals: Float64Array }
  let card: Card | null = null;
  const setCard = (k: number) => {
    const show = mine || picked;
    $('rcBrainC').hidden = !show;
    $('rcBrainT').textContent = k === me ? 'Brain · live' : `Brain · ${names[k]}`;
    if (!show) { card = null; return; }
    const net = compile(genomes[k]), nN = net.nNodes;
    card = { k, net, rec: recOf(k), nN, panel: new BrainPanel($('rcBrain') as HTMLCanvasElement, net), spikes: new SpikeTrains(nN), every: new Uint8Array(nN).fill(1), rates: new Float64Array(nN), vals: new Float64Array(nN) };
  };
  setCard(own);
  /** Your brain's values this frame (checks: the followed card's must differ). */
  const ownN = mine ? compile(genomes[me]).nNodes : 0, ownNow = new Float64Array(ownN);
  /** Follow car k: the camera glides (chase) or cuts (broadcast) to it, the card shows its brain, its row is outlined. */
  const followCar = (k: number) => {
    if (!Number.isInteger(k) || k < 0 || k >= n) return;
    picked = true;
    if (k !== follow) { follow = k; stage?.drive.glide(0.4); stage?.drive.setCarColor(colorOf(k)); }
    if (card?.k !== k) setCard(k);
    $('rcMine').hidden = !mine || follow === me;
    lastUi = -1;
  };
  stage?.drive.setCarColor(colorOf(follow));
  $('rcMine').hidden = true;
  $('rcMine').onclick = () => followCar(me);
  const rows = listOf($('rcList') as HTMLOListElement);
  $('rcList').onclick = (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-k]'); if (b) followCar(Number(b.dataset.k)); };
  ($('rcMap') as HTMLCanvasElement).onclick = (e) => {
    const r = $('rcMap').getBoundingClientRect(), k = map ? map.nearest(e.clientX - r.left, e.clientY - r.top, dots) : -1;
    if (k >= 0) followCar(k);
  };
  const engine = new Engine(mine ? 1 : 0.35), cd = setup.goAt !== undefined ? countdownTo(setup.goAt) : raceCountdown();
  let timers: number[] = [];
  const showCount = (label: string) => {
    status.countdown = label;
    if (label) status.countdownSeen.push(label);
    $('rcCount').textContent = label;
  };
  const scheduleCount = () => {
    const now = performance.now();
    timers = [...cd.at.map((t, i) => [t, String(5 - i)] as const), [cd.go, 'Go'] as const, [cd.go + 800, ''] as const]
      .filter(([t]) => t >= now - 1).map(([t, l]) => window.setTimeout(() => showCount(l), Math.max(0, t - now)));
  };
  const endCount = () => { cd.go = Math.min(cd.go, performance.now()); timers.forEach(clearTimeout); timers = []; showCount(''); };

  const wheels = new Float64Array(4);
  // no lasers (match-flow v2 plan §5): the car draws no boundary-cell beams
  const pose: DrivePose = { x: 0, y: 0, hdg: 0, v: 0, idx: track.startIdx, f: track.startIdx, wheels, beams: [], stuck: false };
  const poses = cars.map(() => ({ x: 0, y: 0, hdg: 0, v: 0, f: 0 }));
  const rivals: RivalPose[] = Array.from({ length: R }, () => ({ x: 0, y: 0, hdg: 0, v: 0, f: 0, on: true, color: YOU }));
  /** Which car each rival slot shows this frame. */
  const drawnIdx = new Int32Array(R).fill(-1);
  const dots: Dot[] = cars.map(() => ({ x: 0, y: 0, hl: false, alpha: 1, deck: 0 }));
  const progNow = new Float64Array(n), dist = new Float64Array(n);
  /** Signed distance as listed: from the line (laps), or covered since the grid (a timed race). */
  const shownOf = (k: number) => (timed ? progNow[k] - grid[k].prog : progNow[k]);
  // late (a room's race already under way): join it where it is
  let playT = Math.max(0, (performance.now() - cd.go) / 1000), frames = 0, shown = false, won = false, lastUi = -1;
  /** Car k at playback time pt (s from Go; before Go, on its grid slot), into out; returns the recording index or −1. */
  const at = (k: number, pt: number, out: { x: number; y: number; hdg: number; v: number; f: number }) => {
    const r = cars[k].rec, g = grid[k];
    if (pt <= 0) {
      out.x = g.x; out.y = g.y; out.hdg = g.hdg; out.v = 0; out.f = sampleOf(track, g.prog); progNow[k] = g.prog;
      return -1;
    }
    // recording j is the state after tick j + 1; time 0 is the grid
    // a car put back (wrong way) jumps when its tick lands, without gliding there
    const kf = Math.min(pt * HZ, r.ticks) - 1, j = Math.floor(kf), b = Math.min(j + 1, r.ticks - 1), a = Math.max(j, 0);
    const u = b !== a && r.wrong[b] >= WRONG_WAY ? 0 : kf - j;
    const x0 = j < 0 ? g.x : r.x[a], y0 = j < 0 ? g.y : r.y[a], h0 = j < 0 ? g.hdg : r.hdg[a], p0 = j < 0 ? g.prog : r.prog[a];
    out.x = x0 + (r.x[b] - x0) * u; out.y = y0 + (r.y[b] - y0) * u;
    let dh = r.hdg[b] - h0; dh -= 2 * Math.PI * Math.round(dh / (2 * Math.PI));
    out.hdg = h0 + dh * u;
    out.v = r.v[b];
    const p = p0 + (r.prog[b] - p0) * u;
    progNow[k] = p;
    out.f = sampleOf(track, p);
    return b;
  };
  /** Standings at playback time pt: cars that have finished by then by finish time, the rest by progress. */
  const standings = (pt: number) => rank(cars.map((c, k) => ({ slot: c.slot, finish: c.finish !== null && c.finish <= pt * HZ ? c.finish : null, prog: timed ? progNow[k] - grid[k].prog : progNow[k] })));
  const listOrder = () => (playT > 0 ? standings(Math.min(playT, end)) : cars.map((_, k) => k).sort((a, b) => cars[a].slot - cars[b].slot));
  const status: RaceStatus = {
    state: 'grid', kind: setup.kind, me, raceSeed, trackSeed: race.trackSeed, family: track.family, hash: race.hash, names, slots: cars.map((c) => c.slot),
    results, place, won: false, computeMs, t: 0, end, frames: 0, go: false, webgl: !!stage, goAt: cd.go, countdown: '', countdownSeen: [], countdownMusic: cd.music, wrongWay: false,
    listed: () => listOrder().map((k) => names[k]),
    shown: () => { const o = listOrder(), r = listRows(n, o.indexOf(follow)); return r.idx.flatMap((i, j) => (r.gap && j === 3 ? ['⋯', names[o[i]]] : [names[o[i]]])); },
    drawn: () => (stage ? stage.drive.drawn().map((p, i) => [...p, i ? drawnIdx[i - 1] : follow]) : []), dots: () => dots.length,
    hold: false,
    following: () => follow, cardTitle: () => $('rcBrainT').textContent ?? '', cardVals: () => (card ? Array.from(card.vals) : null), ownVals: () => (mine ? Array.from(ownNow) : null),
    lookOff: () => (stage ? stage.drive.lookOff() : -1), cam: () => ({ mode: stage?.drive.mode ?? '', cuts: stage ? [...stage.drive.cuts] : [] }),
    dotAt: (k) => { const q = map?.cssOf(dots[k].x, dots[k].y), r = $('rcMap').getBoundingClientRect(); return q ? { x: r.left + q.x, y: r.top + q.y } : null; },
    seek: (sec) => { endCount(); playT = Math.max(0, Math.min(sec, end)); stage?.drive.snapNow(); },
    auditAt: (sec, mask) => {
      if (!stage) return { over: 0, max: 0 };
      endCount();
      playT = sec;
      poseAll(playT, 0);
      stage.drive.snapNow();
      stage.frame(0, 0, pose);
      return stage.bloomAudit(mask);
    },
    probe: stage ? () => stage.probe() : undefined,
  };
  window.__race = status;
  scheduleCount();

  function poseAll(pt: number, dt: number): number {
    for (let k = 0; k < n; k++) at(k, pt, poses[k]);
    const f = poses[follow], j = at(follow, pt, pose);
    pose.idx = Math.round(pose.f) % track.n;
    const moving = j >= 0 && pt * HZ < rec0.ticks, c = card && card.k === follow ? card : null;
    for (let o = 0; o < 4; o++) wheels[o] = !moving ? 0 : c ? c.rec.act[j * c.nN + c.net.outStart + o] : f.v / CONFIG.car.wheelSpeed;
    // the nearest others are drawn as cars (all of them in a race of up to MAX_RIVALS + 1)
    for (let k = 0; k < n; k++) { const dx = poses[k].x - f.x, dy = poses[k].y - f.y; dist[k] = k === follow ? Infinity : dx * dx + dy * dy; }
    const near = cars.map((_, k) => k).sort((a, b) => dist[a] - dist[b] || a - b).slice(0, R).sort((a, b) => a - b);
    near.forEach((k, s) => { drawnIdx[s] = k; Object.assign(rivals[s], poses[k], { on: true, color: colorOf(k) }); });
    stage?.drive.placeRivals(rivals, dt);
    for (let k = 0; k < n; k++) {
      const p = poses[k], d = dots[k];
      d.x = p.x; d.y = p.y; d.hl = k === follow; d.deck = track.deck[Math.round(p.f) % track.n];
    }
    return j;
  }

  /** Your car at recording index j: going the wrong way (or just put back) long enough to say so. */
  const wrongNow = (j: number) => {
    if (!mine || follow !== me || j < 0) return false; // "Wrong way" is about your car, over it
    const w = rec0.wrong;
    if (w[j] >= WRONG_SHOW && w[j] < WRONG_WAY) return true;
    for (let i = Math.max(0, j - WRONG_SHOW + 1); i <= j; i++) if (w[i] >= WRONG_WAY) return true;
    return false;
  };
  const wrongEl = $('rcWrong');
  let lastJ = -1;
  const leave = () => { cancelAnimationFrame(raf); raf = 0; engine.stop(); endCount(); wrongEl.hidden = true; };
  leaveNow = leave;
  let wentGo = false, over = false;
  const showResults = () => {
    if (shown) return;
    shown = true; status.state = 'results';
    $('rcResT').textContent = !mine ? 'Results' : place === 1 ? 'You won!' : `You finished ${ord(place)} of ${n}`;
    $('rcHead').innerHTML = '<tr><th>Place</th><th>Name</th><th>Time</th><th>Distance</th></tr>';
    // at most 10 rows: places 1–3 and those nearest you, as the sidebar lists them
    $('rcRows').innerHTML = tableRows(results.length, mine ? place - 1 : -1, (i) => { const r = results[i]; return `<tr class="${mine && r.slot === cars[me].slot ? 'you' : ''}"><td>${r.place}</td><td>${esc(r.name)}</td><td>${r.finish !== null ? fmtT(r.finish / HZ) : '–'}</td><td>${fmtKm(shownDist(r.finish !== null ? goal : r.prog))}</td></tr>`; });
    $('rcScroll').scrollTop = 0;
    $('rcResults').hidden = false;
    if (place === 1) cheer();
    hooks.result?.(mine ? results[place - 1] : null);
  };
  const cheer = () => { if (won) return; won = true; status.won = true; win(); };
  $('rcAgain').onclick = () => { leave(); hooks.again?.(); };
  $('rcBack').onclick = $('rcLeave').onclick = () => { leave(); hideArena(); hooks.back(); };

  let last = performance.now();
  const t0 = last;
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    const dt = Math.max(0, Math.min((now - last) / 1000, 0.25));
    if (now >= cd.go && !status.hold) playT = Math.min(end + RESULTS_AFTER_S, playT + Math.min(dt, (now - cd.go) / 1000));
    last = now;
    status.go = now >= cd.go;
    if (status.go && status.state === 'grid') status.state = 'racing';
    status.t = playT;
    const pt = Math.min(playT, end), j = poseAll(pt, status.go ? dt : 0);
    // your car put back since the last frame: the camera jumps with it instead of sweeping across the track
    if (j >= 0 && lastJ >= 0 && j > lastJ) for (let i = lastJ + 1; i <= j; i++) if (cars[follow].rec.wrong[i] >= WRONG_WAY) { stage?.drive.snapNow(); break; }
    lastJ = j;
    const wrong = wrongNow(j) && playT < end;
    status.wrongWay = wrong;
    if (wrong && stage) {
      const at2 = stage.drive.screenOf(2.6);
      if (at2) { wrongEl.style.left = `${(at2.x * 100).toFixed(2)}%`; wrongEl.style.top = `${(at2.y * 100).toFixed(2)}%`; }
    }
    if (wrongEl.hidden === wrong) wrongEl.hidden = !wrong;
    if (stage) { stage.frame(dt, (now - t0) / 1000, pose); frames++; status.frames = frames; }
    const ended = playT >= end;
    if (mine && j >= 0) ownNow.set(rec0.act.subarray(j * ownN, (j + 1) * ownN));
    if (card) {
      const c = card, live = j >= 0 && !ended, vals = c.rec.act.subarray(Math.max(0, j) * c.nN, (Math.max(0, j) + 1) * c.nN);
      c.vals.set(vals);
      for (let d = 0; d < c.nN; d++) c.rates[d] = live ? nodeRate(c.net, d, vals[d]) : 0;
      c.spikes.update(c.rates, c.every, live ? dt : 0, now / 1000);
      c.panel.draw(vals, c.rates, c.spikes, now / 1000, reduce());
    }
    engine.set(ended || j < 0 ? 0 : pose.v / CONFIG.car.wheelSpeed, Math.abs((wheels[0] + wheels[2]) - (wheels[1] + wheels[3])) / 2);
    // first across the line: the winner music then and there
    if (!timed && place === 1 && cars[me].finish !== null && pt * HZ >= cars[me].finish!) cheer();
    // a match's race is seen from the broadcast camera from Go (follow-a-racer plan), following the followed car
    if (status.go && !wentGo) { wentGo = true; stage?.drive.setMode('tv', reduce()); hooks.go?.(); }
    if (playT >= end + RESULTS_AFTER_S) {
      if (!hooks.ended) showResults();
      else if (!over) { over = true; status.state = 'results'; hooks.ended(race); }
    }
    if (now - lastUi > 100) {
      lastUi = now;
      // Position and Distance stay yours (watching: the car followed)
      const you = mine ? me : follow, order = listOrder(), pos = order.indexOf(you) + 1, lap = Math.min(len.laps, Math.max(1, Math.floor(progNow[you] / track.len) + 1));
      const fin = cars[you].finish;
      $('rcState').textContent = !status.go ? 'on the grid' : ended ? 'finished' : 'racing';
      $('rcPos').textContent = `${ord(pos)} of ${n}${mine ? '' : ` (${esc(names[you])})`}`;
      $('rcLap').textContent = timed ? fmtKm(shownOf(you)) : fin !== null && pt * HZ >= fin ? 'finished' : `${lap} of ${len.laps}`;
      $('rcTime').textContent = `${fmtClock(pt)} / ${fmtClock(len.ticks / HZ)}`;
      $('rcListH').textContent = playT > 0 ? 'Standings' : 'Grid';
      const L = listRows(n, pos - 1);
      rows.update(L.idx.map((i) => {
        const k = order[i], c = cars[k], done = c.finish !== null && c.finish <= pt * HZ;
        return { k, place: i + 1, cls: `${k === you ? 'you' : ''}${k === follow && k !== you ? ' followed' : ''}`.trim(), color: colorOf(k), name: names[k], small: done ? fmtT(c.finish! / HZ) : playT > 0 ? fmtKm(shownOf(k)) : '', on: k === follow };
      }), L.gap ? 3 : -1);
      map?.draw(dots);
    }
  };
  raf = requestAnimationFrame(tick);
}

const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

interface ListRow { k: number; place: number; cls: string; color: string; name: string; small: string; on: boolean }
/**
 * The racers list, updated in place ten times a second: each row is a button (click, tap, Enter or Space follows that
 * racer: follow-a-racer plan) that stays the same element, so a press or the keyboard focus is never lost to a redraw.
 * Row j shows whichever racer is j-th; a "⋯" row goes before row `gapAt` (−1: none).
 */
function listOf(ul: HTMLOListElement): { update(rows: ListRow[], gapAt: number): void } {
  ul.textContent = '';
  const slots: { li: HTMLLIElement; btn: HTMLButtonElement; b: HTMLElement; dot: HTMLElement; name: HTMLElement; small: HTMLElement }[] = [];
  const gap = document.createElement('li');
  gap.className = 'gap'; gap.setAttribute('aria-hidden', 'true'); gap.textContent = '⋯';
  let shape = '';
  const set = (e: HTMLElement, t: string) => { if (e.textContent !== t) e.textContent = t; };
  return {
    update(rows, gapAt) {
      while (slots.length < rows.length) {
        const li = document.createElement('li'), btn = document.createElement('button'), b = document.createElement('b'), dot = document.createElement('i'), name = document.createElement('span'), small = document.createElement('small');
        btn.type = 'button'; btn.append(b, dot, name, small); li.append(btn);
        slots.push({ li, btn, b, dot, name, small });
      }
      const key = `${rows.length}:${gapAt}`;
      if (key !== shape) {
        // the rows' set changed (a race of a few cars, or the gap moved): put them in order; the focus stays where it was
        const had = document.activeElement;
        shape = key;
        ul.replaceChildren(...rows.flatMap((_, j) => (j === gapAt ? [gap, slots[j].li] : [slots[j].li])));
        if (had instanceof HTMLElement && had.isConnected && document.activeElement !== had) had.focus({ preventScroll: true });
      }
      rows.forEach((r, j) => {
        const s = slots[j];
        if (s.li.className !== r.cls) s.li.className = r.cls;
        if (s.btn.dataset.k !== String(r.k)) { s.btn.dataset.k = String(r.k); s.btn.setAttribute('aria-label', `Follow ${r.name}`); }
        s.btn.setAttribute('aria-pressed', String(r.on));
        set(s.b, String(r.place)); set(s.name, r.name); set(s.small, r.small);
        if (s.dot.dataset.c !== r.color) { s.dot.dataset.c = r.color; s.dot.style.background = r.color; }
      });
    },
  };
}
