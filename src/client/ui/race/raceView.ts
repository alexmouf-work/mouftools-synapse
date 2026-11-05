// The race view (B7, vs CPU; tracks plan §4 and the coordinator's vs CPU calls of 2026-11-05): your trained brain
// against the nine CPU brains, ten cars on a race track drawn from the race seed. The whole race is computed first
// (common/sim/match.ts runRace, the same function a Node replay uses, so the hash matches), then played back in real
// time: the grid two by two behind the line with the players listed, "5, 4, 3, 2, 1, Go" (the drive view's countdown,
// on the music's beat when sound is on), 2 laps capped at 120 s, the standings live beside a map of every car in the
// corner, then the results (place, time, distance) with Race again and Back. Your car is the drive view's yellow car
// with its beams; the others are solid cars in their own colours, passing through each other (cars are ghosts to each
// other). Finishing first plays the winner music.
import cpuData from '../../../assets/cpu/brains.json';
import { CONFIG } from '../../../common/config';
import { compile } from '../../../common/sim/brain';
import { cpuBrains } from '../../../common/sim/cpu';
import { gridCar, raceTrackSeed, rank, runRace, type RaceResult } from '../../../common/sim/match';
import type { DrivePose, RivalPose } from '../../render/drive';
import type { Stage } from '../../render/stage';
import { sampleOf } from '../../render/trackMesh';
import type { Dot } from '../../render/ghosts';
import { raceCountdown } from '../../audio/countdown';
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
/** Your car, then the nine CPU cars in name order. Yellow is yours. */
export const RACE_COLORS = ['#ffc21a', '#e8475f', '#3f8cff', '#2fc28a', '#b46cff', '#ff8a3d', '#29c6d6', '#f06bc1', '#9aa3b5', '#6fd14a'];
const fmtT = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;
const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const ord = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

export interface RaceRow { name: string; place: number; finish: number | null; prog: number; slot: number }
export interface RaceStatus {
  state: 'grid' | 'racing' | 'results';
  raceSeed: number; trackSeed: number; family: string; hash: string; names: string[];
  /** Grid slot of each car (car 0 is you). */
  slots: number[];
  /** Final standings, best first (known from the start: the race is computed before it plays). */
  results: RaceRow[];
  /** Your place, and whether the winner music was asked for. */
  place: number; won: boolean;
  /** Playback time (s from Go), the race's end (s), frames drawn, whether Go has passed. */
  t: number; end: number; frames: number; go: boolean; webgl: boolean;
  countdown: string; countdownSeen: string[]; countdownMusic: boolean;
  /** The players as listed now ('Grid' before Go, then the standings): names in order. */
  listed: () => string[];
  /** Cars drawn in 3-D (yours and the others) as world [x, y, z, visible], and map dots now. */
  drawn: () => number[][]; dots: () => number;
  seek(seconds: number): void;
  /** Checks only: true holds the playback where it is (the clock stops; frames still draw). */
  hold: boolean;
  /** Seek, snap the camera, draw that frame and audit bloom on it (deterministic). */
  auditAt(seconds: number): { over: number; max: number };
  probe?: () => { mean: number; sd: number; w: number; h: number };
}
declare global { interface Window { __race?: RaceStatus } }
export interface RaceHooks { back(): void }

function newSeed(): number { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0]; }
/** `?race=` (the checks) picks the first race's seed; Race again always draws a new one. */
function firstSeed(): number {
  const q = new URLSearchParams(location.search).get('race');
  return q !== null && /^\d+$/.test(q) ? Number(q) : newSeed();
}

let raf = 0;
let map: TrackMap | null = null;

export async function openRace(saved: Saved, hooks: RaceHooks, raceSeed = firstSeed()): Promise<void> {
  cancelAnimationFrame(raf);
  showArena('race');
  const cpu = cpuBrains(cpuData);
  const names = ['You', ...cpu.map((b) => b.name)];
  const race: RaceResult = runRace([saved.genome, ...cpu.map((b) => b.genome)], raceSeed, (k) => k === 0);
  const { track, cars } = race;
  const net = compile(saved.genome), me = cars[0].rec, nN = net.nNodes, end = race.endTicks / HZ, goal = M.laps * track.len;
  const results: RaceRow[] = race.ranking.map((k, i) => ({ name: names[k], place: i + 1, finish: cars[k].finish, prog: cars[k].prog, slot: cars[k].slot }));
  const place = race.ranking.indexOf(0) + 1;
  const nB = saved.genome.spec.senses.boundary;
  const beams = Array.from({ length: nB }, (_, k) => net.tune[4 * k]), ranges = Array.from({ length: nB }, (_, k) => net.tune[4 * k + 2]);
  const grid = cars.map((c) => gridCar(track, c.slot));

  const stage: Stage | null = await getStage();
  if (stage) {
    await stage.setTrack(track, 'drive');
    stage.drive.setRivals(RACE_COLORS.slice(1, cars.length));
    stage.drive.setMode('chase', reduce());
  }
  map ??= new TrackMap($('rcMap') as HTMLCanvasElement);
  map.setTrack(track);
  $('rcResults').hidden = true;
  $('rcSkip').hidden = false;
  $('rcCars').textContent = `${cars.length} cars`;
  const engine = new Engine(1), cd = raceCountdown();
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
  const rivals: RivalPose[] = cars.slice(1).map(() => ({ x: 0, y: 0, hdg: 0, v: 0, f: 0, on: true }));
  const dots: Dot[] = cars.map(() => ({ x: 0, y: 0, hl: false, alpha: 1, deck: 0 }));
  const progNow = new Float64Array(cars.length);
  let playT = 0, frames = 0, shown = false, won = false, lastUi = -1;
  /** Car k at playback time pt (s from Go; before Go, on its grid slot). */
  const at = (k: number, pt: number, out: { x: number; y: number; hdg: number; v: number; f: number }) => {
    const c = cars[k], r = c.rec;
    if (pt <= 0) {
      const g = grid[k];
      out.x = g.x; out.y = g.y; out.hdg = g.hdg; out.v = 0; out.f = sampleOf(track, g.prog); progNow[k] = g.prog;
      return -1;
    }
    // recording j is the state after tick j + 1; time 0 is the grid
    const kf = Math.min(pt * HZ, r.ticks) - 1, j = Math.floor(kf), u = kf - j;
    const a = Math.max(j, 0), b = Math.min(j + 1, r.ticks - 1);
    const x0 = j < 0 ? grid[k].x : r.x[a], y0 = j < 0 ? grid[k].y : r.y[a], h0 = j < 0 ? grid[k].hdg : r.hdg[a], p0 = j < 0 ? grid[k].prog : r.prog[a];
    out.x = x0 + (r.x[b] - x0) * u; out.y = y0 + (r.y[b] - y0) * u;
    let dh = r.hdg[b] - h0; dh -= 2 * Math.PI * Math.round(dh / (2 * Math.PI));
    out.hdg = h0 + dh * u;
    out.v = r.v[b];
    const p = p0 + (r.prog[b] - p0) * u;
    progNow[k] = p;
    out.f = sampleOf(track, p);
    return b;
  };
  const tmp = { x: 0, y: 0, hdg: 0, v: 0, f: 0 };
  /** Standings at playback time pt: cars that have finished by then by finish time, the rest by progress. */
  const standings = (pt: number) => rank(cars.map((c, k) => ({ slot: c.slot, finish: c.finish !== null && c.finish <= pt * HZ ? c.finish : null, prog: progNow[k] })));
  const listOrder = () => (playT > 0 ? standings(playT) : cars.map((_, k) => k).sort((a, b) => cars[a].slot - cars[b].slot));
  const status: RaceStatus = {
    state: 'grid', raceSeed, trackSeed: raceTrackSeed(raceSeed), family: track.family, hash: race.hash, names, slots: cars.map((c) => c.slot),
    results, place, won: false, t: 0, end, frames: 0, go: false, webgl: !!stage, countdown: '', countdownSeen: [], countdownMusic: cd.music,
    listed: () => listOrder().map((k) => names[k]),
    drawn: () => (stage ? stage.drive.drawn() : []), dots: () => dots.length,
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
    const j = at(0, pt, pose);
    pose.idx = Math.round(pose.f) % track.n;
    const moving = j >= 0 && pt * HZ < me.ticks;
    for (let o = 0; o < 4; o++) wheels[o] = moving ? me.act[j * nN + net.outStart + o] : 0;
    for (let k = 1; k < cars.length; k++) {
      at(k, pt, tmp);
      Object.assign(rivals[k - 1], tmp, { on: true });
    }
    stage?.drive.placeRivals(rivals, dt);
    for (let k = 0; k < cars.length; k++) {
      const p = k ? rivals[k - 1] : pose;
      const d = dots[k];
      d.x = p.x; d.y = p.y; d.hl = k === 0; d.deck = track.deck[Math.round(p.f) % track.n];
    }
    return j;
  }

  const leave = () => { cancelAnimationFrame(raf); raf = 0; engine.stop(); endCount(); };
  const showResults = () => {
    if (shown) return;
    shown = true; status.state = 'results';
    $('rcSkip').hidden = true;
    $('rcResT').textContent = place === 1 ? 'You won!' : `You finished ${ord(place)} of ${cars.length}`;
    $('rcRows').innerHTML = results.map((r) => `<tr class="${r.name === 'You' ? 'you' : ''}"><td>${r.place}</td><td>${r.name}</td><td>${r.finish !== null ? fmtT(r.finish / HZ) : '–'}</td><td>${((r.finish !== null ? goal : r.prog) / 1000).toFixed(2)} km</td></tr>`).join('');
    $('rcResults').hidden = false;
    if (place === 1) cheer();
  };
  const cheer = () => { if (won) return; won = true; status.won = true; win(); };
  $('rcSkip').onclick = () => { endCount(); playT = end + RESULTS_AFTER_S; };
  $('rcAgain').onclick = () => { leave(); void openRace(saved, hooks, newSeed()); };
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
    if (place === 1 && cars[0].finish !== null && pt * HZ >= cars[0].finish) cheer();
    if (playT >= end + RESULTS_AFTER_S) showResults();
    if (now - lastUi > 100) {
      lastUi = now;
      const order = listOrder(), mine = order.indexOf(0) + 1, lap = Math.min(M.laps, Math.max(1, Math.floor(progNow[0] / track.len) + 1));
      $('rcState').textContent = !status.go ? 'on the grid' : ended ? 'finished' : 'racing';
      $('rcPos').textContent = `${ord(mine)} of ${cars.length}`;
      $('rcLap').textContent = cars[0].finish !== null && pt * HZ >= cars[0].finish ? 'finished' : `${lap} of ${M.laps}`;
      $('rcTime').textContent = `${fmtClock(pt)} / ${fmtClock(M.capTicks / HZ)}`;
      $('rcListH').textContent = playT > 0 ? 'Standings' : 'Grid';
      $('rcList').innerHTML = order.map((k, i) => `<li class="${k === 0 ? 'you' : ''}"><b>${i + 1}</b><i style="background:${RACE_COLORS[k]}"></i><span>${names[k]}</span>${cars[k].finish !== null && cars[k].finish! <= pt * HZ ? `<small>${fmtT(cars[k].finish! / HZ)}</small>` : ''}</li>`).join('');
      map?.draw(dots);
    }
  };
  raf = requestAnimationFrame(tick);
}

const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
