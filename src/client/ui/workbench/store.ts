// The workbench's saved brain: versioned JSON in localStorage. Storage can be missing or throw (private windows,
// blocked site data), so every access is guarded and the workbench always has a brain: a broken save falls back to
// Starter and says so; a missing one starts from Starter quietly.
import { draftOf, genomeToJSON, starterSpec, zeroGenome, type Draft } from '../../../common/sim/brain';
import type { Genome } from '../../../common/sim/spec';

export const SAVE_KEY = 'synapse.brain';
/** v2 adds `train`; v1 saves load with no training history. */
export const SAVE_VERSION = 2;
export const DEFAULT_NAME = 'Untitled brain';

/** Training history: the brain's seed (chosen on its first Train) and how many phases it has trained. */
export interface TrainInfo { seed: number | null; phases: number }
export interface Saved { name: string; draft: Draft; train: TrainInfo }
export const NO_TRAINING: TrainInfo = { seed: null, phases: 0 };
export type LoadStatus = 'ok' | 'missing' | 'corrupt' | 'unavailable';

/**
 * Step is no longer offered (principal 2026-11-04: "don't offer step as a function. offer linear as well as ReLU."):
 * a save with step neurons loads with them turned Linear (weights kept), and says which.
 */
function migrateStep(g: Genome): { genome: Genome; migrated: string[] } {
  const migrated = g.spec.nodes.filter((n) => n.act === 'step').map((n) => n.id);
  if (!migrated.length) return { genome: g, migrated };
  return { genome: { ...g, spec: { ...g.spec, nodes: g.spec.nodes.map((n) => (n.act === 'step' ? { ...n, act: 'linear' } : n)) } }, migrated };
}

export const starterSaved = (): Saved => ({ name: DEFAULT_NAME, draft: draftOf(zeroGenome(starterSpec())), train: NO_TRAINING });

export function serialize(s: Saved): string {
  return JSON.stringify({
    v: SAVE_VERSION,
    name: s.name,
    nextId: s.draft.nextId,
    train: s.train,
    genome: JSON.parse(genomeToJSON(s.draft.genome)) as Genome,
  });
}

/** Parse a stored value; anything unreadable is 'corrupt' (never thrown), with the reason for the console. */
export function parse(text: string | null): { status: 'ok' | 'missing' | 'corrupt'; saved: Saved; why?: string; migrated?: string[] } {
  if (text === null) return { status: 'missing', saved: starterSaved() };
  try {
    const o = JSON.parse(text) as { v?: unknown; name?: unknown; nextId?: unknown; genome?: Genome; train?: TrainInfo };
    if (o?.v !== 1 && o?.v !== SAVE_VERSION) throw new Error(`save version ${String(o?.v)}`);
    const train = o.v === 1 ? NO_TRAINING : o.train;
    if (!train || !Number.isInteger(train.phases) || train.phases < 0
      || !(train.seed === null || (Number.isInteger(train.seed) && train.seed >= 0 && train.seed <= 0xffffffff))) throw new Error('save train');
    if (typeof o.name !== 'string' || !o.name.trim()) throw new Error('save name');
    if (typeof o.nextId !== 'number' || !Number.isInteger(o.nextId)) throw new Error('save nextId');
    if (!o.genome) throw new Error('save genome');
    const m = migrateStep(o.genome);
    return {
      status: 'ok', saved: { name: o.name, draft: draftOf(m.genome, o.nextId), train: { seed: train.seed, phases: train.phases } },
      ...(m.migrated.length ? { migrated: m.migrated } : {}),
    };
  } catch (e) {
    return { status: 'corrupt', saved: starterSaved(), why: e instanceof Error ? e.message : String(e) };
  }
}

export function load(): { status: LoadStatus; saved: Saved; why?: string; migrated?: string[] } {
  let text: string | null;
  try {
    text = localStorage.getItem(SAVE_KEY);
  } catch (e) {
    return { status: 'unavailable', saved: starterSaved(), why: String(e) };
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
