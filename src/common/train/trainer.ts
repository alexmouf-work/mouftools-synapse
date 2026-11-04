// Trainer seam (solo-loop plan §3b). A trainer changes weights only, never the architecture, and reaches the sim only
// through the metered Env. Every registered trainer must pass contract.test.ts: evolution (neuroevo.ts) and backprop
// (backprop.ts) so far; actor-critic and A_RP plug in the same way.
import type { BrainSpec, Genome } from '../sim/spec';
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
  /**
   * Sandbox Train (2026-11-04): train this many generations. Evolution stops after that many; a gradient trainer
   * spreads that many fitness checks over the budget. The budget is that many of evolution's worst-case generations.
   */
  generations?: number;
}

export type TrainerFactory = (o: TrainerOptions) => Trainer;

export interface TrainerInfo {
  /** The name the player sees. */
  label: string;
  /** Why this trainer cannot train a brain of this shape (a sentence the workbench can show), or null. */
  refusal(spec: BrainSpec): string | null;
}

const registry = new Map<string, { f: TrainerFactory; info: TrainerInfo }>();

export function registerTrainer(id: string, f: TrainerFactory, info: TrainerInfo): void {
  if (registry.has(id)) throw new Error(`trainer: ${id} registered twice`);
  registry.set(id, { f, info });
}

function entry(id: string) {
  const e = registry.get(id);
  if (!e) throw new Error(`trainer: unknown ${id}`);
  return e;
}

export function createTrainer(id: string, o: TrainerOptions): Trainer { return entry(id).f(o); }

export const trainerInfo = (id: string): TrainerInfo => entry(id).info;

/** Why trainer id refuses this brain, or null; init() throws the same sentence. */
export const trainerRefusal = (id: string, spec: BrainSpec): string | null => entry(id).info.refusal(spec);

export const trainerIds = (): string[] => [...registry.keys()];
