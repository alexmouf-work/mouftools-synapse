// Training view: Train on the workbench → the worker pool spends one phase's experience budget T on the brain's
// seeded tracks, while the swarm of the latest recorded generation drives training track 0 and a fitness graph
// grows. When done the champion's weights are saved with the brain; Train again continues from them (carry).
// Results never depend on speed: rendering, the worker count and the path recording only change how it looks.
import { CONFIG } from '../../../common/config';
import { compile, genomeHash } from '../../../common/sim/brain';
import { poolFor } from '../../../common/sim/energy';
import { newRecording, Runner } from '../../../common/sim/race';
import type { Genome } from '../../../common/sim/spec';
import { generateTrack, type Track } from '../../../common/sim/track';
import { defaultWorkers } from '../../../common/train/episodes';
import { phaseSeeds, runPhase, type GenStat, type PhaseResult } from '../../../common/train/phase';
import type { Stage } from '../../render/stage';
import { Engine } from '../../audio/sfx';
import { getStage, hideArena, showArena } from '../arena';
import { BrowserPool } from '../../workers/pool';
import type { Saved } from '../workbench/store';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`training: #${id} missing`);
  return e as T;
};
/** Generations recorded for the story, as fractions of the run (gen 1 and the final one are always recorded). */
const STORY_AT = [0.1, 0.25, 0.5];
const fmtTicks = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

export interface TrainingHooks {
  /** Save the trained brain (new weights and training history). */
  save(s: Saved): void;
  /** Leave for the workbench. */
  back(): void;
  /** Leave for the drive view with this (trained) brain. */
  drive(s: Saved): void;
}

export interface TrainingStatus {
  state: 'running' | 'done' | 'stopped';
  seed: number; phase: number; start: 'fresh' | 'carry'; workers: number; T: number;
  gen: number; ticksUsed: number; shownGen: number; finale: boolean; story: number[]; ghostCapacity: number;
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
    // a smaller budget is for the browser checks only; the game always spends CONFIG.train.T
    T: import.meta.env.DEV ? num('T') : undefined,
  };
}

function newSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0];
}

let stage: Stage | null = null;
let track0: Track | null = null;
let stopAsked = false;
let raf = 0;
let running = false;
/** The solid best car's motors, quieter than your own car in the drive view. */
const engine = new Engine(0.35);
let estGens = 0; // estimated generations in this run (exact once done)
let doneGens = 0;

/** Open the view and train the given brain; resolves when the run ends (done or stopped). */
export async function openTraining(saved: Saved, hooks: TrainingHooks): Promise<void> {
  if (running) return;
  running = true;
  stopAsked = false;
  const p = params();
  const seed = p.seed ?? saved.train.seed ?? newSeed();
  const phase = saved.train.phases;
  const genome = saved.draft.genome;
  const start: 'fresh' | 'carry' = genome.w.every((w) => w === 0) ? 'fresh' : 'carry';
  const workers = p.workers ?? defaultWorkers(navigator.hardwareConcurrency || 2);
  const T = p.T ?? CONFIG.train.T;
  const seeds = phaseSeeds(seed, phase);
  estGens = 0; doneGens = 0;

  showArena('train');
  $('tvName').textContent = saved.name;
  $('tvSeed').textContent = String(seed);
  $('tvRun').textContent = `${phase + 1}${start === 'carry' ? ' · continues from saved weights' : ' · from scratch'}`;
  setButtons('running');
  $('tvState').textContent = 'Training';

  // the scene (optional: training runs without WebGL)
  stage = await getStage();
  const webgl = stage !== null;
  track0 = generateTrack(seeds.trainTracks[0]);
  if (stage) await stage.setTrack(track0, 'train');
  const status: TrainingStatus = {
    state: 'running', seed, phase, start, workers, T, gen: 0, ticksUsed: 0, shownGen: 0, finale: false, story: [], frames: 0, frameMs: 0,
    ghostCapacity: stage?.swarm.capacity ?? 0, webgl, quality: stage?.quality,
    probe: stage ? () => (stage as Stage).probe() : undefined, bloomAudit: stage ? (m?: boolean) => (stage as Stage).bloomAudit(m) : undefined,
    auditAt: stage ? (t: number) => { const st = stage as Stage; const a = st.auditTrainAt(t); return { ...a, gen: st.swarm.shownGen, finale: st.swarm.finale }; } : undefined,
  };
  window.__training = status;
  const gens: GenStat[] = [];
  drawGraph(gens, T);
  loop();

  const pool = new BrowserPool(workers);
  let consumed: unknown = null;
  const pop = CONFIG.train.population;
  const taken = new Set<number>(); // story fractions already recorded
  let finalCandidate = false;
  let result: PhaseResult;
  try {
    result = await runPhase(pool, genome.spec, seed, {
      T, phase, start, genome, now: () => performance.now(),
      stepTicks: (env) => env.worstCase(pop),
      beforeStep: (env) => {
        // The story is chosen by generation count, not by time: gen 1, ~10%, 25%, 50% of the run, and the last one
        // (any generation that could be the last is recorded; only the last is kept as final).
        const g = doneGens + 1;
        // early generations are cheap (episodes stop on a stall); trained ones run ~80% of the worst case, so use
        // that as a floor or the estimate overshoots and the story's early picks come late
        const perGen = Math.max(doneGens ? env.used / doneGens : 0, 0.8 * env.worstCase(pop));
        estGens = doneGens + Math.max(1, Math.floor(env.remaining() / perGen));
        finalCandidate = env.remaining() < 2 * env.worstCase(pop);
        const due = STORY_AT.findIndex((f, k) => !taken.has(k) && g >= Math.max(2, Math.round(f * estGens)));
        if (due >= 0) STORY_AT.forEach((f, k) => { if (g >= Math.round(f * estGens)) taken.add(k); });
        if (stage && (g === 1 || due >= 0 || finalCandidate)) pool.record = true;
      },
      onEvent: (e) => {
        if (e.type !== 'generation') return;
        gens.push({ gen: e.gen, best: e.best, mean: e.mean, ticksUsed: e.ticksUsed, champion: e.championW });
        doneGens = e.gen;
        if (stage && pool.lastPaths && pool.lastPaths !== consumed) {
          consumed = pool.lastPaths;
          stage.swarm.enqueue(pool.lastPaths, e.gen, e.champion, finalCandidate);
          if (!finalCandidate) status.story.push(e.gen);
        }
        status.gen = e.gen; status.ticksUsed = e.ticksUsed;
        showProgress(e.gen, e.ticksUsed, T);
        drawGraph(gens, T);
      },
      stop: () => stopAsked,
    });
  } catch (e) {
    await pool.close();
    running = false;
    $('tvState').textContent = 'Training failed';
    setButtons('stopped');
    status.state = 'stopped';
    throw e;
  }
  await pool.close();
  running = false;
  if (result.stopped) {
    status.state = 'stopped';
    $('tvState').textContent = 'Stopped';
    $('tvNote').textContent = 'Stopped before the end: the brain keeps the weights it had.';
    setButtons('stopped');
  } else {
    const next: Saved = { ...saved, draft: { ...saved.draft, genome: result.final }, train: { seed, phases: phase + 1 } };
    hooks.save(next);
    status.state = 'done';
    status.hash = result.hash;
    status.genome = genomeHash(result.final);
    status.ms = result.trainMs;
    estGens = result.gens.length;
    status.story.push(estGens);
    if (stage && track0) stage.swarm.setLap(championLap(result.final, track0, seeds.trainNoise[0], estGens));
    $('tvState').textContent = 'Trained';
    $('tvNote').textContent = `Done in ${(result.trainMs / 1000).toFixed(1)} s on ${workers} worker${workers === 1 ? '' : 's'}. The best brain of the last generation is saved; Train again continues from it on new tracks.`;
    setButtons('done');
    $('tvAgain').onclick = () => { void openTraining(next, hooks); };
    $('tvDrive').onclick = () => { if (running) return; cancelAnimationFrame(raf); raf = 0; engine.stop(); hooks.drive(next); };
  }
  $('tvBack').onclick = () => close(hooks);
}

/** The champion's 1-minute run on training track 0 (full pool, as trained), replayed for display only (no experience charged). */
function championLap(g: Genome, t: Track, noiseSeed: number, gen: number) {
  const net = compile(g);
  const rec = newRecording(net, CONFIG.drive.ticks);
  new Runner().run(net, t, { ticks: CONFIG.drive.ticks, pool: poolFor(CONFIG.drive.ticks), noiseSeed, earlyStop: false, record: rec });
  return { x: rec.x, y: rec.y, hdg: rec.hdg, v: rec.v, ticks: rec.ticks, gen };
}

function close(hooks: TrainingHooks) {
  if (running) return;
  cancelAnimationFrame(raf);
  raf = 0;
  engine.stop();
  hideArena();
  hooks.back();
}

function loop() {
  cancelAnimationFrame(raf);
  let last = performance.now(), nextAt = 0;
  const t0 = last;
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    if (now < nextAt) return;
    // real time, so the swarm plays at its speed even when frames are slow
    const dt = Math.max(0, Math.min((now - last) / 1000, 0.5)); // rAF time can precede performance.now(): no negative steps
    last = now;
    if (stage) {
      const c0 = performance.now();
      stage.frame(dt, (now - t0) / 1000);
      engine.set(stage.swarm.carV / CONFIG.car.wheelSpeed, stage.swarm.carTurn);
      const cost = performance.now() - c0;
      if (window.__training) { window.__training.frames++; window.__training.frameMs = cost; }
      // While training, drawing must not starve the worker pool. An expensive frame (a weak GPU) is kept to about a
      // fifth of this thread; a software rasteriser (quality low) draws on the same CPU cores the workers use, so it
      // gets 4 frames a second.
      nextAt = !running ? 0 : stage.quality === 'low' ? c0 + 250 : cost > 8 ? c0 + 5 * cost : 0;
      const g = stage.swarm.shownGen, fin = stage.swarm.finale;
      if (window.__training) { window.__training.shownGen = g; window.__training.finale = fin; }
      const of = running ? `~${estGens}` : String(estGens);
      $('tvShown').textContent = fin ? `the champion of gen ${g}, its generation faint behind`
        : g ? `gen ${g} of ${of} · ${stage.swarm.mesh.count} cars` : 'waiting for the first generation';
    }
  };
  raf = requestAnimationFrame(tick);
}

function setButtons(state: 'running' | 'done' | 'stopped') {
  $('tvStop').hidden = state !== 'running';
  $('tvBack').hidden = state === 'running';
  $('tvAgain').hidden = state !== 'done';
  $('tvDrive').hidden = state !== 'done';
  $('tvStop').onclick = () => { stopAsked = true; ($('tvStop') as HTMLButtonElement).disabled = true; };
  ($('tvStop') as HTMLButtonElement).disabled = false;
}

function showProgress(gen: number, used: number, T: number) {
  $('tvGen').textContent = String(gen);
  $('tvTicks').textContent = `${fmtTicks(used)} / ${fmtTicks(T)} car-ticks`;
  const pct = Math.min(100, (100 * used) / T);
  $('tvFill').style.width = `${pct}%`;
  $('tvFill').parentElement?.setAttribute('aria-valuenow', pct.toFixed(0));
}


function drawGraph(gens: GenStat[], T: number) {
  const cv = $('tvGraph') as HTMLCanvasElement;
  const r = cv.getBoundingClientRect(), pr = Math.min(window.devicePixelRatio || 1, 2);
  if (r.width === 0) return;
  cv.width = Math.round(r.width * pr); cv.height = Math.round(r.height * pr);
  const g = cv.getContext('2d');
  if (!g) return;
  const css = getComputedStyle(document.documentElement);
  const col = (v: string) => css.getPropertyValue(v).trim() || '#888';
  const w = cv.width, h = cv.height, padL = 44 * pr, padB = 16 * pr, padT = 6 * pr;
  g.clearRect(0, 0, w, h);
  let lo = 0, hi = 100;
  for (const s of gens) { lo = Math.min(lo, s.mean, s.best); hi = Math.max(hi, s.best); }
  hi = Math.ceil(hi / 100) * 100;
  const X = (t: number) => padL + (w - padL - 4 * pr) * (t / T);
  const Y = (v: number) => padT + (h - padT - padB) * (1 - (v - lo) / (hi - lo));
  g.font = `${11 * pr}px Arial, Helvetica, sans-serif`;
  g.fillStyle = col('--muted'); g.strokeStyle = col('--line'); g.lineWidth = pr;
  g.textAlign = 'right'; g.textBaseline = 'middle';
  for (const v of [lo, (lo + hi) / 2, hi]) {
    g.beginPath(); g.moveTo(padL, Y(v)); g.lineTo(w, Y(v)); g.stroke();
    g.fillText(`${Math.round(v)} m`, padL - 5 * pr, Y(v));
  }
  g.textAlign = 'left'; g.textBaseline = 'bottom';
  g.fillText('0', padL, h);
  g.textAlign = 'right';
  g.fillText(`${fmtTicks(T)} car-ticks`, w, h);
  const line = (key: 'best' | 'mean', c: string, wd: number) => {
    if (!gens.length) return;
    g.strokeStyle = c; g.lineWidth = wd * pr; g.beginPath();
    gens.forEach((s, i) => { const x = X(s.ticksUsed), y = Y(s[key]); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.stroke();
  };
  line('mean', col('--muted'), 1.4);
  line('best', col('--accent'), 2.2);
}

