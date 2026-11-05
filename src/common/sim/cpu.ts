// The nine vs CPU players (tracks plan §4, coordinator's calls 2026-11-05; rounds plan 2026-11-05 §1): each has a brain
// per round, made offline by scripts/sim/cpuBrains.ts and stored as JSON in src/assets/cpu/brains.json. Each round
// grows the last round's design within that round's budget and trains it from fresh weights (match-flow v2), as a
// player does, on a share of the round's T. Their names, in budget order (the first trains on 5% of T a round, the
// last on all of it), and the check every loaded set must pass: five rounds of nine valid genomes within each round's
// energy budget.
import { CONFIG } from '../config';
import { energyRefusal } from './energy';
import { validateGenome, type Genome } from './spec';

export const CPU_VERSION = 2;
/** Named after the people behind the methods (principal 2026-11-05; they replace Axon … Hippo), weakest budget first. */
export const CPU_NAMES = ['McCulloch', 'Pitts', 'Hebb', 'Rosenblatt', 'Holland', 'Werbos', 'Barto', 'Sutton', 'Hopfield'] as const;

export interface CpuBrain {
  name: string;
  /** How its design grows round to round (see the script). */
  design: string;
  /** Car-ticks of evolution it trained on this round, and its training seed and generations. */
  budget: number;
  seed: number;
  gens: number;
  genome: Genome;
}
/** rounds[r][k]: CPU player k's brain in round r + 1. */
export interface CpuSet { v: number; T: number; rounds: CpuBrain[][] }

/** The CPU set, checked: version, five rounds of the nine names in order, every genome valid and within its round's budget. */
export function cpuRounds(data: unknown): CpuBrain[][] {
  const d = data as CpuSet, R = CONFIG.rounds;
  if (d?.v !== CPU_VERSION || !Array.isArray(d.rounds) || d.rounds.length !== R.count) throw new Error(`cpu: not ${R.count} rounds of brains`);
  d.rounds.forEach((round, r) => {
    if (!Array.isArray(round) || round.length !== CPU_NAMES.length) throw new Error(`cpu: round ${r + 1} is not nine brains`);
    round.forEach((b, k) => {
      if (b.name !== CPU_NAMES[k]) throw new Error(`cpu: round ${r + 1} brain ${k} is ${b.name}, not ${CPU_NAMES[k]}`);
      validateGenome(b.genome);
      const why = energyRefusal(b.genome.spec, R.budgets[r]);
      if (why) throw new Error(`cpu: round ${r + 1} ${b.name}: ${why}`);
    });
  });
  return d.rounds;
}
