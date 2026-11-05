// A_RP, associative reward-penalty (trainers plan T3; Barto & Anandan 1985). The wheels are stochastic units that fire
// ±1 around their own output; one bit of reinforcement per tick (progress without a wall touch, or not) tells every
// unit whether to fire that way again (reward: Δw = ρ·(y − E[y])·x) or the other way (penalty: Δw = λρ·(−y − E[y])·x).
// The error reaches the hidden layers and the cells' learned fields by the delta rule (arpKernel.ts). Temperature
// scales the firing randomness (brain v2 plan §3ac).
import { CONFIG } from '../config';
import { GradTrainer, slopeRefusal } from './gradTrainer';
import { registerTrainer, tempScale, type Channel, type ProbeFrame } from './trainer';

const R = CONFIG.train.arp;

export class Arp extends GradTrainer {
  readonly id = 'arp';
  readonly label = 'A_RP';
  readonly channels: readonly Channel[] = ['signal', 'reward'];
  protected readonly kernel = 'arp' as const;
  /** Fraction of the last round's ticks that were rewarded. */
  rewardRate = 0;
  private lastTerm = new Float64Array(0);
  private readonly heat: number;

  constructor(o: ConstructorParameters<typeof GradTrainer>[0]) { super(o); this.heat = tempScale(o.temperature ?? 0); }

  /** The firing randomness this phase uses: s × the temperature's multiplier. */
  noise(): number { return R.noise * this.heat; }

  protected params(): number[] { return [this.noise(), R.penalty]; }

  protected update(sum: Float64Array, stats: Float64Array): Float64Array {
    const n = stats[1];
    if (!(n > 0)) throw new Error('A_RP: a round with no ticks');
    this.rewardRate = stats[0] / n;
    this.lastTerm = sum.map((g) => g / n);
    return this.lastTerm.map((g) => R.lr * g);
  }

  /** signal as every trainer; reward: per parameter, the last round's mean reinforced term δ·x. */
  probe(): ProbeFrame {
    const base = super.probe();
    const reward = this.lastTerm.length === this.w.length ? Float64Array.from(this.lastTerm) : new Float64Array(this.w.length);
    return { channels: { ...base.channels, reward } };
  }
}

registerTrainer('arp', (o) => new Arp(o), { label: 'A_RP', refusal: (spec) => slopeRefusal('A_RP', spec) });
