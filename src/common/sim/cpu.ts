// The nine vs CPU brains (tracks plan §4, coordinator's calls 2026-11-05): trained offline by scripts/sim/cpuBrains.ts
// and stored as JSON in src/assets/cpu/brains.json. Their names, in budget order (the first trained on 5% of T, the
// last on all of it), and the check every loaded set must pass: nine valid genomes that a player could race.
import { energyRefusal } from './energy';
import { validateGenome, type Genome } from './spec';

export const CPU_VERSION = 1;
/** Fixed names on the brain theme (coordinator 2026-11-05), weakest budget first. */
export const CPU_NAMES = ['Axon', 'Dendrite', 'Soma', 'Myelin', 'Glia', 'Cortex', 'Ganglion', 'Thalamus', 'Hippo'] as const;

export interface CpuBrain {
  name: string;
  /** 'starter:<seed>' (a random starter) or a sighted design's name. */
  design: string;
  /** Car-ticks of evolution it trained on, and its training seed and generations. */
  budget: number;
  seed: number;
  gens: number;
  genome: Genome;
}
export interface CpuSet { v: number; T: number; brains: CpuBrain[] }

/** The CPU set, checked: version, the nine names in order, every genome valid and within the match energy limit. */
export function cpuBrains(data: unknown): CpuBrain[] {
  const d = data as CpuSet;
  if (d?.v !== CPU_VERSION || !Array.isArray(d.brains) || d.brains.length !== CPU_NAMES.length) throw new Error('cpu: not a set of nine brains');
  d.brains.forEach((b, k) => {
    if (b.name !== CPU_NAMES[k]) throw new Error(`cpu: brain ${k} is ${b.name}, not ${CPU_NAMES[k]}`);
    validateGenome(b.genome);
    const why = energyRefusal(b.genome.spec, 'match');
    if (why) throw new Error(`cpu: ${b.name}: ${why}`);
  });
  return d.brains;
}
