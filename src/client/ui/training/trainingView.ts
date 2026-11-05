// Training view (B6, docs/plans/2026-11-04-tracks-training-matches.md §3; mock-up reference/training-view-mockup.html):
// Train on the designer (asking how many generations) → the worker pool trains the brain with its trainer for that
// many generations on its seeded tracks. On the left, a panel of its own (at most a fifth of the width): fitness per
// generation on top (gen n of N, Stop; Drive, Keep training and Back when it ends), the highlighted car's brain live
// below. The camera fills the rest: every generation records a seeded handful of its agents (5–20 by device), and the
// newest finished one replays at 12× as ghosts (render/ghosts.ts), its number big and white at the top, a map of the
// track and every shown car in the bottom-right corner. Stop is the generation limit reached now: the best agent
// evaluated so far is saved (the generation being evaluated is dropped), and Drive and Keep training appear.
// Results never depend on speed: rendering, the worker count and the recording only change how it looks.
import { phaseShowing, setPhaseSub } from '../phaseTimer';
import { CONFIG } from '../../../common/config';
import { compile, genomeHash, nodeRate, weightCount, zeroGenome, type Net } from '../../../common/sim/brain';
import { newRecording, Runner } from '../../../common/sim/race';
import type { Genome } from '../../../common/sim/spec';
import { generateTrack, type Track } from '../../../common/sim/track';
import { derive, Rng } from '../../../common/rng';
import { defaultWorkers, type Paths } from '../../../common/train/episodes';
import { phaseBudget, phaseSeeds, runPhase, type GenStat, type PhaseResult } from '../../../common/train/phase';
import { highlightOf, MAX_GHOSTS } from '../../render/ghosts';
import type { Stage } from '../../render/stage';
import { Engine } from '../../audio/sfx';
import { getStage, hideArena, showArena } from '../arena';
import { BrowserPool } from '../../workers/pool';
import { NO_TRAINING, type Saved } from '../designer/store';
import { BrainPanel } from '../drive/brainPanel';
import { SpikeTrains } from '../drive/spikes';
import { TrackMap } from './map';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`training: #${id} missing`);
  return e as T;
};

export interface TrainingHooks {
  /** Save the trained brain (new weights and training history). */
  save(s: Saved): void;
  /** Leave for the workbench. */
  back(): void;
  /** Leave for the drive view with this (trained) brain. */
  drive(s: Saved): void;
  /** vs CPU: race this (trained) brain; a room: hand it in. */
  race?(s: Saved): void;
  /** The label of that button ('Race', or 'Hand in' in a room). */
  raceLabel?: string;
  /**
   * A vs CPU round (rounds plan 2026-11-05): train from the brain as built (weights carried over), phase n − 1 of the
   * match's training seed, no buttons (the round's timer moves on); `done` gets the trained brain (or the brain as it
   * was, if training failed or nothing was evaluated).
   */
  round?: { n: number; seed: number; done(s: Saved): void };
}

export interface TrainingStatus {
  state: 'running' | 'done' | 'stopped';
  seed: number; phase: number; start: 'fresh' | 'carry'; workers: number; T: number;
  /** The run's temperature (log2 of the multiplier; 0 for backprop, which has nothing to explore). */
  temperature: number;
  /** Generations asked for, evaluated so far, and the one on screen (0 = none yet). */
  generations: number; gen: number; ticksUsed: number; shownGen: number; finale: boolean;
  /** Every generation shown, in order, with its replay's start offset (ticks; −1 = the champion's lap) and when (s). */
  shown: { gen: number; offset: number; at: number }[];
  /** Ghosts recorded per generation on this device, and the mesh's capacity. */
  ghosts: number; ghostCapacity: number;
  /** Generations whose handful was recorded and offered to the view. */
  offered: number[];
  /**
   * Frame cost (main thread, ms): the worst frame while a new generation's ghosts are being added in, and the median
   * frame otherwise (the no-spike check compares them).
   */
  switchFrameMs: number; steadyFrameMs: number; steadyP95Ms: number; switchFrames: number[];
  /** The slowest main-thread preparation of a generation (ms): its highlighted brain, compiled for the panel. */
  prepMs: number;
  /** Chequered flags at the finish line. */
  flags: number;
  /** Saved on Stop: true if a generation had been evaluated (the best so far is the brain now). */
  savedOnStop?: boolean;
  hash?: string; genome?: string; ms?: number; webgl: boolean; quality?: string;
  /** Frames drawn and the last frame's main-thread cost (ms), for the checks and for tuning. */
  frames: number; frameMs: number;
  probe?: () => { mean: number; sd: number; w: number; h: number };
  bloomAudit?: (mask?: boolean) => { over: number; max: number; mask?: string };
  /** Seek what is on screen to t s, snap the camera, audit that frame (deterministic). */
  auditAt?: (t: number) => { over: number; max: number; gen: number; finale: boolean };
}
declare global { interface Window { __training?: TrainingStatus } }

function params() {
  const q = new URLSearchParams(location.search);
  const num = (k: string) => { const v = q.get(k); return v !== null && /^\d+$/.test(v) ? Number(v) : undefined; };
  return {
    seed: num('seed'),
    workers: num('workers'),
    // a smaller budget is for the browser checks only; the game always spends the generations' budget
    T: import.meta.env.DEV ? num('T') : undefined,
    ghosts: import.meta.env.DEV ? num('ghosts') : undefined,
  };
}

function newSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0];
}

/**
 * Ghosts per generation: the whole population on every device (principal 2026-11-04: "keep it as many cars as we
 * had before"). They are added in over a few frames; even a software renderer keeps its frame cost flat with all 64
 * (check:training measures it), so no device class shows fewer.
 */
const ghostsFor = (): number => MAX_GHOSTS;

/** The seeded handful of generation `gen`'s `count` policies to record (display only: no result depends on it). */
export function showPick(seed: number, phase: number, gen: number, k: number, count: number): number[] {
  const r = new Rng(derive(seed, 0x5a3e, phase, gen)), idx = Array.from({ length: count }, (_, i) => i);
  const n = Math.min(k, count);
  for (let i = 0; i < n; i++) { const j = i + r.int(count - i); const x = idx[i]; idx[i] = idx[j]; idx[j] = x; }
  return idx.slice(0, n).sort((a, b) => a - b);
}

/** One car's brain for the panel: every node's output per tick of its run on training track 0. */
interface Live { gen: number; net: Net; act: Float64Array; ticks: number; panel: BrainPanel; spikes: SpikeTrains; rates: Float64Array; every: Uint8Array }

let stage: Stage | null = null;
let track0: Track | null = null;
let stopAsked = false;
let raf = 0;
let running = false;
let pool: BrowserPool | null = null;
let map: TrackMap | null = null;
/** The highlighted car's motors, quieter than your own car in the drive view. */
const engine = new Engine(0.35);
/** Prepared brains: the newest offered generation's and the one on screen (bounded: older ones are dropped). */
const lives = new Map<number, Live>();
let champLive: Live | null = null;

/**
 * Open the view and train the given brain; resolves when the run ends (done or stopped). `match` (vs CPU, B7): the
 * design trains from scratch (every weight, bias and field at 0, a fresh seed, phase 0) on the fixed budget T, as the
 * CPU brains did, so no racer brings extra training; it ends with Race and Back (no Keep training, no Drive).
 */
export async function openTraining(saved: Saved, generations: number, temperature: number, hooks: TrainingHooks, match = false): Promise<void> {
  if (running) return;
  running = true;
  stopAsked = false;
  const id = ++runId, round = hooks.round;
  const p = params();
  const seed = p.seed ?? (round ? round.seed : match ? null : saved.train.seed) ?? newSeed();
  const phase = round ? round.n - 1 : match ? 0 : saved.train.phases;
  const temp = saved.trainer === 'backprop' || match ? 0 : temperature;
  // a match trains every round from fresh weights, biases and fields for the design as it stands (match-flow v2 §2)
  const genome = match ? zeroGenome(saved.genome.spec) : saved.genome;
  if (match) saved = { ...saved, train: round ? { seed, phases: phase, temps: [] } : NO_TRAINING };
  // weights and biases all 0 (untrained, or edited since): from scratch; the cells' learned fields are kept either way
  const start: 'fresh' | 'carry' = genome.w.slice(0, weightCount(genome.spec)).every((w) => w === 0) ? 'fresh' : 'carry';
  const workers = p.workers ?? defaultWorkers(navigator.hardwareConcurrency || 2);
  const T = p.T ?? (round ? CONFIG.rounds.T : match ? CONFIG.train.T : phaseBudget(generations));
  // match: the generations the budget allows (evolution's worst case; a gradient trainer's fitness checks)
  if (match) generations = Math.max(1, saved.trainer === 'evolution' ? Math.floor(T / phaseBudget(1)) : Math.floor(T / CONFIG.train.grad.evalEvery) + 1);
  const seeds = phaseSeeds(seed, phase);
  lives.clear(); champLive = null;

  showArena('train');
  matchRun = match;
  roundRun = !!round;
  $('tvRace').textContent = hooks.raceLabel ?? 'Race';
  setButtons('running');
  note('Training…');
  $('tvGen').textContent = `gen 0 of ${generations}`;
  $('tvBig').textContent = '';
  $('tvCars').textContent = '';

  // the scene (optional: training runs without WebGL)
  stage = await getStage();
  const webgl = stage !== null;
  track0 = generateTrack(seeds.trainTracks[0]);
  if (stage) await stage.setTrack(track0, 'train');
  map ??= new TrackMap($('tvMap') as HTMLCanvasElement);
  map.setTrack(track0);
  const K = Math.min(p.ghosts ?? ghostsFor(), MAX_GHOSTS);
  const pop = CONFIG.train.population;
  const status: TrainingStatus = {
    state: 'running', seed, phase, start, workers, T, temperature: temp, generations, gen: 0, ticksUsed: 0, shownGen: 0, finale: false,
    shown: stage ? stage.swarm.log : [], ghosts: K, ghostCapacity: stage?.swarm.capacity ?? 0, offered: [], prepMs: 0, switchFrameMs: 0, steadyFrameMs: 0, steadyP95Ms: 0, switchFrames: [],
    flags: stage?.finishFlags ?? 0, frames: 0, frameMs: 0, webgl, quality: stage?.quality,
    probe: stage ? () => (stage as Stage).probe() : undefined, bloomAudit: stage ? (m?: boolean) => (stage as Stage).bloomAudit(m) : undefined,
    auditAt: stage ? (t: number) => { const st = stage as Stage; const a = st.auditTrainAt(t); return { ...a, gen: st.swarm.shownGen, finale: st.swarm.finale }; } : undefined,
  };
  window.__training = status;
  const gens: GenStat[] = [];
  drawGraph(gens, generations);
  loop();

  pool = new BrowserPool(workers);
  const thePool = pool;
  let result: PhaseResult;
  try {
    result = await runPhase(thePool, genome.spec, seed, {
      T, generations: match ? undefined : generations, temperature: temp, trainer: saved.trainer, phase, start, genome, now: () => performance.now(),
      stepTicks: (env) => env.worstCase(pop),
      // every generation records its seeded handful (display only)
      beforeStep: () => { if (stage) { const g = gens.length + 1; thePool.record = (count) => showPick(seed, phase, g, K, count); } },
      onEvent: (e) => {
        if (e.type !== 'generation') return;
        gens.push({ gen: e.gen, best: e.best, mean: e.mean, ticksUsed: e.ticksUsed, champion: e.championW });
        const paths = thePool.lastPaths;
        thePool.lastPaths = null;
        if (stage && paths && paths.count) {
          status.offered.push(e.gen);
          const f = generations > 1 ? (e.gen - 1) / (generations - 1) : 0;
          stage.swarm.offer(paths, e.gen, f);
          setTimeout(() => prepare(paths, e.gen, genome, status), 0);
        }
        status.gen = e.gen; status.ticksUsed = e.ticksUsed;
        generations = Math.max(generations, e.gen); // match: the budget's estimate, never below what ran
        $('tvGen').textContent = `gen ${e.gen} of ${generations}`;
        drawGraph(gens, generations);
      },
      stop: () => stopAsked,
    });
  } catch (e) {
    await thePool.close();
    running = false;
    if (id !== runId) return; // left (Main menu) meanwhile
    note('Training failed.');
    setButtons('stopped');
    status.state = 'stopped';
    round?.done(saved);
    throw e;
  }
  await thePool.close();
  pool = null;
  running = false;
  if (id !== runId) return; // left (Main menu) meanwhile: nothing is saved
  const evaluated = result.gens.length;
  if (result.stopped && evaluated === 0) {
    status.state = 'stopped';
    note('Stopped before the first generation finished: the brain keeps the weights it had.');
    stage?.swarm.finish(null);
    setButtons('stopped');
    round?.done(saved);
  } else {
    // done, or stopped: the best agent evaluated so far becomes the brain, exactly as at the generation limit
    const next: Saved = { ...saved, genome: result.final, train: { seed, phases: phase + 1, temps: [...saved.train.temps, temp] } };
    hooks.save(next);
    status.state = result.stopped ? 'stopped' : 'done';
    status.savedOnStop = result.stopped || undefined;
    status.hash = result.hash;
    status.genome = genomeHash(result.final);
    status.ms = result.trainMs;
    if (stage && track0) {
      const best = result.gens.reduce((b, g, i, a) => (g.best > a[b].best ? i : b), 0);
      const lap = championLap(result.final, track0, result.gens[best].gen);
      champLive = live(compile(result.final), lap.rec.act, lap.rec.ticks, lap.gen);
      stage.swarm.finish(lap);
    }
    $('tvGen').textContent = `gen ${evaluated} of ${generations}`;
    note(round
      ? `Done in ${(result.trainMs / 1000).toFixed(1)} s: the race starts when the round's training time is up.`
      : match
      ? `${result.stopped ? `Stopped at gen ${evaluated}` : `Done in ${(result.trainMs / 1000).toFixed(1)} s`}: the best brain is saved. Race it against nine CPU brains.`
      : result.stopped
        ? `Stopped at gen ${evaluated}: the best brain so far is saved. Keep training continues from it on new tracks.`
        : `Done in ${(result.trainMs / 1000).toFixed(1)} s on ${workers} worker${workers === 1 ? '' : 's'}. The best brain is saved; Keep training continues from it on new tracks.`);
    setButtons('done');
    round?.done(next);
    $('tvAgain').onclick = () => { void openTraining(next, generations, temperature, hooks); };
    $('tvDrive').onclick = () => { if (running) return; cancelAnimationFrame(raf); raf = 0; engine.stop(); hooks.drive(next); };
    $('tvRace').onclick = () => { if (running || !hooks.race) return; cancelAnimationFrame(raf); raf = 0; engine.stop(); lives.clear(); champLive = null; hooks.race(next); };
  }
  $('tvBack').onclick = () => close(hooks);
}

function note(text: string): void { $('tvNote').textContent = text; }

function live(net: Net, act: Float64Array, ticks: number, gen: number): Live {
  const nN = net.nNodes;
  return { gen, net, act, ticks, panel: new BrainPanel($('tvBrain') as HTMLCanvasElement, net), spikes: new SpikeTrains(nN), rates: new Float64Array(nN), every: new Uint8Array(nN).fill(1) };
}

/** The highlighted car's brain for the panel: its weights compiled; its firing was recorded by the worker. */
function prepare(paths: Paths, gen: number, start: Genome, status: TrainingStatus): void {
  if (!stage) return;
  const c0 = performance.now();
  const hl = highlightOf(paths), nW = paths.nW;
  const net = compile({ spec: start.spec, w: Array.from(paths.w.subarray(hl * nW, (hl + 1) * nW)) });
  if (paths.nN !== net.nNodes || paths.act.length !== paths.ticks[hl] * net.nNodes) throw new Error('training: the highlighted car\'s recording does not fit its brain');
  lives.set(gen, live(net, paths.act, paths.ticks[hl], gen));
  // keep the one on screen and the newest only
  const keep = new Set([stage.swarm.shownGen, gen]);
  for (const g of [...lives.keys()]) if (!keep.has(g)) lives.delete(g);
  status.prepMs = Math.max(status.prepMs, performance.now() - c0);
}

/** The champion's 1-minute run on training track 0, replayed for display only (no experience charged). */
function championLap(g: Genome, t: Track, gen: number) {
  const net = compile(g);
  const rec = newRecording(net, CONFIG.drive.ticks);
  new Runner().run(net, t, { ticks: CONFIG.drive.ticks, earlyStop: false, record: rec });
  return { x: rec.x, y: rec.y, hdg: rec.hdg, v: rec.v, prog: rec.prog, ticks: rec.ticks, gen, rec };
}

/** A round's time is up (match-flow v2 §3): training stops where it has got to and keeps the best agent so far, as
 * Stop does (ruling 2026-11-04); a run with nothing evaluated yet hands back the brain as it was. */
export function stopTraining(): void { if (running) { stopAsked = true; pool?.abort(); } }

/** Leave the view now (Main menu): any run in progress is stopped and saves nothing. */
export function leaveTraining(): void {
  runId++;
  if (running) { stopAsked = true; pool?.abort(); }
  cancelAnimationFrame(raf);
  raf = 0;
  engine.stop();
  lives.clear(); champLive = null;
}

function close(hooks: TrainingHooks) {
  if (running) return;
  cancelAnimationFrame(raf);
  raf = 0;
  engine.stop();
  lives.clear(); champLive = null;
  hideArena();
  hooks.back();
}

const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function loop() {
  cancelAnimationFrame(raf);
  let last = performance.now(), nextAt = 0, mapAt = 0, seenSwitches = 0, afterSwitch = 0;
  const steady: number[] = [];
  const t0 = last;
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    if (now < nextAt) return;
    // real time, so the replay plays at its speed even when frames are slow
    const dt = Math.max(0, Math.min((now - last) / 1000, 0.5)); // rAF time can precede performance.now(): no negative steps
    last = now;
    if (!stage) return;
    const c0 = performance.now();
    stage.frame(dt, (now - t0) / 1000);
    const sw = stage.swarm;
    engine.set(sw.carV / CONFIG.car.wheelSpeed, sw.carTurn);
    const g = sw.shownGen, fin = sw.finale, st = window.__training;
    if (st) { st.shownGen = g; st.finale = fin; }
    // a round's countdown at the top centre: the generation goes into it as "gen n" (nothing overlaps it)
    if (phaseShowing()) { setPhaseSub(g ? `gen ${g}` : ''); $('tvBig').textContent = ''; }
    else $('tvBig').textContent = g ? String(g) : '';
    $('tvCars').textContent = fin ? 'champion' : g ? `${sw.recordedCount} of ${CONFIG.train.population}` : '';
    $('tvBrainOf').textContent = fin ? `champion · gen ${g}` : g ? 'highlighted car' : '';
    // the highlighted car's brain at the tick on screen
    const L = fin ? champLive : lives.get(g) ?? null;
    if (L) {
      const k = Math.min(sw.tick, Math.max(L.ticks - 1, 0)), on = sw.tick < L.ticks, nN = L.net.nNodes;
      const vals = L.act.subarray(k * nN, (k + 1) * nN);
      for (let d = 0; d < nN; d++) L.rates[d] = on ? nodeRate(L.net, d, vals[d]) : 0;
      L.spikes.update(L.rates, L.every, on ? dt : 0, now / 1000);
      L.panel.draw(vals, L.rates, L.spikes, now / 1000, reduce());
    }
    if (map && now >= mapAt) { map.draw(sw.dots); mapAt = now + 66; }
    const cost = performance.now() - c0;
    if (st) {
      st.frames++; st.frameMs = cost;
      // frames while a generation's ghosts come in (the first few after a switch) against the rest
      // (not the first generation or the champion's lap: their first frames also compile the scene's shaders)
      if (sw.log.length !== seenSwitches) {
        seenSwitches = sw.log.length;
        const e = sw.log[sw.log.length - 1];
        afterSwitch = sw.log.length >= 2 && e.offset >= 0 ? 6 : -6;
      }
      if (afterSwitch > 0) { afterSwitch--; st.switchFrameMs = Math.max(st.switchFrameMs, cost); if (st.switchFrames.length < 120) st.switchFrames.push(Math.round(cost * 10) / 10); }
      else if (afterSwitch < 0) afterSwitch++;
      else if (!fin && sw.log.length >= 2) { steady.push(cost); if (steady.length > 400) steady.shift(); const so = [...steady].sort((a, b) => a - b); st.steadyFrameMs = so[so.length >> 1]; st.steadyP95Ms = so[Math.floor(so.length * 0.95)]; }
    }
    // While training, drawing must not starve the worker pool. An expensive frame (a weak GPU) is kept to about a
    // fifth of this thread; a software rasteriser (quality low) draws on the same CPU cores the workers use, so it
    // gets 4 frames a second.
    nextAt = !running ? 0 : stage.quality === 'low' ? c0 + 250 : cost > 8 ? c0 + 5 * cost : 0;
  };
  raf = requestAnimationFrame(tick);
}

/** This run is vs CPU's (ends with Race instead of Drive and Keep training). */
let matchRun = false;
/** A vs CPU round: no buttons; the round's timer moves on. */
let roundRun = false;
/** Each run's number: a run left meanwhile (Main menu) saves nothing when it ends. */
let runId = 0;
function setButtons(state: 'running' | 'done' | 'stopped') {
  $('tvStop').hidden = state !== 'running' || roundRun;
  $('tvBack').hidden = state === 'running' || roundRun;
  $('tvAgain').hidden = state !== 'done' || matchRun;
  $('tvDrive').hidden = state !== 'done' || matchRun;
  $('tvRace').hidden = state !== 'done' || !matchRun || roundRun;
  $('tvStop').onclick = () => { stopAsked = true; ($('tvStop') as HTMLButtonElement).disabled = true; pool?.abort(); };
  ($('tvStop') as HTMLButtonElement).disabled = false;
}

/** Fitness per generation: best and mean; the x-axis spans every generation asked for, axes through 0. */
let graph: { gens: GenStat[]; N: number } = { gens: [], N: 1 };
function drawGraph(gens: GenStat[], N: number) {
  graph = { gens, N };
  const cv = $('tvGraph') as HTMLCanvasElement;
  const r = cv.getBoundingClientRect(), pr = Math.min(window.devicePixelRatio || 1, 2);
  if (r.width === 0 || r.height === 0) return;
  cv.width = Math.round(r.width * pr); cv.height = Math.round(r.height * pr);
  const g = cv.getContext('2d');
  if (!g) return;
  const css = getComputedStyle(document.documentElement);
  const col = (v: string) => css.getPropertyValue(v).trim() || '#888';
  const w = cv.width, h = cv.height, l = 40 * pr, rr = w - 6 * pr, t = 8 * pr, b = h - 24 * pr;
  g.clearRect(0, 0, w, h);
  let lo = 0, hi = 100;
  for (const s of gens) { lo = Math.min(lo, s.mean, s.best); hi = Math.max(hi, s.best); }
  // round steps, few enough to stay legible however short the panel is
  const lines = Math.max(2, Math.floor((b - t) / (22 * pr)));
  const step = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000].find((s) => (hi - lo) / s <= lines) ?? 10000;
  hi = Math.ceil(hi / step) * step; lo = Math.floor(lo / step) * step;
  const X = (gen: number) => l + (rr - l) * (gen / Math.max(N, 1));
  const Y = (v: number) => b - (b - t) * ((v - lo) / (hi - lo));
  g.font = `${9 * pr}px Arial, Helvetica, sans-serif`;
  g.lineWidth = pr; g.strokeStyle = col('--line'); g.fillStyle = col('--muted');
  g.textAlign = 'right'; g.textBaseline = 'middle';
  for (let v = lo; v <= hi + 1e-9; v += step) {
    g.beginPath(); g.moveTo(l, Y(v)); g.lineTo(rr, Y(v)); g.stroke();
    if (v !== lo || lo === 0) g.fillText(String(v), l - 3 * pr, Y(v));
  }
  // axes through 0
  g.strokeStyle = col('--muted');
  g.beginPath(); g.moveTo(l, t); g.lineTo(l, b); g.moveTo(l, Y(0)); g.lineTo(rr, Y(0)); g.stroke();
  g.textAlign = 'center'; g.textBaseline = 'top';
  const xt = [0, Math.round(N / 2), N];
  xt.forEach((v, i) => { g.textAlign = i === xt.length - 1 ? 'right' : i ? 'center' : 'left'; g.fillText(String(v), X(v) + (i === xt.length - 1 ? 3 * pr : 0), b + 3 * pr); });
  g.textAlign = 'center';
  g.fillText('generation', (l + rr) / 2, b + 13 * pr);
  g.save(); g.translate(6 * pr, (t + b) / 2); g.rotate(-Math.PI / 2); g.textBaseline = 'middle'; g.fillText('metres', 0, 0); g.restore();
  const line = (key: 'best' | 'mean', c: string, wd: number) => {
    if (!gens.length) return;
    g.strokeStyle = c; g.lineWidth = wd * pr; g.beginPath();
    gens.forEach((s, i) => { const x = X(s.gen), y = Y(s[key]); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.stroke();
    if (gens.length === 1) { g.fillStyle = c; g.beginPath(); g.arc(X(gens[0].gen), Y(gens[0][key]), wd * 1.4 * pr, 0, Math.PI * 2); g.fill(); }
  };
  line('mean', col('--muted'), 1.3);
  line('best', col('--accent'), 2);
}

window.addEventListener('resize', () => { if (!document.getElementById('trainOverlay')?.hidden) drawGraph(graph.gens, graph.N); });
