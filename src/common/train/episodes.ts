// Episode batches: the unit of work the worker pools run. A setup names the spec, the training tracks (by seed; each
// worker builds its own) and their noise seeds; a batch is a block of weight vectors. Results come back in policy
// order, so the split across workers can never change them. Node (scripts/sim) and browser (src/client/workers)
// pools both call splitEven and EpisodeCore; the inline executor runs the same core on this thread.
import { CONFIG } from '../config';
import { compile, setWeights, zeroGenome, type Net } from '../sim/brain';
import { newRecording, Runner, type Recording } from '../sim/race';
import type { BrainSpec } from '../sim/spec';
import { generateTrack, type Track } from '../sim/track';

export interface EpisodeSetup {
  spec: BrainSpec;
  trackSeeds: number[];
  noiseSeeds: number[];
  /** Energy pool per episode (energy.poolFor(episodeTicks): the minute's budget prorated, review call 2026-10-31). */
  pool: number;
  episodeTicks: number;
}

/** Per (policy, track): prog, wallTicks, ticks. */
export const RESULT_STRIDE = 3;

/**
 * Display-only paths of every policy on training track 0 (the training view's ghost swarm). Recording never
 * changes a result: the same run with and without it gives the same numbers (tested).
 */
export const PATH_EVERY = 2; // ticks between samples
export const PATH_STRIDE = 5; // x, y, hdg, v, wall (1 if touching a wall)
export interface Paths {
  count: number;
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
  close(): Promise<void>;
  /** If the executor supports it: record track-0 paths on the next run into lastPaths (display only). */
  record?: boolean;
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
  constructor(readonly s: EpisodeSetup) {
    if (s.trackSeeds.length !== s.noiseSeeds.length) throw new Error('episodes: one noise seed per track');
    this.tracks = s.trackSeeds.map(generateTrack);
    this.net = compile(zeroGenome(s.spec));
  }
  run(w: Float64Array, count: number, record = false): { out: Float64Array; paths: Paths | null } {
    const nW = this.s.spec.conns.length, nT = this.tracks.length;
    if (w.length !== count * nW) throw new Error(`episodes: ${w.length} weights for ${count} × ${nW}`);
    const out = new Float64Array(count * nT * RESULT_STRIDE);
    const S = pathSamples(this.s.episodeTicks);
    const paths: Paths | null = record && nT > 0
      ? { count, samples: S, data: new Float64Array(count * S * PATH_STRIDE), ticks: new Int32Array(count) } : null;
    if (paths && !this.rec) this.rec = newRecording(this.net, this.s.episodeTicks);
    for (let p = 0; p < count; p++) {
      setWeights(this.net, w.subarray(p * nW, (p + 1) * nW));
      for (let k = 0; k < nT; k++) {
        const rec = paths && k === 0 ? (this.rec as Recording) : undefined;
        const r = this.runner.run(this.net, this.tracks[k], {
          ticks: this.s.episodeTicks, pool: this.s.pool, noiseSeed: this.s.noiseSeeds[k], earlyStop: true, record: rec,
        });
        const o = (p * nT + k) * RESULT_STRIDE;
        out[o] = r.prog; out[o + 1] = r.wallTicks; out[o + 2] = r.ticks;
        if (paths && rec) {
          paths.ticks[p] = r.ticks;
          for (let j = 0; j * PATH_EVERY < r.ticks; j++) {
            const t = j * PATH_EVERY, q = (p * S + j) * PATH_STRIDE;
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

/** Join per-worker path blocks (in policy order) into one. */
export function joinPaths(parts: Paths[], samples: number): Paths {
  const count = parts.reduce((a, p) => a + p.count, 0);
  const data = new Float64Array(count * samples * PATH_STRIDE), ticks = new Int32Array(count);
  let at = 0;
  for (const p of parts) { data.set(p.data, at * samples * PATH_STRIDE); ticks.set(p.ticks, at); at += p.count; }
  return { count, samples, data, ticks };
}

export class InlineExecutor implements Executor {
  readonly workers = 1;
  private core: EpisodeCore | null = null;
  async setup(s: EpisodeSetup): Promise<void> { this.core = new EpisodeCore(s); }
  record = false;
  lastPaths: Paths | null = null;
  async run(w: Float64Array, count: number): Promise<Float64Array> {
    if (!this.core) throw new Error('episodes: run before setup');
    const r = this.core.run(w, count, this.record);
    if (r.paths) this.lastPaths = r.paths;
    this.record = false;
    return r.out;
  }
  async close(): Promise<void> { this.core = null; }
}

export const defaultWorkers = (cores: number): number => Math.max(1, Math.min(cores - 1, CONFIG.pool.maxWorkers));
