// Brain v2 (docs/plans/2026-11-04-brain-designer-v2.md): senses on the left, hidden layers of identical neurons (one
// function per layer), the four wheels on the right. Every column is fully connected to the next, always (ruling
// 2026-11-04: no wiring by hand), so a brain is just its sense counts and its layers; the genome adds one weight per
// wire in the canonical order below. Adding a cell of a sense re-tunes the whole set (senses.ts).
import { ACTS, CONFIG, type Act } from '../config';
import { derive, Rng, TAG } from '../rng';

export type SenseId = 'boundary' | 'landmark' | 'hd' | 'grid' | 'speed';
/** The senses in their fixed order: the order of the compiled net's first nodes. */
export const SENSE_IDS: readonly SenseId[] = ['boundary', 'landmark', 'hd', 'grid', 'speed'];

export interface LayerSpec { n: number; fn: Act }
export interface BrainSpec { v: 2; senses: Record<SenseId, number>; layers: LayerSpec[] }
/**
 * The brain's parameters: one weight per wire in canonical order (wireList), then one bias per hidden neuron and per
 * wheel, in node order (2026-11-04: "the neurons can have a bias internally as well"), then each input cell's field
 * parameters in input order (B2e, "allow the input cells to vary their receptive fields … as they learn"; see
 * FIELD_PARAMS and senses.ts). Every parameter is a number within the weight cap; a field parameter of 0 is the
 * cell's default tuning.
 */
export interface Genome { spec: BrainSpec; w: number[] }

/** Wheel outputs (tanh, −1..+1 each). */
export const OUTPUTS = [
  { id: 'o:fl', label: 'Front-left' },
  { id: 'o:fr', label: 'Front-right' },
  { id: 'o:rl', label: 'Rear-left' },
  { id: 'o:rr', label: 'Rear-right' },
] as const;

/**
 * The fixed brain (2026-11-04): one boundary vector cell, one head-direction cell, three tanh neurons, the wheels. Since
 * 2026-11-05 new brains start from starterSpec; this one stays as the fixture for the goldens, S1 and the checks.
 */
export function defaultSpec(): BrainSpec {
  return { v: 2, senses: { boundary: 1, landmark: 0, hd: 1, grid: 0, speed: 0 }, layers: [{ n: 3, fn: 'tanh' }] };
}

/**
 * A new brain (plan §3c, 2026-11-05: "a random assortment of input neurons, including copies of the same, with at
 * least 1 boundary vector cell always … between 2 and 6 inputs"): 2–6 cells, the count uniform; one boundary vector
 * cell, each of the rest uniform over the five senses, repeats allowed (a sense already at its most, which only the one
 * speed cell can be, is drawn again); copies spread their fields evenly (field parameters 0); 3 tanh neurons, the
 * wheels. Deterministic given its seed; the client seeds it from crypto and the sim never calls it.
 */
export function starterSpec(seed: number): BrainSpec {
  const r = new Rng(derive(seed >>> 0, TAG.starter));
  const n = 2 + r.int(5);
  const senses: Record<SenseId, number> = { boundary: 1, landmark: 0, hd: 0, grid: 0, speed: 0 };
  for (let k = 1; k < n; k++) {
    let id: SenseId;
    do id = SENSE_IDS[r.int(SENSE_IDS.length)]; while (senses[id] >= CONFIG.senses[id].max);
    senses[id]++;
  }
  return { v: 2, senses, layers: [{ n: 3, fn: 'tanh' }] };
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

/** Neurons with a bias: every hidden neuron and every wheel. */
export const biasCount = (s: BrainSpec): number => s.layers.reduce((a, l) => a + l.n, 0) + OUTPUTS.length;
/**
 * Learnable field parameters per cell (B2e, plan §3ad): boundary and landmark cells their direction, width and range;
 * head direction its preferred angle; grid cells their scale, offset (x, y) and orientation; speed its gain.
 */
export const FIELD_PARAMS: Record<SenseId, number> = { boundary: 3, landmark: 3, hd: 1, grid: 4, speed: 1 };
export const fieldCount = (s: BrainSpec): number => SENSE_IDS.reduce((a, id) => a + s.senses[id] * FIELD_PARAMS[id], 0);
/** Length of a genome's parameter vector: the wires' weights, the biases, then the input cells' fields. */
export const paramCount = (s: BrainSpec): number => wireCount(s) + biasCount(s) + fieldCount(s);
/** Where input cell `id`'s (i:sense:k) field parameters start in the parameter vector. */
export function fieldIndex(s: BrainSpec, id: string): number {
  let at = wireCount(s) + biasCount(s);
  for (const x of inputIds(s)) {
    if (x === id) return at;
    at += FIELD_PARAMS[x.split(':')[1] as SenseId];
  }
  throw new Error(`spec: ${id} is not an input cell`);
}
/** Where node `id`'s bias sits in the parameter vector (hidden neurons layer by layer, then the wheels). */
export function biasIndex(s: BrainSpec, id: string): number {
  const C = columns(s), off = wireCount(s);
  let k = 0;
  for (let c = 1; c < C.length; c++) for (const x of C[c]) { if (x === id) return off + k; k++; }
  throw new Error(`spec: ${id} has no bias`);
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
  const n = paramCount(g.spec);
  if (g.w.length !== n) throw new Error(`genome: ${g.w.length} parameters for ${wireCount(g.spec)} wires, ${biasCount(g.spec)} biases and ${fieldCount(g.spec)} field parameters`);
  for (const w of g.w) {
    if (!Number.isFinite(w) || Math.abs(w) > CONFIG.brain.weightCap) throw new Error(`genome: weight ${w}`);
  }
}
