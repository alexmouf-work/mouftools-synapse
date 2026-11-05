// The race view (B7 vs CPU, B8 Multiplayer; tracks plan §4 and the coordinator's vs CPU calls of 2026-11-05): up to
// 100 cars on a race track drawn from the race seed. The whole race is computed first (common/sim/match.ts runRace, the
// same function a Node replay or any other client uses, so every client sees the same race), then played back in real
// time: the grid two by two behind the line with the players listed, "5, 4, 3, 2, 1, Go" (vs CPU: the drive view's
// countdown on the music's beat; a room: Go at the moment the server set, so every client starts together), 2 laps
// capped at 120 s, the standings live beside a map of every car in the corner, then the results (place, time,
// distance). Your car is the drive view's yellow car with its beams; the nearest others (at most MAX_RIVALS) are solid
// cars in their own colours, the rest only dots on the map. Cars pass through each other. Finishing first plays the
// winner music.
import cpuData from '../../../assets/cpu/brains.json';
import { CONFIG } from '../../../common/config';
import { compile } from '../../../common/sim/brain';
import { cpuBrains } from '../../../common/sim/cpu';
import { gridCar, raceTrackSeed, rank, runRace, type RaceResult } from '../../../common/sim/match';
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

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`race: #${id} missing`);
  return e as T;
};
const HZ = CONFIG.tick.hz, M = CONFIG.match;
const RESULTS_AFTER_S = 1.5; // the cars hold this long after the race ends, then the results show
const LISTED = 10; // standings rows (yours added below them if you are further back)
const YOU = '#ffc21a';
/** The other cars' colours, in entry order (cycled past ten). Yellow is yours. */
export const RACE_COLORS = ['#e8475f', '#3f8cff', '#2fc28a', '#b46cff', '#ff8a3d', '#29c6d6', '#f06bc1', '#9aa3b5', '#6fd14a', '#5b6cff'];
const fmtT = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;
const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const ord = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** One race to show: who drives (in entry order), which car is yours (−1: watching), the seed, and for a room when Go is. */
export interface RaceSetup {
  kind: 'cpu' | 'room';
  title: string;
  names: string[];
  genomes: Genome[];
  me: number;
  raceSeed: number;
  /** A room's Go (performance.now() ms), the same moment on every client; vs CPU counts down on the music. */
  goAt?: number;
  /** A room's race number (its result is reported with it). */
  raceNo?: number;
}
export interface RaceRow { name: string; place: number; finish: number | null; prog: number; slot: number }
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
  /** The players as listed now ('Grid' before Go, then the standings): names in order. */
  listed: () => string[];
  /** Cars drawn in 3-D (yours or the one followed, then the others) as world [x, y, z, visible, car index], and map dots. */
  drawn: () => number[][]; dots: () => number;
  seek(seconds: number): void;
  /** Checks only: true holds the playback where it is (the clock stops; frames still draw). */
  hold: boolean;
  /** Seek, snap the camera, draw that frame and audit bloom on it (deterministic). */
  auditAt(seconds: number): { over: number; max: number };
  probe?: () => { mean: number; sd: number; w: number; h: number };
}
declare global { interface Window { __race?: RaceStatus } }
export interface RaceHooks {
  back(): void;
  /** vs CPU: another race with the same brain. */
  again?(): void;
  /** Called once when the results show: your row (or null when watching). */
  result?(row: RaceRow | null): void;
}

function newSeed(): number { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0]; }
/** `?race=` (the checks) picks the first vs CPU race's seed; Race again always draws a new one. */
export function firstSeed(): number {
  const q = new URLSearchParams(location.search).get('race');
  return q !== null && /^\d+$/.test(q) ? Number(q) : newSeed();
}
/** vs CPU: you (car 0) and the nine CPU brains. */
export function cpuSetup(saved: Saved, raceSeed = newSeed()): RaceSetup {
  const cpu = cpuBrains(cpuData);
  return { kind: 'cpu', title: 'vs CPU', names: ['You', ...cpu.map((b) => b.name)], genomes: [saved.genome, ...cpu.map((b) => b.genome)], me: 0, raceSeed };
}

let raf = 0;
let map: TrackMap | null = null;

export async function openRace(setup: RaceSetup, hooks: RaceHooks): Promise<void> {
  cancelAnimationFrame(raf);
  showArena('race');
  const { names, genomes, me, raceSeed } = setup, n = genomes.length;
  const c0 = performance.now();
  const race: RaceResult = runRace(genomes, raceSeed, (k) => k === me);
  const computeMs = performance.now() - c0;
  const { track, cars } = race;
  const follow = me >= 0 ? me : 0, mine = me >= 0;
  const net = compile(genomes[follow]), rec0 = cars[follow].rec, nN = net.nNodes, end = race.endTicks / HZ, goal = M.laps * track.len;
  const results: RaceRow[] = race.ranking.map((k, i) => ({ name: names[k], place: i + 1, finish: cars[k].finish, prog: cars[k].prog, slot: cars[k].slot }));
  const place = mine ? race.ranking.indexOf(me) + 1 : 0;
  const nB = mine ? genomes[me].spec.senses.boundary : 0;
  const beams = Array.from({ length: nB }, (_, k) => net.tune[4 * k]), ranges = Array.from({ length: nB }, (_, k) => net.tune[4 * k + 2]);
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
  $('rcSkip').hidden = setup.kind !== 'cpu';
  $('rcAgain').hidden = !hooks.again;
  $('rcBack').textContent = setup.kind === 'room' ? 'Back to room' : 'Back';
  $('rcCars').textContent = `${n} cars`;
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
  const pose: DrivePose = { x: 0, y: 0, hdg: 0, v: 0, idx: track.startIdx, f: track.startIdx, wheels, beams, ranges, stuck: false };
  const poses = cars.map(() => ({ x: 0, y: 0, hdg: 0, v: 0, f: 0 }));
  const rivals: RivalPose[] = Array.from({ length: R }, () => ({ x: 0, y: 0, hdg: 0, v: 0, f: 0, on: true, color: YOU }));
  /** Which car each rival slot shows this frame. */
  const drawnIdx = new Int32Array(R).fill(-1);
  const dots: Dot[] = cars.map(() => ({ x: 0, y: 0, hl: false, alpha: 1, deck: 0 }));
  const progNow = new Float64Array(n), dist = new Float64Array(n);
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
    const kf = Math.min(pt * HZ, r.ticks) - 1, j = Math.floor(kf), u = kf - j, b = Math.min(j + 1, r.ticks - 1), a = Math.max(j, 0);
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
  const standings = (pt: number) => rank(cars.map((c, k) => ({ slot: c.slot, finish: c.finish !== null && c.finish <= pt * HZ ? c.finish : null, prog: progNow[k] })));
  const listOrder = () => (playT > 0 ? standings(Math.min(playT, end)) : cars.map((_, k) => k).sort((a, b) => cars[a].slot - cars[b].slot));
  const status: RaceStatus = {
    state: 'grid', kind: setup.kind, me, raceSeed, trackSeed: raceTrackSeed(raceSeed), family: track.family, hash: race.hash, names, slots: cars.map((c) => c.slot),
    results, place, won: false, computeMs, t: 0, end, frames: 0, go: false, webgl: !!stage, goAt: cd.go, countdown: '', countdownSeen: [], countdownMusic: cd.music,
    listed: () => listOrder().map((k) => names[k]),
    drawn: () => (stage ? stage.drive.drawn().map((p, i) => [...p, i ? drawnIdx[i - 1] : follow]) : []), dots: () => dots.length,
    hold: false,
    seek: (sec) => { endCount(); playT = Math.max(0, Math.min(sec, end)); stage?.drive.snapNow(); },
    auditAt: (sec) => {
      if (!stage) return { over: 0, max: 0 };
      endCount();
      playT = sec;
      poseAll(playT, 0);
      stage.drive.snapNow();
      stage.frame(0, 0, pose);
      return stage.bloomAudit();
    },
    probe: stage ? () => stage.probe() : undefined,
  };
  window.__race = status;
  scheduleCount();

  function poseAll(pt: number, dt: number): number {
    for (let k = 0; k < n; k++) at(k, pt, poses[k]);
    const f = poses[follow], j = at(follow, pt, pose);
    pose.idx = Math.round(pose.f) % track.n;
    const moving = j >= 0 && pt * HZ < rec0.ticks;
    for (let o = 0; o < 4; o++) wheels[o] = !moving ? 0 : mine ? rec0.act[j * nN + net.outStart + o] : f.v / CONFIG.car.wheelSpeed;
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

  const leave = () => { cancelAnimationFrame(raf); raf = 0; engine.stop(); endCount(); };
  const showResults = () => {
    if (shown) return;
    shown = true; status.state = 'results';
    $('rcSkip').hidden = true;
    $('rcResT').textContent = !mine ? 'Results' : place === 1 ? 'You won!' : `You finished ${ord(place)} of ${n}`;
    $('rcRows').innerHTML = results.map((r) => `<tr class="${mine && r.slot === cars[me].slot ? 'you' : ''}"><td>${r.place}</td><td>${esc(r.name)}</td><td>${r.finish !== null ? fmtT(r.finish / HZ) : '–'}</td><td>${((r.finish !== null ? goal : r.prog) / 1000).toFixed(2)} km</td></tr>`).join('');
    $('rcResults').hidden = false;
    if (place === 1) cheer();
    hooks.result?.(mine ? results[place - 1] : null);
  };
  const cheer = () => { if (won) return; won = true; status.won = true; win(); };
  $('rcSkip').onclick = () => { endCount(); playT = end + RESULTS_AFTER_S; };
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
    if (stage) { stage.frame(dt, (now - t0) / 1000, pose); frames++; status.frames = frames; }
    const ended = playT >= end;
    engine.set(ended || j < 0 ? 0 : pose.v / CONFIG.car.wheelSpeed, Math.abs((wheels[0] + wheels[2]) - (wheels[1] + wheels[3])) / 2);
    // first across the line: the winner music then and there
    if (place === 1 && cars[me].finish !== null && pt * HZ >= cars[me].finish!) cheer();
    if (playT >= end + RESULTS_AFTER_S) showResults();
    if (now - lastUi > 100) {
      lastUi = now;
      const order = listOrder(), pos = order.indexOf(follow) + 1, lap = Math.min(M.laps, Math.max(1, Math.floor(progNow[follow] / track.len) + 1));
      const fin = cars[follow].finish;
      $('rcState').textContent = !status.go ? 'on the grid' : ended ? 'finished' : 'racing';
      $('rcPos').textContent = `${ord(pos)} of ${n}${mine ? '' : ` (${esc(names[follow])})`}`;
      $('rcLap').textContent = fin !== null && pt * HZ >= fin ? 'finished' : `${lap} of ${M.laps}`;
      $('rcTime').textContent = `${fmtClock(pt)} / ${fmtClock(M.capTicks / HZ)}`;
      $('rcListH').textContent = playT > 0 ? 'Standings' : 'Grid';
      const rows = order.slice(0, LISTED);
      if (pos > LISTED) rows.push(follow);
      $('rcList').innerHTML = rows.map((k) => { const i = order.indexOf(k), c = cars[k]; return `<li class="${k === follow ? 'you' : ''}"><b>${i + 1}</b><i style="background:${colorOf(k)}"></i><span>${esc(names[k])}</span>${c.finish !== null && c.finish <= pt * HZ ? `<small>${fmtT(c.finish / HZ)}</small>` : ''}</li>`; }).join('');
      map?.draw(dots);
    }
  };
  raf = requestAnimationFrame(tick);
}

const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
