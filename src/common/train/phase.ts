// One training phase end to end: seeds → tracks → metered env → trainer until the budget is spent. The Node bench,
// the browser /bench page, the determinism check and the contract tests all run phases through here.
import { CONFIG } from '../config';
import { Hasher } from '../hash';
import { derive, TAG } from '../rng';
import { genomeHash } from '../sim/brain';
import type { BrainSpec, Genome } from '../sim/spec';
import type { Executor } from './episodes';
import { MeteredEnv, type Env } from './env';
import { createTrainer, type TrainerEvent, type TrainerOptions } from './trainer';
import './neuroevo';

export interface PhaseSeeds {
  trainTracks: number[];
  trainNoise: number[];
  unseenTrack: number;
  raceNoise: number;
  /** Seed handed to the trainer. Phase 0 keeps the S1 benchmark's stream; a retrain draws a fresh one. */
  trainer: number;
}

/** Everything a phase draws from one seed. `phase` counts training phases within one seed (0 = first). */
export function phaseSeeds(seed: number, phase = 0): PhaseSeeds {
  const k = Array.from({ length: CONFIG.train.trainTracks }, (_, i) => i);
  return {
    trainTracks: k.map((i) => derive(seed, TAG.trainTrack, phase, i)),
    trainNoise: k.map((i) => derive(seed, TAG.trainNoise, phase, i)),
    unseenTrack: derive(seed, TAG.unseenTrack, phase),
    raceNoise: derive(seed, TAG.raceNoise, phase),
    trainer: phase === 0 ? seed : derive(seed, TAG.trainer, phase),
  };
}

export interface GenStat { gen: number; best: number; mean: number; ticksUsed: number; champion: Float64Array }

export interface PhaseResult {
  seed: number;
  spec: BrainSpec;
  gens: GenStat[];
  ticksUsed: number;
  final: Genome;
  /** Hash over every generation's stats and champion plus the final genome. */
  hash: string;
  trainMs: number;
  stopped: boolean;
}

export interface PhaseOptions {
  trainer?: string;
  start?: TrainerOptions['start'];
  /** Starting genome (weights used only when start = carry). */
  genome?: Genome;
  T?: number;
  budget?: number;
  phase?: number;
  /** A clock for timing only (sim code never reads time); defaults to no timing. */
  now?: () => number;
  /** Car-ticks per trainer.step call (default: all of T at once). The training view steps one generation at a time. */
  stepTicks?: (env: Env) => number;
  /** Called before each step (the view uses it to ask the pool for paths). */
  beforeStep?: (env: Env) => void;
  /** Every trainer event, as it happens. */
  onEvent?: (e: TrainerEvent, env: Env) => void;
  /** Checked between steps; true ends the phase early (the result is then partial and marked stopped). */
  stop?: () => boolean;
}

export async function runPhase(exec: Executor, spec: BrainSpec, seed: number, o: PhaseOptions = {}): Promise<PhaseResult> {
  const seeds = phaseSeeds(seed, o.phase ?? 0);
  const setup = {
    spec, trackSeeds: seeds.trainTracks, noiseSeeds: seeds.trainNoise,
    budget: o.budget ?? CONFIG.budget[0], episodeTicks: CONFIG.train.episodeTicks,
  };
  await exec.setup(setup);
  const env = new MeteredEnv(setup, exec, o.T ?? CONFIG.train.T);
  const trainer = createTrainer(o.trainer ?? 'evolution', { start: o.start ?? 'fresh' });
  const genome = o.genome ?? { spec, w: spec.conns.map(() => 0) };
  const now = o.now ?? (() => 0);
  const t0 = now();
  trainer.init(genome, seeds.trainer, env);
  const gens: GenStat[] = [];
  let stopped = false;
  while (!trainer.done()) {
    if (o.stop?.()) { stopped = true; break; }
    o.beforeStep?.(env);
    for (const e of await trainer.step(o.stepTicks ? o.stepTicks(env) : Infinity)) {
      if (e.type === 'generation') gens.push({ gen: e.gen, best: e.best, mean: e.mean, ticksUsed: e.ticksUsed, champion: e.championW });
      o.onEvent?.(e, env);
    }
  }
  const trainMs = now() - t0;
  const final = trainer.weights();
  const h = new Hasher().u32(seed).u32(env.used);
  for (const g of gens) h.u32(g.gen).f64(g.best).f64(g.mean).u32(g.ticksUsed).f64s(g.champion);
  h.str(genomeHash(final));
  return { seed, spec, gens, ticksUsed: env.used, final, hash: h.hex(), trainMs, stopped };
}
