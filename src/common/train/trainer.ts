// Trainer seam (solo-loop plan §3b). A trainer changes weights only, never the architecture, and reaches the sim only
// through the metered Env. Only neuroevolution exists this milestone; later trainers (backprop, actor-critic, A_RP)
// plug in here and must pass contract.test.ts.
import type { Genome } from '../sim/spec';
import type { Env } from './env';

/** What the brain panel can draw. Every trainer has `signal`; gradient trainers add the others. */
export type Channel = 'signal' | 'delta' | 'reward' | 'value' | 'td';

export type TrainerEvent =
  | {
    type: 'generation';
    gen: number;
    best: number;
    mean: number;
    /** Population index of the champion (ties → lowest index). */
    champion: number;
    /** Champion weights, aligned to spec.conns. */
    championW: Float64Array;
    ticksUsed: number;
  }
  | { type: 'done'; ticksUsed: number; generations: number };

/** Per declared channel, one value per spec wire. */
export interface ProbeFrame { channels: Partial<Record<Channel, Float64Array>> }

export interface Trainer {
  readonly id: string;
  readonly channels: readonly Channel[];
  init(genome: Genome, seed: number, env: Env): void;
  /** Spend at most tickAllowance car-ticks (and never more than the env has left). */
  step(tickAllowance: number): Promise<TrainerEvent[]>;
  done(): boolean;
  /** Current best genome; same spec as the one given to init. */
  weights(): Genome;
  probe(): ProbeFrame;
}

export interface TrainerOptions {
  /** fresh: weights drawn from scratch · carry: slot 0 is the given genome exactly, the rest its mutants. */
  start: 'fresh' | 'carry';
}

export type TrainerFactory = (o: TrainerOptions) => Trainer;
const registry = new Map<string, TrainerFactory>();

export function registerTrainer(id: string, f: TrainerFactory): void {
  if (registry.has(id)) throw new Error(`trainer: ${id} registered twice`);
  registry.set(id, f);
}

export function createTrainer(id: string, o: TrainerOptions): Trainer {
  const f = registry.get(id);
  if (!f) throw new Error(`trainer: unknown ${id}`);
  return f(o);
}

export const trainerIds = (): string[] => [...registry.keys()];
