// Actor-critic (trainers plan T2; order 2026-10-30: after evolution and backprop). The brain is the actor; a linear
// critic owned by the trainer estimates V(s) from what the brain sees and computes (acKernel.ts). Lanes drive with
// Gaussian exploration on the wheels (σ times the temperature, brain v2 plan §3ac); every round the TD error δ moves
// both: actor Δw = α·δ·∂log π/∂w (by the delta rule through every layer and into the cells' learned fields), critic
// Δv = β·δ·∇V, each averaged over the round's transitions. The critic starts at 0 every phase; only the brain is kept.
import { CONFIG } from '../config';
import { compile } from '../sim/brain';
import type { Genome } from '../sim/spec';
import { criticSize } from './acKernel';
import type { Env } from './env';
import { GradTrainer, slopeRefusal } from './gradTrainer';
import { registerTrainer, tempScale, type Channel, type ProbeFrame } from './trainer';

const A = CONFIG.train.ac;

export class ActorCritic extends GradTrainer {
  readonly id = 'ac';
  readonly label = 'Actor-critic';
  readonly channels: readonly Channel[] = ['signal', 'value', 'td'];
  protected readonly kernel = 'actorCritic' as const;
  /** The critic's weights over [1, input cells, hidden neurons, speed]. */
  v: Float64Array = new Float64Array(0);
  /** Over the last round: mean δ², mean reward per tick, mean V(s). */
  tdErr = 0;
  reward = 0;
  value = 0;
  private lastTd = new Float64Array(0);
  /** Per parameter, the critic node it belongs to (its wire's sender, its neuron, its cell), or −1 (wheels). */
  private critOf = new Int32Array(0);
  private readonly heat: number;

  constructor(o: ConstructorParameters<typeof GradTrainer>[0]) { super(o); this.heat = tempScale(o.temperature ?? 0); }

  init(genome: Genome, seed: number, env: Env): void {
    super.init(genome, seed, env);
    const net = compile(genome);
    this.v = new Float64Array(criticSize(net));
    this.lastTd = new Float64Array(this.w.length);
    const of = new Int32Array(this.w.length).fill(-1);
    for (let c = 0; c < net.w.length; c++) of[net.specIdx[c]] = 1 + net.from[c];
    for (let d = net.nIn; d < net.outStart; d++) of[net.wires + d - net.nIn] = 1 + d;
    for (let i = 0; i < net.nIn; i++) for (let j = net.fieldAt[i], e = i + 1 < net.nIn ? net.fieldAt[i + 1] : this.w.length; j < e; j++) of[j] = 1 + i;
    this.critOf = of;
  }

  /** The exploration now: σ falling linearly over T (as evolution's mutation size does), × the temperature's multiplier. */
  sigma(): number { return (A.sigma + (A.sigmaEnd - A.sigma) * this.progress()) * this.heat; }

  protected params(): number[] { return [this.sigma(), A.gamma, A.lambda, ...this.v]; }

  protected update(sum: Float64Array, stats: Float64Array): Float64Array {
    const n = stats[1], nP = this.w.length;
    if (sum.length - nP !== this.v.length) throw new Error(`actor-critic: ${sum.length - nP} critic terms, critic has ${this.v.length}`);
    const dw = new Float64Array(nP);
    if (!(n > 0)) return dw; // no transition settled (cannot happen with whole rounds; kept safe)
    for (let i = 0; i < nP; i++) { this.lastTd[i] = sum[i] / n; dw[i] = A.alpha * this.lastTd[i]; }
    for (let j = 0; j < this.v.length; j++) {
      this.v[j] += (A.beta * sum[nP + j]) / n;
      if (!Number.isFinite(this.v[j])) throw new Error(`actor-critic: critic weight ${j} is not finite after round ${this.rounds + 1}`);
    }
    this.tdErr = stats[0] / n;
    this.reward = stats[2] / n;
    this.value = stats[3] / n;
    return dw;
  }

  /** signal as every trainer; value: per parameter, the critic's weight on the node it belongs to; td: the last
   *  round's mean δ·e (the direction the actor climbed). */
  probe(): ProbeFrame {
    const base = super.probe();
    const value = Float64Array.from(this.critOf, (j) => (j >= 0 ? this.v[j] : 0));
    return { channels: { ...base.channels, value, td: Float64Array.from(this.lastTd) } };
  }
}

registerTrainer('ac', (o) => new ActorCritic(o), { label: 'Actor-critic', refusal: (spec) => slopeRefusal('Actor-critic', spec) });
