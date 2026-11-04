// Backprop: copy a teacher (solo-loop plan §3b; principal 2026-10-30). The brain drives lanes of cars; the scripted
// pure-pursuit teacher (sim/teacher.ts) labels every state the brain sees (DAgger, imitate.ts), and the weights follow
// the generalised delta rule (grad.ts): output δ = (t − y)·f′(z), hidden δ = f′(z)·Σ w·δ, Δw = η·δ·x, the δ·x terms
// averaged over the round's samples. Step neurons are refused (no slope).
import { CONFIG } from '../config';
import { GradTrainer, stepRefusal } from './gradTrainer';
import { registerTrainer, type Channel } from './trainer';

const B = CONFIG.train.backprop;

export class Backprop extends GradTrainer {
  readonly id = 'backprop';
  readonly label = 'Backprop';
  readonly channels: readonly Channel[] = ['signal', 'delta'];
  protected readonly kernel = 'imitate' as const;
  /** Mean squared error per wheel over the last round. */
  loss = 0;

  /** DAgger's β: the chance a new episode is driven by the teacher. */
  beta(): number {
    const f = this.progress() / B.betaUntil;
    return f >= 1 ? 0 : B.betaStart * (1 - f);
  }

  protected params(): number[] { return [this.beta()]; }

  protected update(sum: Float64Array, stats: Float64Array): Float64Array {
    const n = stats[1];
    if (!(n > 0)) throw new Error('backprop: a round with no samples');
    this.loss = stats[0] / (4 * n);
    return sum.map((g) => (B.lr * g) / n);
  }
}

registerTrainer('backprop', (o) => new Backprop(o), { label: 'Backprop', refusal: (spec) => stepRefusal('Backprop', spec) });
