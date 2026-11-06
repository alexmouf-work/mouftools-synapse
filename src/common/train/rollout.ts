// Rollouts for the gradient trainers: B lanes, each one car driving the current weights tick by tick, learning as it
// goes. A round runs every lane for the same number of ticks with the weights fixed; each lane returns its own sum of
// per-tick updates (a "kernel" decides what that is: imitate.ts for backprop, acKernel.ts for actor-critic, arpKernel.ts
// for A_RP), and the trainer adds the lanes up in lane
// order and updates the weights once (batched, synchronous). A lane's whole state travels with the job, so the worker
// that runs it never matters: the same lanes give the same bits on 1 or N workers, inline, in Node or in a browser.
import { hashU } from '../rng';
import { compile, setWeights, zeroGenome, type Net } from '../sim/brain';
import { startCar, type CarState } from '../sim/car';
import { Runner, stopCheck } from '../sim/race';
import { paramCount } from '../sim/spec';
import type { Track } from '../sim/track';
import type { EpisodeSetup } from './episodes';

export type KernelId = 'imitate' | 'actorCritic' | 'arp';

export interface Lane {
  /** Fixed lane number: seeds where its episodes start. */
  id: number;
  /** Episodes this lane has started. */
  episode: number;
  track: number;
  /** Stall-rule mark (race.stopCheck). */
  mark: number;
  /** Kernel-specific, fixed for the episode (imitate: 1 = the teacher drives this episode; actor-critic and A_RP: the
   *  episode's noise seed). */
  mode: number;
  /** null before the first episode and after one ends. */
  car: CarState | null;
}

export interface RolloutJob {
  kernel: KernelId;
  /** The trainer's seed (lane starts and episode draws use it). */
  seed: number;
  /** Weights in spec wire order. */
  w: Float64Array;
  /** Kernel parameters (see each kernel). */
  params: number[];
  /** Ticks every lane runs this round (across episode ends). */
  ticks: number;
  lanes: Lane[];
}

export interface LaneOut {
  lane: Lane;
  ticks: number;
  /** The lane's summed per-tick update terms (kernel.gradSize values). */
  grad: Float64Array;
  /** Kernel statistics (kernel.statSize values). */
  stats: Float64Array;
}

/** What a kernel sees: the setup's tracks, a net holding the round's weights, a runner. */
export interface KernelCtx {
  setup: EpisodeSetup;
  tracks: Track[];
  net: Net;
  runner: Runner;
}

export interface Kernel {
  gradSize(net: Net): number;
  statSize: number;
  /** Called when a lane starts an episode (after its car is placed). */
  episodeStart(ctx: KernelCtx, job: RolloutJob, lane: Lane): void;
  /** One tick of lane (its car is live; the core applies the stop rule after it). Adds into grad and stats. */
  tick(ctx: KernelCtx, job: RolloutJob, lane: Lane, grad: Float64Array, stats: Float64Array): void;
  /** Called when a lane begins its share of a round (its car may be mid-episode from the last round). */
  laneStart?(ctx: KernelCtx, job: RolloutJob, lane: Lane): void;
  /** Called after the tick that ends an episode (stall, backwards or time), before the car is dropped. */
  episodeEnd?(ctx: KernelCtx, job: RolloutJob, lane: Lane, grad: Float64Array, stats: Float64Array): void;
  /** Called when a lane has run its share of the round (its car may carry on next round). */
  laneEnd?(ctx: KernelCtx, job: RolloutJob, lane: Lane, grad: Float64Array, stats: Float64Array): void;
}

export const fresh = (count: number): Lane[] =>
  Array.from({ length: count }, (_, id) => ({ id, episode: 0, track: 0, mark: 0, mode: 0, car: null }));

/** Where lane id's episode e starts: alternate tracks, a seeded place along the track, at rest. */
function startEpisode(ctx: KernelCtx, job: RolloutJob, lane: Lane): void {
  const nT = ctx.tracks.length;
  lane.track = (lane.id + lane.episode) % nT;
  const t = ctx.tracks[lane.track];
  const at = (t.startIdx + Math.floor(hashU(job.seed, lane.id, 2 * lane.episode) * t.n)) % t.n;
  lane.car = startCar(t, at);
  lane.mark = 0;
  lane.episode++;
}

export class RolloutCore {
  private net: Net;
  private readonly runner = new Runner();
  constructor(readonly setup: EpisodeSetup, readonly tracks: Track[], private readonly kernels: Record<KernelId, Kernel>) {
    this.net = compile(zeroGenome(setup.spec), setup.power);
  }

  run(job: RolloutJob): LaneOut[] {
    const nW = paramCount(this.setup.spec);
    if (job.w.length !== nW) throw new Error(`rollout: ${job.w.length} weights, spec has ${nW} wires`);
    if (this.tracks.length === 0) throw new Error('rollout: no training tracks');
    const k = this.kernels[job.kernel];
    if (!k) throw new Error(`rollout: unknown kernel ${job.kernel}`);
    setWeights(this.net, job.w);
    const ctx: KernelCtx = { setup: this.setup, tracks: this.tracks, net: this.net, runner: this.runner };
    const ep = this.setup.episodeTicks;
    return job.lanes.map((lane0) => {
      const lane: Lane = { ...lane0, car: lane0.car ? { ...lane0.car, padLap: [...lane0.car.padLap] } : null };
      const grad = new Float64Array(k.gradSize(this.net)), stats = new Float64Array(k.statSize);
      k.laneStart?.(ctx, job, lane);
      for (let i = 0; i < job.ticks; i++) {
        if (!lane.car) { startEpisode(ctx, job, lane); k.episodeStart(ctx, job, lane); }
        k.tick(ctx, job, lane, grad, stats);
        const c = lane.car as CarState;
        lane.mark = stopCheck(c, lane.mark);
        if (lane.mark < 0 || c.tick >= ep) { k.episodeEnd?.(ctx, job, lane, grad, stats); lane.car = null; }
      }
      k.laneEnd?.(ctx, job, lane, grad, stats);
      return { lane, ticks: job.ticks, grad, stats };
    });
  }
}

/** A uniform draw for the episode a lane has just started, independent of where it starts. */
export const episodeDraw = (seed: number, lane: Lane): number => hashU(seed, lane.id, 2 * lane.episode + 1);
