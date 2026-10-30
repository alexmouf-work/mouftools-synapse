// The workbench's saved brain: versioned JSON in localStorage. Storage can be missing or throw (private windows,
// blocked site data), so every access is guarded and the workbench always has a brain: a broken save falls back to
// Starter and says so; a missing one starts from Starter quietly.
import { draftOf, genomeToJSON, starterSpec, zeroGenome, type Draft } from '../../../common/sim/brain';
import type { Genome } from '../../../common/sim/spec';

export const SAVE_KEY = 'synapse.brain';
export const SAVE_VERSION = 1;
export const DEFAULT_NAME = 'Untitled brain';

export interface Saved { name: string; draft: Draft }
export type LoadStatus = 'ok' | 'missing' | 'corrupt' | 'unavailable';

export const starterSaved = (): Saved => ({ name: DEFAULT_NAME, draft: draftOf(zeroGenome(starterSpec())) });

export function serialize(s: Saved): string {
  return JSON.stringify({
    v: SAVE_VERSION,
    name: s.name,
    nextId: s.draft.nextId,
    genome: JSON.parse(genomeToJSON(s.draft.genome)) as Genome,
  });
}

/** Parse a stored value; anything unreadable is 'corrupt' (never thrown), with the reason for the console. */
export function parse(text: string | null): { status: 'ok' | 'missing' | 'corrupt'; saved: Saved; why?: string } {
  if (text === null) return { status: 'missing', saved: starterSaved() };
  try {
    const o = JSON.parse(text) as { v?: unknown; name?: unknown; nextId?: unknown; genome?: Genome };
    if (o?.v !== SAVE_VERSION) throw new Error(`save version ${String(o?.v)}`);
    if (typeof o.name !== 'string' || !o.name.trim()) throw new Error('save name');
    if (typeof o.nextId !== 'number' || !Number.isInteger(o.nextId)) throw new Error('save nextId');
    if (!o.genome) throw new Error('save genome');
    return { status: 'ok', saved: { name: o.name, draft: draftOf(o.genome, o.nextId) } };
  } catch (e) {
    return { status: 'corrupt', saved: starterSaved(), why: e instanceof Error ? e.message : String(e) };
  }
}

export function load(): { status: LoadStatus; saved: Saved; why?: string } {
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
