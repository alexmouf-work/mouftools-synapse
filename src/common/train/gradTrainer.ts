// The frame every gradient trainer shares (backprop now; actor-critic and A_RP next): lanes of cars drive the current
// weights in rounds (train/rollout.ts); after each round the lanes' summed update terms become one Δw. Every
// evalEvery car-ticks, and at the end, the current weights are scored with the training fitness on both training
// tracks (the same 60 s episodes and score evolution uses), as a 'generation' event: that is the fitness graph's
// point and the c-style "start vs end" comparison. weights() is always the current weights, and the last event is
// their score. All of it is charged to the same T as evolution.
import { CONFIG } from '../config';
import { derive, Rng, TAG } from '../rng';
import { specHash } from '../sim/brain';
import { columns, paramCount, type BrainSpec, type Genome } from '../sim/spec';
import { meanFitness, type Env } from './env';
import { firstTickSignal } from './probe';
import { fresh, type KernelId, type Lane, type LaneOut } from './rollout';
import type { Channel, ProbeFrame, Trainer, TrainerEvent, TrainerOptions } from './trainer';

const G = CONFIG.train.grad;
const CAP = CONFIG.brain.weightCap;

/**
 * Why a gradient trainer can't train this brain, or null. Every function offered (linear, ReLU, sigmoid, tanh) has a
 * slope, on every layer, so nothing is refused now; step, which had none, is gone (2026-11-04).
 */
export const slopeRefusal = (_label: string, _spec: BrainSpec): string | null => null;

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
    const why = slopeRefusal(this.label, genome.spec);
    if (why) throw new Error(why);
    this.env = env;
    this.genome = genome;
    this.seed = derive(seed, TAG.trainer);
    this.rng = new Rng(this.seed);
    const nW = paramCount(genome.spec);
    this.w = this.opts.start === 'fresh' ? freshWeights(genome, this.rng) : Float64Array.from(genome.w);
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
    // with a generations count (sandbox Train), one fitness check per generation's share of the budget
    const every = this.opts.generations ? Math.max(roundCost, Math.floor(env.budget / this.opts.generations)) : G.evalEvery;
    let spent = 0;
    while (!this.finished) {
      const due = this.gen === 0 || (!this.scored && env.used - this.lastEvalAt >= every);
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
 * Adam (Kingma & Ba 2014) on an ascent direction d (a round's mean update term): m ← β1·m + (1 − β1)·d,
 * v ← β2·v + (1 − β2)·d², Δw = lr · m̂ / (√v̂ + ε) with the bias corrections. Plain loops in parameter order, so the
 * same rounds give the same bits on any engine (fast gradient trainers plan, step 3).
 */
export class Adam {
  private m: Float64Array;
  private v: Float64Array;
  private t = 0;
  constructor(n: number) { this.m = new Float64Array(n); this.v = new Float64Array(n); }
  step(d: ArrayLike<number>, lr: number): Float64Array {
    if (this.m.length !== d.length) { this.m = new Float64Array(d.length); this.v = new Float64Array(d.length); this.t = 0; }
    const { beta1: b1, beta2: b2, eps } = CONFIG.train.adam, n = this.m.length, out = new Float64Array(n);
    this.t++;
    let p1 = 1, p2 = 1;
    for (let k = 0; k < this.t; k++) { p1 *= b1; p2 *= b2; } // β^t by repeated product (no engine pow)
    const c1 = 1 - p1, c2 = 1 - p2;
    for (let i = 0; i < n; i++) {
      const g = d[i];
      this.m[i] = b1 * this.m[i] + (1 - b1) * g;
      this.v[i] = b2 * this.v[i] + (1 - b2) * g * g;
      out[i] = (lr * (this.m[i] / c1)) / (Math.sqrt(this.v[i] / c2) + eps);
    }
    return out;
  }
}

/**
 * A fresh start: every weight and bias ~ N(0, initSd), except that wires into a ReLU layer, and its biases, start
 * positive (|N|). A ReLU that is silent on
 * every input has slope 0 everywhere, so gradient descent can never wake it (a dead unit; measured in T1: half the
 * seeds lost the old Starter's cruise neuron that way); positive weights from mostly positive rates start it firing.
 */
function freshWeights(genome: Genome, rng: Rng): Float64Array {
  const spec = genome.spec, C = columns(spec), out = new Float64Array(paramCount(spec));
  let k = 0;
  for (let i = 0; i + 1 < C.length; i++) {
    const relu = i < spec.layers.length && spec.layers[i].fn === 'relu';
    for (let a = 0; a < C[i].length; a++) for (let b = 0; b < C[i + 1].length; b++) {
      const x = rng.normal() * G.initSd;
      out[k++] = clampW(relu && x < 0 ? -x : x);
    }
  }
  // the biases: hidden neurons layer by layer, then the wheels
  for (let i = 1; i < C.length; i++) {
    const relu = i <= spec.layers.length && spec.layers[i - 1].fn === 'relu';
    for (let b = 0; b < C[i].length; b++) { const x = rng.normal() * G.initSd; out[k++] = clampW(relu && x < 0 ? -x : x); }
  }
  // the cells' fields start as given (their even spread, or what they learned before)
  for (; k < out.length; k++) out[k] = clampW(genome.w[k]);
  return out;
}
