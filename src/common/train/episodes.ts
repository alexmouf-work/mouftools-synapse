// Episode batches: the unit of work the worker pools run. A setup names the spec, the training tracks (by seed; each
// worker builds its own) and their noise seeds; a batch is a block of weight vectors. Results come back in policy
// order, so the split across workers can never change them. Node (scripts/sim) and browser (src/client/workers)
// pools both call splitEven and EpisodeCore; the inline executor runs the same core on this thread.
import { CONFIG } from '../config';
import { compile, setWeights, zeroGenome, type Net } from '../sim/brain';
import { Runner } from '../sim/race';
import type { BrainSpec } from '../sim/spec';
import { generateTrack, type Track } from '../sim/track';

export interface EpisodeSetup {
  spec: BrainSpec;
  trackSeeds: number[];
  noiseSeeds: number[];
  budget: number;
  episodeTicks: number;
}

/** Per (policy, track): prog, wallTicks, ticks. */
export const RESULT_STRIDE = 3;

export interface Executor {
  readonly workers: number;
  setup(s: EpisodeSetup): Promise<void>;
  /** w holds `count` weight vectors back to back; returns count × tracks × RESULT_STRIDE values in policy order. */
  run(w: Float64Array, count: number): Promise<Float64Array>;
  close(): Promise<void>;
}

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
  constructor(readonly s: EpisodeSetup) {
    if (s.trackSeeds.length !== s.noiseSeeds.length) throw new Error('episodes: one noise seed per track');
    this.tracks = s.trackSeeds.map(generateTrack);
    this.net = compile(zeroGenome(s.spec));
  }
  run(w: Float64Array, count: number): Float64Array {
    const nW = this.s.spec.conns.length, nT = this.tracks.length;
    if (w.length !== count * nW) throw new Error(`episodes: ${w.length} weights for ${count} × ${nW}`);
    const out = new Float64Array(count * nT * RESULT_STRIDE);
    for (let p = 0; p < count; p++) {
      setWeights(this.net, w.subarray(p * nW, (p + 1) * nW));
      for (let k = 0; k < nT; k++) {
        const r = this.runner.run(this.net, this.tracks[k], {
          ticks: this.s.episodeTicks, budget: this.s.budget, noiseSeed: this.s.noiseSeeds[k], earlyStop: true,
        });
        const o = (p * nT + k) * RESULT_STRIDE;
        out[o] = r.prog; out[o + 1] = r.wallTicks; out[o + 2] = r.ticks;
      }
    }
    return out;
  }
}

export class InlineExecutor implements Executor {
  readonly workers = 1;
  private core: EpisodeCore | null = null;
  async setup(s: EpisodeSetup): Promise<void> { this.core = new EpisodeCore(s); }
  async run(w: Float64Array, count: number): Promise<Float64Array> {
    if (!this.core) throw new Error('episodes: run before setup');
    return this.core.run(w, count);
  }
  async close(): Promise<void> { this.core = null; }
}

export const defaultWorkers = (cores: number): number => Math.max(1, Math.min(cores - 1, CONFIG.pool.maxWorkers));
