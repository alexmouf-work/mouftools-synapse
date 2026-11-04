// Brain v2 (docs/plans/2026-11-04-brain-designer-v2.md): senses on the left, hidden layers of identical neurons (one
// function per layer), the four wheels on the right. Every column is fully connected to the next, always (ruling
// 2026-11-04: no wiring by hand), so a brain is just its sense counts and its layers; the genome adds one weight per
// wire in the canonical order below. Adding a cell of a sense re-tunes the whole set (senses.ts).
import { ACTS, CONFIG, type Act } from '../config';

export type SenseId = 'boundary' | 'landmark' | 'hd' | 'grid' | 'speed';
/** The senses in their fixed order: the order of the compiled net's first nodes. */
export const SENSE_IDS: readonly SenseId[] = ['boundary', 'landmark', 'hd', 'grid', 'speed'];

export interface LayerSpec { n: number; fn: Act }
export interface BrainSpec { v: 2; senses: Record<SenseId, number>; layers: LayerSpec[] }
/** Weights in canonical wire order (wireList). */
export interface Genome { spec: BrainSpec; w: number[] }

/** Wheel outputs (tanh, −1..+1 each). */
export const OUTPUTS = [
  { id: 'o:fl', label: 'Front-left' },
  { id: 'o:fr', label: 'Front-right' },
  { id: 'o:rl', label: 'Rear-left' },
  { id: 'o:rr', label: 'Rear-right' },
] as const;

/** The starting brain (2026-11-04): one boundary vector cell, one head-direction cell, three tanh neurons, the wheels. */
export function defaultSpec(): BrainSpec {
  return { v: 2, senses: { boundary: 1, landmark: 0, hd: 1, grid: 0, speed: 0 }, layers: [{ n: 3, fn: 'tanh' }] };
}

export const inputIds = (s: BrainSpec): string[] => SENSE_IDS.flatMap((id) => Array.from({ length: s.senses[id] }, (_, k) => `i:${id}:${k}`));
export const layerIds = (s: BrainSpec, L: number): string[] => Array.from({ length: s.layers[L].n }, (_, k) => `h${L}:${k}`);
/** Every column, left to right: the input cells, each hidden layer, the wheels. */
export const columns = (s: BrainSpec): string[][] => [inputIds(s), ...s.layers.map((_, L) => layerIds(s, L)), OUTPUTS.map((o) => o.id)];

/** Every wire, in the canonical order the genome's weights follow: column by column, source by source, then target. */
export function wireList(s: BrainSpec): [string, string][] {
  const C = columns(s), out: [string, string][] = [];
  for (let i = 0; i + 1 < C.length; i++) for (const a of C[i]) for (const b of C[i + 1]) out.push([a, b]);
  return out;
}

export function wireCount(s: BrainSpec): number {
  const C = columns(s);
  let n = 0;
  for (let i = 0; i + 1 < C.length; i++) n += C[i].length * C[i + 1].length;
  return n;
}

/** Throws with the first problem found. */
export function validateSpec(s: BrainSpec): void {
  const fail = (m: string): never => { throw new Error(`spec: ${m}`); };
  if (s.v !== 2) fail(`version ${String((s as { v?: unknown }).v)}`);
  for (const id of SENSE_IDS) {
    const n = s.senses?.[id];
    if (!Number.isInteger(n) || n < 0 || n > CONFIG.senses[id].max) fail(`${id} cells ${String(n)}`);
  }
  if (Object.keys(s.senses).length !== SENSE_IDS.length) fail('unknown sense');
  if (!Array.isArray(s.layers) || s.layers.length < 1 || s.layers.length > CONFIG.brain.maxLayers) fail(`layers ${s.layers?.length}`);
  s.layers.forEach((l, L) => {
    if (!Number.isInteger(l.n) || l.n < 1 || l.n > CONFIG.brain.maxPerLayer) fail(`layer ${L + 1} has ${l.n} neurons`);
    if (!ACTS.includes(l.fn)) fail(`layer ${L + 1} function ${l.fn}`);
  });
}

export function validateGenome(g: Genome): void {
  validateSpec(g.spec);
  const n = wireCount(g.spec);
  if (g.w.length !== n) throw new Error(`genome: ${g.w.length} weights for ${n} wires`);
  for (const w of g.w) {
    if (!Number.isFinite(w) || Math.abs(w) > CONFIG.brain.weightCap) throw new Error(`genome: weight ${w}`);
  }
}
