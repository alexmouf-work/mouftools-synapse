// Training view: Train on the workbench → the worker pool spends one phase's experience budget T on the brain's
// seeded tracks, while the swarm of the latest recorded generation drives training track 0 and a fitness graph
// grows. When done the champion's weights are saved with the brain; Train again continues from them (carry).
// Results never depend on speed: rendering, the worker count and the path recording only change how it looks.
import { CONFIG } from '../../../common/config';
import { genomeHash } from '../../../common/sim/brain';
import { generateTrack } from '../../../common/sim/track';
import { defaultWorkers } from '../../../common/train/episodes';
import { phaseSeeds, runPhase, type GenStat, type PhaseResult } from '../../../common/train/phase';
import type { Stage } from '../../render/stage';
import { BrowserPool } from '../../workers/pool';
import type { Saved } from '../workbench/store';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`training: #${id} missing`);
  return e as T;
};
const fmtTicks = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

export interface TrainingHooks {
  /** Save the trained brain (new weights and training history). */
  save(s: Saved): void;
  /** Leave for the workbench. */
  back(): void;
}

export interface TrainingStatus {
  state: 'running' | 'done' | 'stopped';
  seed: number; phase: number; start: 'fresh' | 'carry'; workers: number; T: number;
  gen: number; ticksUsed: number; shownGen: number; ghostCapacity: number;
  hash?: string; genome?: string; ms?: number; webgl: boolean; quality?: string;
  /** Frames drawn and the last frame's main-thread cost (ms), for the checks and for tuning. */
  frames: number; frameMs: number;
  probe?: () => { mean: number; sd: number; w: number; h: number };
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
    quality: q.get('quality') === 'low' ? 'low' as const : q.get('quality') === 'high' ? 'high' as const : undefined,
  };
}

function newSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0];
}

let stage: Stage | null = null;
let stopAsked = false;
let raf = 0;
let running = false;

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

  document.body.classList.add('training');
  $('trainView').hidden = false;
  $('tvName').textContent = saved.name;
  $('tvSeed').textContent = String(seed);
  $('tvRun').textContent = `${phase + 1}${start === 'carry' ? ' · continues from saved weights' : ' · from scratch'}`;
  setButtons('running');
  $('tvState').textContent = 'Training';

  // the scene (optional: training runs without WebGL)
  const canvas = $('scene') as HTMLCanvasElement;
  let webgl = true;
  try {
    if (!stage) {
      const { Stage } = await import('../../render/stage');
      stage = new Stage(canvas, p.quality);
    }
    stage.resize();
    stage.setTrack(generateTrack(seeds.trainTracks[0]));
  } catch (e) {
    console.warn('training: no 3-D view', e);
    webgl = false;
    stage = null;
    showNoGl();
  }
  const status: TrainingStatus = {
    state: 'running', seed, phase, start, workers, T, gen: 0, ticksUsed: 0, shownGen: 0, frames: 0, frameMs: 0,
    ghostCapacity: stage?.swarm.capacity ?? 0, webgl, quality: stage?.quality, probe: stage ? () => (stage as Stage).probe() : undefined,
  };
  window.__training = status;
  const gens: GenStat[] = [];
  drawGraph(gens, T);
  loop();

  const pool = new BrowserPool(workers);
  let consumed: unknown = null;
  let lastAsk = -Infinity;
  const pop = CONFIG.train.population;
  let result: PhaseResult;
  try {
    result = await runPhase(pool, genome.spec, seed, {
      T, phase, start, genome, now: () => performance.now(),
      stepTicks: (env) => env.worstCase(pop),
      beforeStep: (env) => {
        const now = performance.now();
        const maybeLast = env.remaining() < 2 * env.worstCase(pop);
        const swarmWants = stage ? stage.swarm.wantsNext() : false;
        if (stage && (maybeLast || (swarmWants && now - lastAsk >= 200))) { pool.record = true; lastAsk = now; }
      },
      onEvent: (e) => {
        if (e.type !== 'generation') return;
        gens.push({ gen: e.gen, best: e.best, mean: e.mean, ticksUsed: e.ticksUsed, champion: e.championW });
        if (stage && pool.lastPaths && pool.lastPaths !== consumed) {
          consumed = pool.lastPaths;
          stage.swarm.offer(pool.lastPaths, e.gen, e.champion);
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
    $('tvState').textContent = 'Trained';
    $('tvNote').textContent = `Done in ${(result.trainMs / 1000).toFixed(1)} s on ${workers} worker${workers === 1 ? '' : 's'}. The best brain of the last generation is saved; Train again continues from it on new tracks.`;
    setButtons('done');
    $('tvAgain').onclick = () => { void openTraining(next, hooks); };
  }
  $('tvBack').onclick = () => close(hooks);
}

function close(hooks: TrainingHooks) {
  if (running) return;
  cancelAnimationFrame(raf);
  raf = 0;
  $('trainView').hidden = true;
  document.body.classList.remove('training');
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
    const dt = Math.min((now - last) / 1000, 0.5);
    last = now;
    if (stage) {
      const c0 = performance.now();
      stage.frame(dt, (now - t0) / 1000);
      const cost = performance.now() - c0;
      if (window.__training) { window.__training.frames++; window.__training.frameMs = cost; }
      // While training, drawing must not starve the worker pool. An expensive frame (a weak GPU) is kept to about a
      // fifth of this thread; a software rasteriser (quality low) draws on the same CPU cores the workers use, so it
      // gets 4 frames a second.
      nextAt = !running ? 0 : stage.quality === 'low' ? c0 + 250 : cost > 8 ? c0 + 5 * cost : 0;
      const g = stage.swarm.shownGen;
      if (window.__training) window.__training.shownGen = g;
      $('tvShown').textContent = g ? `gen ${g} · ${stage.swarm.mesh.count} cars` : 'waiting for the first generation';
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

function showNoGl() {
  const p = document.createElement('p');
  p.className = 'tv-nogl';
  p.textContent = 'The 3-D view needs WebGL, which this browser has turned off. Training still runs; the numbers are on the left.';
  $('trainView').appendChild(p);
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
  g.font = `${11 * pr}px "IBM Plex Mono", ui-monospace, monospace`;
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

window.addEventListener('resize', () => { stage?.resize(); });
