// The designer's saved brain: versioned JSON in localStorage. Storage can be missing or throw (private windows,
// blocked site data), so every access is guarded and the designer always has a brain. A new brain is the random
// starter (brain v2 plan §3c: 2–6 input cells, one always a boundary vector cell), seeded from crypto: a missing save
// starts from one quietly; a broken one starts from it and says so; a save from before brain v2 (versions 1 and 2) is
// reset to the default brain with a one-time note (Synapse changed how brains work). A brain v2 save from before the
// built-in biases (a weight per wire only) loads with every bias at 0. A save from before the temperature slider (B2d)
// has no `temps`: its phases ran at 0 (×1). A save from before the learned fields (B2e) gets every field at its
// default (0).
import { genomeToJSON, zeroGenome } from '../../../common/sim/brain';
import { biasCount, fieldCount, migrateGenome, starterSpec, validateGenome, validateSpec, wireCount, type Genome } from '../../../common/sim/spec';
import { validTemperature } from '../../../common/train/trainer';

export const SAVE_KEY = 'synapse.brain';
export const SAVE_VERSION = 3;
export const DEFAULT_NAME = 'Untitled brain';

export type TrainerId = 'evolution' | 'backprop' | 'ac' | 'arp';
const TRAINERS: readonly TrainerId[] = ['evolution', 'backprop', 'ac', 'arp'];

/**
 * Training history: the brain's seed (chosen on its first Train), how many phases it has trained and each phase's
 * temperature (log2 of the multiplier; 0 = ×1). Seed, phase and temperature are the run's inputs: same inputs, same brain.
 */
export interface TrainInfo { seed: number | null; phases: number; temps: number[] }
export interface Saved { name: string; genome: Genome; train: TrainInfo; trainer: TrainerId }
export const NO_TRAINING: TrainInfo = { seed: null, phases: 0, temps: [] };
export type LoadStatus = 'ok' | 'missing' | 'corrupt' | 'reset' | 'unavailable';

/** A fresh random seed for a new brain (browser crypto; never used inside the sim). */
const freshSeed = (): number => crypto.getRandomValues(new Uint32Array(1))[0];
/** A new brain's genome: the random starter, untrained (every weight, bias and field parameter 0). */
export const starterGenome = (seed: number = freshSeed()): Genome => zeroGenome(starterSpec(seed));
/** A new brain: the first visit, Reset, a save from before brain v2, or one that can't be read. */
export const startSaved = (genome: Genome = starterGenome()): Saved => ({ name: DEFAULT_NAME, genome, train: NO_TRAINING, trainer: 'evolution' });

export function serialize(s: Saved): string {
  return JSON.stringify({ v: SAVE_VERSION, name: s.name, trainer: s.trainer, train: s.train, genome: JSON.parse(genomeToJSON(s.genome)) as Genome });
}

/** Parse a stored value; anything unreadable is 'corrupt' (never thrown), with the reason for the console. */
export function parse(text: string | null): { status: 'ok' | 'missing' | 'corrupt' | 'reset'; saved: Saved; why?: string } {
  if (text === null) return { status: 'missing', saved: startSaved() };
  try {
    const o = JSON.parse(text) as { v?: unknown; name?: unknown; trainer?: unknown; genome?: Genome; train?: Partial<TrainInfo> & { seed: number | null; phases: number } };
    if (o?.v === 1 || o?.v === 2) {
      const name = typeof o.name === 'string' && o.name.trim() ? o.name : DEFAULT_NAME;
      return { status: 'reset', saved: { ...startSaved(), name }, why: `a version ${o.v} save (before brain v2)` };
    }
    if (o?.v !== SAVE_VERSION) throw new Error(`save version ${String(o?.v)}`);
    const train = o.train;
    if (!train || !Number.isInteger(train.phases) || train.phases < 0
      || !(train.seed === null || (Number.isInteger(train.seed) && train.seed >= 0 && train.seed <= 0xffffffff))) throw new Error('save train');
    if (typeof o.name !== 'string' || !o.name.trim()) throw new Error('save name');
    const temps = train.temps ?? new Array<number>(train.phases).fill(0);
    if (!Array.isArray(temps) || temps.length !== train.phases || !temps.every(validTemperature)) throw new Error('save temps');
    if (!TRAINERS.includes(o.trainer as TrainerId)) throw new Error('save trainer');
    if (!o.genome) throw new Error('save genome');
    // a save from before the long-range cell: its landmark cells load as long-range boundary cells (senses plan §3)
    o.genome = migrateGenome(o.genome);
    validateSpec(o.genome.spec);
    // older brain v2 saves: weights only (before B2b) or weights and biases (before B2e); the rest start at 0 (no bias,
    // the even spread of fields), so they drive exactly as they did
    if (Array.isArray(o.genome.w)) {
      const sp = o.genome.spec, nw = wireCount(sp), nb = biasCount(sp), nf = fieldCount(sp);
      if (o.genome.w.length === nw) o.genome = { ...o.genome, w: [...o.genome.w, ...new Array(nb + nf).fill(0)] };
      else if (o.genome.w.length === nw + nb) o.genome = { ...o.genome, w: [...o.genome.w, ...new Array(nf).fill(0)] };
    }
    validateGenome(o.genome);
    return { status: 'ok', saved: { name: o.name, genome: o.genome, train: { seed: train.seed, phases: train.phases, temps: [...temps] }, trainer: o.trainer as TrainerId } };
  } catch (e) {
    return { status: 'corrupt', saved: startSaved(), why: e instanceof Error ? e.message : String(e) };
  }
}

export function load(): { status: LoadStatus; saved: Saved; why?: string } {
  let text: string | null;
  try {
    text = localStorage.getItem(SAVE_KEY);
  } catch (e) {
    return { status: 'unavailable', saved: startSaved(), why: String(e) };
  }
  return parse(text);
}

/** False if the browser would not store it. */
export function save(s: Saved): boolean {
  try {
    localStorage.setItem(SAVE_KEY, serialize(s));
    return true;
  } catch {
    return false;
  }
}
