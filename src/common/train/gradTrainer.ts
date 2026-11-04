// The frame every gradient trainer shares (backprop now; actor-critic and A_RP next): lanes of cars drive the current
// weights in rounds (train/rollout.ts); after each round the lanes' summed update terms become one Δw. Every
// evalEvery car-ticks, and at the end, the current weights are scored with the training fitness on both training
// tracks (the same 60 s episodes and score evolution uses), as a 'generation' event: that is the fitness graph's
// point and the c-style "start vs end" comparison. weights() is always the current weights, and the last event is
// their score. All of it is charged to the same T as evolution.
import { CONFIG } from '../config';
import { derive, Rng, TAG } from '../rng';
import { specHash } from '../sim/brain';
import type { BrainSpec, Genome } from '../sim/spec';
import { meanFitness, type Env } from './env';
import { firstTickSignal } from './probe';
import { fresh, type KernelId, type Lane, type LaneOut } from './rollout';
import type { Channel, ProbeFrame, Trainer, TrainerEvent, TrainerOptions } from './trainer';

const G = CONFIG.train.grad;
const CAP = CONFIG.brain.weightCap;

/** The refusal every gradient trainer gives a brain with step neurons (they have no slope to follow). */
export function stepRefusal(label: string, spec: BrainSpec): string | null {
  const steps = spec.nodes.filter((n) => n.act === 'step').map((n) => n.id);
  if (!steps.length) return null;
  return `${label} follows the slope of every neuron, and step neurons have none (${steps.join(', ')}). `
    + 'Switch them to ReLU, sigmoid or tanh, or train with Evolution.';
}

export abstract class GradTrainer implements Trainer {
  abstract readonly id: string;
  abstract readonly label: string;
  abstract readonly channels: readonly Channel[];
  protected abstract readonly kernel: KernelId;
  /** The kernel's parameters for the next round. */
  protected abstract params(): number[];
  /** Δw (spec order) from a round's lane terms summed in lane order, and its summed stats. */
  protected abstract update(sum: Float64Array, stats: Float64Array): Float64Array;

  protected env: Env | null = null;
  protected genome: Genome | null = null;
  protected rng = new Rng(0);
  protected seed = 0;
  protected w: Float64Array = new Float64Array(0);
  /** The last round's Δw per wire (the `delta` channel). */
  protected lastDw: Float64Array = new Float64Array(0);
  protected rounds = 0;
  private lanes: Lane[] = [];
  private gen = 0;
  private lastEvalAt = 0;
  private scored = false;
  private finished = false;

  constructor(protected readonly opts: TrainerOptions) {}

  init(genome: Genome, seed: number, env: Env): void {
    if (specHash(genome.spec) !== specHash(env.setup.spec)) throw new Error(`${this.id}: genome spec differs from the env spec`);
    const why = stepRefusal(this.label, genome.spec);
    if (why) throw new Error(why);
    this.env = env;
    this.genome = genome;
    this.seed = derive(seed, TAG.trainer);
    this.rng = new Rng(this.seed);
    const nW = genome.spec.conns.length;
    this.w = this.opts.start === 'fresh' ? freshWeights(genome.spec, this.rng) : Float64Array.from(genome.w);
    this.lastDw = new Float64Array(nW);
    this.lanes = fresh(G.lanes);
    this.rounds = 0;
    this.gen = 0;
    this.lastEvalAt = 0;
    this.scored = false;
    this.finished = false;
  }

  protected need(): Env {
    if (!this.env) throw new Error(`${this.id}: step before init`);
    return this.env;
  }

  done(): boolean { return this.finished; }

  /** Fraction of T spent so far (for schedules). */
  protected progress(): number {
    const env = this.need();
    return Math.min(1, env.used / env.budget);
  }

  async step(tickAllowance: number): Promise<TrainerEvent[]> {
    const env = this.need();
    const events: TrainerEvent[] = [];
    const roundCost = G.lanes * G.roundTicks, evalCost = env.worstCase(1);
    let spent = 0;
    while (!this.finished) {
      const due = this.gen === 0 || (!this.scored && env.used - this.lastEvalAt >= G.evalEvery);
      const ending = env.remaining() < roundCost + evalCost;
      if (due || (ending && !this.scored)) {
        if (evalCost > env.remaining()) { this.finish(events); break; } // T too small to score anything
        if (spent + evalCost > tickAllowance) break;
        const before = env.used;
        await this.score(events);
        spent += env.used - before;
        continue;
      }
      if (ending) { this.finish(events); break; }
      if (spent + roundCost > tickAllowance) break;
      await this.round();
      spent += roundCost;
    }
    return events;
  }

  private finish(events: TrainerEvent[]): void {
    this.finished = true;
    events.push({ type: 'done', ticksUsed: this.need().used, generations: this.gen });
  }

  private async score(events: TrainerEvent[]): Promise<void> {
    const env = this.need();
    const fit = meanFitness((await env.runEpisodes([this.w]))[0]);
    this.gen++;
    this.lastEvalAt = env.used;
    this.scored = true;
    events.push({ type: 'generation', gen: this.gen, best: fit, mean: fit, champion: 0, championW: Float64Array.from(this.w), ticksUsed: env.used });
  }

  private async round(): Promise<void> {
    const env = this.need();
    const outs: LaneOut[] = await env.rollout({
      kernel: this.kernel, seed: this.seed, w: Float64Array.from(this.w), params: this.params(), ticks: G.roundTicks, lanes: this.lanes,
    });
    const sum = new Float64Array(outs[0].grad.length), stats = new Float64Array(outs[0].stats.length);
    for (const o of outs) { // lane order: the sum is the same whatever the worker split
      for (let i = 0; i < sum.length; i++) sum[i] += o.grad[i];
      for (let i = 0; i < stats.length; i++) stats[i] += o.stats[i];
    }
    this.lanes = outs.map((o) => o.lane);
    const dw = this.update(sum, stats);
    for (let i = 0; i < this.w.length; i++) {
      const before = this.w[i];
      this.w[i] = clampW(before + dw[i]);
      dw[i] = this.w[i] - before; // what actually changed (the cap can cut a step)
      if (!Number.isFinite(this.w[i])) throw new Error(`${this.id}: weight ${i} is not finite after round ${this.rounds + 1}`);
    }
    this.lastDw = dw;
    this.rounds++;
    this.scored = false;
  }

  weights(): Genome {
    const g = this.genome;
    if (!g) throw new Error(`${this.id}: weights before init`);
    return { spec: g.spec, w: Array.from(this.w) };
  }

  probe(): ProbeFrame {
    return { channels: { signal: firstTickSignal(this.need(), this.weights()), delta: Float64Array.from(this.lastDw) } };
  }
}

const clampW = (x: number): number => (x > CAP ? CAP : x < -CAP ? -CAP : x);

/**
 * A fresh start: w ~ N(0, initSd), except that wires into a ReLU start positive (|N|). A ReLU that is silent on every
 * input has slope 0 everywhere, so gradient descent can never wake it (a dead unit, measured: half the seeds lost
 * Starter's cruise neuron that way); the inputs are ≥ 0 but for road ahead, so positive weights start it firing.
 */
function freshWeights(spec: BrainSpec, rng: Rng): Float64Array {
  const relu = new Set(spec.nodes.filter((n) => n.act === 'relu').map((n) => n.id));
  return Float64Array.from(spec.conns, (c) => {
    const x = rng.normal() * G.initSd;
    return clampW(relu.has(c.to) && x < 0 ? -x : x);
  });
}
