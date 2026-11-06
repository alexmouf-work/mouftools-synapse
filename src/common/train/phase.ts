// One training phase end to end: seeds → tracks → metered env → trainer until the budget is spent. The Node bench,
// the browser /bench page, the determinism check and the contract tests all run phases through here.
import { CONFIG } from '../config';
import { Hasher } from '../hash';
import { derive, TAG } from '../rng';
import { genomeHash, zeroGenome } from '../sim/brain';
import type { BrainSpec, Genome } from '../sim/spec';
import { seedOfFamily, type Family } from '../sim/track';
import type { EpisodeSetup, Executor } from './episodes';
import { MeteredEnv, type Env } from './env';
import { createTrainer, type TrainerEvent, type TrainerOptions } from './trainer';
import './neuroevo';
import './backprop';
import './actorCritic';
import './arp';

export interface PhaseSeeds {
  trainTracks: number[];
  unseenTrack: number;
  /** Seed handed to the trainer. Phase 0 keeps the S1 benchmark's stream; a retrain draws a fresh one. */
  trainer: number;
}

/** Everything a phase draws from one seed. `phase` counts training phases within one seed (0 = first). */
export function phaseSeeds(seed: number, phase = 0): PhaseSeeds {
  const k = Array.from({ length: CONFIG.train.trainTracks }, (_, i) => i);
  return {
    trainTracks: k.map((i) => derive(seed, TAG.trainTrack, phase, i)),
    unseenTrack: derive(seed, TAG.unseenTrack, phase),
    trainer: phase === 0 ? seed : derive(seed, TAG.trainer, phase),
  };
}

/**
 * Training tracks for a track chosen in the sandbox (tracks-v2 T2): the chosen track first, then other tracks of its
 * family drawn from the phase's seeds, so a brain doesn't learn one lap by heart.
 */
export function chosenTrainTracks(track: number, family: Family, seed: number, phase = 0): number[] {
  return Array.from({ length: CONFIG.train.trainTracks }, (_, i) => (i === 0 ? track >>> 0 : seedOfFamily(family, derive(seed, TAG.trainTrack, phase, i), track)));
}

/** The budget for a sandbox Train of `generations` generations: that many of evolution's worst case (else T). */
export const phaseBudget = (generations?: number): number =>
  generations ? generations * CONFIG.train.population * CONFIG.train.trainTracks * CONFIG.train.episodeTicks : CONFIG.train.T;

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
  /** Experience budget (car-ticks). Default: `generations` × evolution's worst-case generation, else CONFIG.train.T. */
  T?: number;
  /** Sandbox Train (2026-11-04): train this many generations (see TrainerOptions.generations). */
  generations?: number;
  /** Temperature (see TrainerOptions.temperature); a run input like the seed, so it changes the hash. */
  temperature?: number;
  phase?: number;
  /** The training tracks' seeds, if not the phase's own (the sandbox's chosen track: chosenTrainTracks). */
  tracks?: number[];
  /** The tracks are race tracks of this many cars (a match's round: its race track; EpisodeSetup.raceCars). */
  raceCars?: number;
  /** A clock for timing only (sim code never reads time); defaults to no timing. */
  now?: () => number;
  /** Car-ticks per trainer.step call (default: all of T at once). The training view steps one generation at a time. */
  stepTicks?: (env: Env) => number;
  /** Called before each step (the view uses it to ask the pool for paths). */
  beforeStep?: (env: Env) => void;
  /** Every trainer event, as it happens. */
  onEvent?: (e: TrainerEvent, env: Env) => void;
  /**
   * Checked between steps; true ends the phase early, exactly as reaching the generation limit there would (B6,
   * principal 2026-11-04: "stopping the training should be functionally equivalent to hitting the limit on the number
   * of generations"): the best agent evaluated so far is the result. An executor that is aborted while stop() is true
   * (the view's Stop) ends the step in flight: the generation being evaluated is dropped.
   */
  stop?: () => boolean;
}

/**
 * The best agent evaluated so far: the champion of the generation with the best fitness (the earliest on a tie), or
 * the starting genome if no generation finished. For evolution this is the last generation's champion (elites keep
 * their score), which is what reaching the generation limit there returns.
 */
export function bestSoFar(gens: GenStat[], start: Genome): Genome {
  if (!gens.length) return { spec: start.spec, w: [...start.w] };
  let b = 0;
  for (let i = 1; i < gens.length; i++) if (gens[i].best > gens[b].best) b = i;
  return { spec: start.spec, w: Array.from(gens[b].champion) };
}

export async function runPhase(exec: Executor, spec: BrainSpec, seed: number, o: PhaseOptions = {}): Promise<PhaseResult> {
  const seeds = phaseSeeds(seed, o.phase ?? 0);
  const setup: EpisodeSetup = { spec, trackSeeds: o.tracks ?? seeds.trainTracks, episodeTicks: CONFIG.train.episodeTicks, ...(o.raceCars ? { raceCars: o.raceCars } : {}) };
  // the view's Stop aborts the pool; whenever that lands (even while the workers are still setting up), the run
  // ends as stopped rather than failing
  const aborted = (e: unknown): boolean => !!o.stop?.() && e instanceof Error && e.name === 'AbortError';
  let stopped = false;
  try { await exec.setup(setup); } catch (e) { if (!aborted(e)) throw e; stopped = true; }
  const env = new MeteredEnv(setup, exec, o.T ?? phaseBudget(o.generations));
  const trainer = createTrainer(o.trainer ?? 'evolution', { start: o.start ?? 'fresh', generations: o.generations, temperature: o.temperature });
  const genome = o.genome ?? zeroGenome(spec);
  const now = o.now ?? (() => 0);
  const t0 = now();
  trainer.init(genome, seeds.trainer, env);
  const gens: GenStat[] = [];
  while (!stopped && !trainer.done()) {
    if (o.stop?.()) { stopped = true; break; }
    o.beforeStep?.(env);
    let events: TrainerEvent[];
    try {
      events = await trainer.step(o.stepTicks ? o.stepTicks(env) : Infinity);
    } catch (e) {
      if (aborted(e)) { stopped = true; break; }
      throw e;
    }
    for (const e of events) {
      if (e.type === 'generation') gens.push({ gen: e.gen, best: e.best, mean: e.mean, ticksUsed: e.ticksUsed, champion: e.championW });
      o.onEvent?.(e, env);
    }
  }
  const trainMs = now() - t0;
  const final = stopped ? bestSoFar(gens, genome) : trainer.weights();
  const h = new Hasher().u32(seed).u32(env.used);
  for (const g of gens) h.u32(g.gen).f64(g.best).f64(g.mean).u32(g.ticksUsed).f64s(g.champion);
  h.str(genomeHash(final));
  return { seed, spec, gens, ticksUsed: env.used, final, hash: h.hex(), trainMs, stopped };
}
