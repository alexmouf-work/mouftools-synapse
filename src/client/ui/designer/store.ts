// The designer's saved brain: versioned JSON in localStorage. Storage can be missing or throw (private windows,
// blocked site data), so every access is guarded and the designer always has a brain: a missing save starts from the
// default brain quietly; a broken one starts from it and says so; a save from before brain v2 (versions 1 and 2) is
// reset to the default brain with a one-time note (Synapse changed how brains work).
import { defaultGenome, genomeToJSON } from '../../../common/sim/brain';
import { validateGenome, type Genome } from '../../../common/sim/spec';

export const SAVE_KEY = 'synapse.brain';
export const SAVE_VERSION = 3;
export const DEFAULT_NAME = 'Untitled brain';

export type TrainerId = 'evolution' | 'backprop' | 'ac' | 'arp';
const TRAINERS: readonly TrainerId[] = ['evolution', 'backprop', 'ac', 'arp'];

/** Training history: the brain's seed (chosen on its first Train) and how many phases it has trained. */
export interface TrainInfo { seed: number | null; phases: number }
export interface Saved { name: string; genome: Genome; train: TrainInfo; trainer: TrainerId }
export const NO_TRAINING: TrainInfo = { seed: null, phases: 0 };
export type LoadStatus = 'ok' | 'missing' | 'corrupt' | 'reset' | 'unavailable';

export const startSaved = (): Saved => ({ name: DEFAULT_NAME, genome: defaultGenome(), train: NO_TRAINING, trainer: 'evolution' });

export function serialize(s: Saved): string {
  return JSON.stringify({ v: SAVE_VERSION, name: s.name, trainer: s.trainer, train: s.train, genome: JSON.parse(genomeToJSON(s.genome)) as Genome });
}

/** Parse a stored value; anything unreadable is 'corrupt' (never thrown), with the reason for the console. */
export function parse(text: string | null): { status: 'ok' | 'missing' | 'corrupt' | 'reset'; saved: Saved; why?: string } {
  if (text === null) return { status: 'missing', saved: startSaved() };
  try {
    const o = JSON.parse(text) as { v?: unknown; name?: unknown; trainer?: unknown; genome?: Genome; train?: TrainInfo };
    if (o?.v === 1 || o?.v === 2) {
      const name = typeof o.name === 'string' && o.name.trim() ? o.name : DEFAULT_NAME;
      return { status: 'reset', saved: { ...startSaved(), name }, why: `a version ${o.v} save (before brain v2)` };
    }
    if (o?.v !== SAVE_VERSION) throw new Error(`save version ${String(o?.v)}`);
    const train = o.train;
    if (!train || !Number.isInteger(train.phases) || train.phases < 0
      || !(train.seed === null || (Number.isInteger(train.seed) && train.seed >= 0 && train.seed <= 0xffffffff))) throw new Error('save train');
    if (typeof o.name !== 'string' || !o.name.trim()) throw new Error('save name');
    if (!TRAINERS.includes(o.trainer as TrainerId)) throw new Error('save trainer');
    if (!o.genome) throw new Error('save genome');
    validateGenome(o.genome);
    return { status: 'ok', saved: { name: o.name, genome: o.genome, train: { seed: train.seed, phases: train.phases }, trainer: o.trainer as TrainerId } };
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
