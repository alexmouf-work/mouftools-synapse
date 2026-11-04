// Episode batches: the unit of work the worker pools run. A setup names the spec, the training tracks (by seed; each
// worker builds its own) and their noise seeds; a batch is a block of weight vectors. Results come back in policy
// order, so the split across workers can never change them. Node (scripts/sim) and browser (src/client/workers)
// pools both call splitEven and EpisodeCore; the inline executor runs the same core on this thread.
import { CONFIG } from '../config';
import { compile, setWeights, zeroGenome, type Net } from '../sim/brain';
import { newRecording, Runner, type Recording } from '../sim/race';
import { paramCount, type BrainSpec } from '../sim/spec';
import { generateTrack, type Track } from '../sim/track';
import { KERNELS } from './kernels';
import { RolloutCore, type LaneOut, type RolloutJob } from './rollout';

export interface EpisodeSetup {
  spec: BrainSpec;
  trackSeeds: number[];
  episodeTicks: number;
}

/** Per (policy, track): prog, wallTicks, ticks. */
export const RESULT_STRIDE = 3;

/**
 * Display-only paths on training track 0 of a chosen handful of a run's policies (the training view's ghosts, B6), with
 * their weights (for the highlighted car's live brain). Recording never changes a result: the same run with and
 * without it gives the same numbers (tested).
 */
export const PATH_EVERY = 2; // ticks between samples
export const PATH_STRIDE = 5; // x, y, hdg, v, wall (1 if touching a wall)
export interface Paths {
  /** Policies recorded. */
  count: number;
  /** Their indices in the run (ascending). */
  ids: Int32Array;
  /** Their weight vectors, count × nW. */
  w: Float64Array;
  nW: number;
  /**
   * The highlighted one (index into this handful): the furthest along track 0 (the first on a tie), its progress (m),
   * and every node's output per tick of its run (ticks × nN), for the live brain panel without replaying it.
   */
  hl: number;
  hlProg: number;
  act: Float64Array;
  nN: number;
  /** Sample slots per policy (episodeTicks / PATH_EVERY, rounded up). */
  samples: number;
  /** count × samples × PATH_STRIDE. */
  data: Float64Array;
  /** Ticks each policy ran on track 0 (episodes stop early on a stall). */
  ticks: Int32Array;
}

export interface Executor {
  readonly workers: number;
  setup(s: EpisodeSetup): Promise<void>;
  /** w holds `count` weight vectors back to back; returns count × tracks × RESULT_STRIDE values in policy order. */
  run(w: Float64Array, count: number): Promise<Float64Array>;
  /** A gradient trainer's round (train/rollout.ts): lanes split with splitEven, results in lane order. */
  rollout(job: RolloutJob): Promise<LaneOut[]>;
  close(): Promise<void>;
  /**
   * If the executor supports it: on the next run, record the track-0 paths of the policies this picks (given the run's
   * policy count) into lastPaths (display only).
   */
  record?: ((count: number) => readonly number[]) | null;
  lastPaths?: Paths | null;
}

export const pathSamples = (episodeTicks: number): number => Math.ceil(episodeTicks / PATH_EVERY);

/** Contiguous ranges [start, end) for each worker; empty ranges dropped. */
export function splitEven(count: number, workers: number): [number, number][] {
  const out: [number, number][] = [];
  const base = Math.floor(count / workers), extra = count % workers;
  let s = 0;
  for (let k = 0; k < workers; k++) {
    const n = base + (k < extra ? 1 : 0);
    if (n > 0) out.push([s, s + n]);
    s += n;
  }
  return out;
}

export class EpisodeCore {
  readonly tracks: Track[];
  private readonly net: Net;
  private readonly runner = new Runner();
  private rec: Recording | null = null;
  private lanes: RolloutCore | null = null;
  constructor(readonly s: EpisodeSetup) {
    this.tracks = s.trackSeeds.map(generateTrack);
    this.net = compile(zeroGenome(s.spec));
  }
  rollout(job: RolloutJob): LaneOut[] {
    return (this.lanes ??= new RolloutCore(this.s, this.tracks, KERNELS)).run(job);
  }
  /**
   * Run `count` policies; with `pick` (policy indices of the whole run, this block starting at `base`), also record
   * the track-0 paths and weights of the picked ones in this block.
   */
  run(w: Float64Array, count: number, pick: readonly number[] | null = null, base = 0): { out: Float64Array; paths: Paths | null } {
    const nW = paramCount(this.s.spec), nT = this.tracks.length;
    if (w.length !== count * nW) throw new Error(`episodes: ${w.length} weights for ${count} × ${nW}`);
    const out = new Float64Array(count * nT * RESULT_STRIDE);
    const S = pathSamples(this.s.episodeTicks);
    const mine = pick && nT > 0 ? [...new Set(pick)].filter((i) => i >= base && i < base + count).sort((a, b) => a - b) : null;
    const slot = new Map((mine ?? []).map((i, k) => [i - base, k]));
    const n = mine?.length ?? 0;
    const paths: Paths | null = mine
      ? { count: n, ids: Int32Array.from(mine), w: new Float64Array(n * nW), nW, hl: -1, hlProg: -Infinity, act: new Float64Array(0), nN: this.net.nNodes, samples: S, data: new Float64Array(n * S * PATH_STRIDE), ticks: new Int32Array(n) } : null;
    if (n && !this.rec) this.rec = newRecording(this.net, this.s.episodeTicks);
    for (let p = 0; p < count; p++) {
      const wp = w.subarray(p * nW, (p + 1) * nW);
      setWeights(this.net, wp);
      const q0 = slot.get(p);
      if (paths && q0 !== undefined) paths.w.set(wp, q0 * nW);
      for (let k = 0; k < nT; k++) {
        const rec = paths && q0 !== undefined && k === 0 ? (this.rec as Recording) : undefined;
        const r = this.runner.run(this.net, this.tracks[k], {
          ticks: this.s.episodeTicks, earlyStop: true, record: rec,
        });
        const o = (p * nT + k) * RESULT_STRIDE;
        out[o] = r.prog; out[o + 1] = r.wallTicks; out[o + 2] = r.ticks;
        if (paths && rec && q0 !== undefined) {
          paths.ticks[q0] = r.ticks;
          if (r.prog > paths.hlProg) { paths.hl = q0; paths.hlProg = r.prog; paths.act = rec.act.slice(0, r.ticks * this.net.nNodes); }
          for (let j = 0; j * PATH_EVERY < r.ticks; j++) {
            const t = j * PATH_EVERY, q = (q0 * S + j) * PATH_STRIDE;
            let wall = 0;
            for (let u = t; u < Math.min(t + PATH_EVERY, r.ticks); u++) wall |= rec.wall[u];
            paths.data[q] = rec.x[t]; paths.data[q + 1] = rec.y[t]; paths.data[q + 2] = rec.hdg[t];
            paths.data[q + 3] = rec.v[t]; paths.data[q + 4] = wall;
          }
        }
      }
    }
    return { out, paths };
  }
}

/** Split a round's lanes into per-worker jobs (contiguous, splitEven), for the pools. */
export function splitJob(job: RolloutJob, workers: number): RolloutJob[] {
  return splitEven(job.lanes.length, workers).map(([a, b]) => ({ ...job, lanes: job.lanes.slice(a, b) }));
}

/** Join per-worker path blocks (in policy order) into one. */
export function joinPaths(parts: Paths[], samples: number, nW: number): Paths {
  const count = parts.reduce((a, p) => a + p.count, 0);
  const data = new Float64Array(count * samples * PATH_STRIDE), ticks = new Int32Array(count), ids = new Int32Array(count), w = new Float64Array(count * nW);
  let at = 0, hl = -1, hlProg = -Infinity, act: Float64Array = new Float64Array(0), nN = parts[0]?.nN ?? 0;
  for (const p of parts) {
    data.set(p.data, at * samples * PATH_STRIDE); ticks.set(p.ticks, at); ids.set(p.ids, at); w.set(p.w, at * nW);
    if (p.count && p.hlProg > hlProg) { hl = at + p.hl; hlProg = p.hlProg; act = p.act; nN = p.nN; }
    at += p.count;
  }
  return { count, ids, w, nW, hl, hlProg, act, nN, samples, data, ticks };
}

export class InlineExecutor implements Executor {
  readonly workers = 1;
  private core: EpisodeCore | null = null;
  async setup(s: EpisodeSetup): Promise<void> { this.core = new EpisodeCore(s); }
  record: ((count: number) => readonly number[]) | null = null;
  lastPaths: Paths | null = null;
  async run(w: Float64Array, count: number): Promise<Float64Array> {
    if (!this.core) throw new Error('episodes: run before setup');
    const r = this.core.run(w, count, this.record ? this.record(count) : null);
    if (r.paths) this.lastPaths = r.paths;
    this.record = null;
    return r.out;
  }
  async rollout(job: RolloutJob): Promise<LaneOut[]> {
    if (!this.core) throw new Error('episodes: rollout before setup');
    return this.core.rollout(job);
  }
  async close(): Promise<void> { this.core = null; }
}

export const defaultWorkers = (cores: number): number => Math.max(1, Math.min(cores - 1, CONFIG.pool.maxWorkers));
