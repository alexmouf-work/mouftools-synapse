// THE energy cost function. The sim, the trainer and the workbench all call these; there is no second copy.
// used per tick = Σ wired sensor cost + Σ neuron upkeep + Σ wires fire × |sender output × w| × (1 + skip × (span − 1)),
// where span counts only hidden lines that hold neurons (wireSpan).
// Over budget, every signal is mixed with noise: a = clamp(used_prev / budget − 1, 0, 1) (ruling 2026-10-30).
import { CONFIG, type Act } from '../config';
import { depthOf, INPUTS, inputIdx, type BrainSpec, type InputKind } from './spec';

export const sensorCost = (k: InputKind): number => CONFIG.cost[k];
export const upkeepCost = (a: Act): number => CONFIG.upkeep[a];

/** Per-wire factor: fire cost per unit |signal| for a wire spanning `span` layers. */
export function wireFactor(span: number): number {
  if (!(span >= 1)) throw new Error(`energy: span ${span}`);
  return CONFIG.cost.fire * (1 + CONFIG.cost.skip * (span - 1));
}

/** Which inputs carry at least one wire. */
export function wiredInputs(spec: BrainSpec): Uint8Array {
  const used = new Uint8Array(INPUTS.length);
  for (const c of spec.conns) { const i = inputIdx(c.from); if (i !== undefined) used[i] = 1; }
  return used;
}

/** Cost that does not depend on signals: wired sensors and neuron upkeep. */
export function staticCost(spec: BrainSpec): { sensors: number; upkeep: number; total: number } {
  const used = wiredInputs(spec);
  let sensors = 0;
  for (let i = 0; i < INPUTS.length; i++) if (used[i]) sensors += sensorCost(INPUTS[i].kind);
  let upkeep = 0;
  for (const n of spec.nodes) upkeep += upkeepCost(n.act);
  return { sensors, upkeep, total: sensors + upkeep };
}

/**
 * Layers a wire spans for the surcharge: only hidden lines that hold neurons count, so crossing an empty line is free
 * (review call 2026-10-30). Car = 0, each non-empty line up to and including a neuron's own adds 1, wheels = all
 * non-empty lines + 1.
 */
export function wireSpan(spec: BrainSpec, from: string, to: string): number {
  const filled = new Set(spec.nodes.map((n) => n.layer));
  const eff = (id: string): number => {
    const d = depthOf(spec, id); // throws on an unknown id
    let k = 0;
    for (const L of filled) if (L <= d) k++;
    return d > spec.layers ? filled.size + 1 : d === 0 ? 0 : k;
  };
  return eff(to) - eff(from);
}

/** Per-wire factors aligned to spec.conns. */
export function wireFactors(spec: BrainSpec): Float64Array {
  const f = new Float64Array(spec.conns.length);
  spec.conns.forEach((c, k) => { f[k] = wireFactor(wireSpan(spec, c.from, c.to)); });
  return f;
}

/**
 * The workbench's estimate of a brain's use per tick, before it has run: exact static cost plus every wire at the
 * assumed activity CONFIG.cost.estimateActivity. Shown as "est." wherever wires are costed.
 */
export function estimate(spec: BrainSpec): { sensors: number; upkeep: number; wires: number; total: number } {
  const s = staticCost(spec);
  let wires = 0;
  for (const f of wireFactors(spec)) wires += f * CONFIG.cost.estimateActivity;
  return { sensors: s.sensors, upkeep: s.upkeep, wires, total: s.total + wires };
}

/** Signal-dependent cost of one tick: Σ factor × |sender output × weight|. Arrays are in compiled wire order. */
export function fireCost(factor: Float64Array, from: Int32Array, w: Float64Array, vals: Float64Array): number {
  let s = 0;
  for (let c = 0; c < w.length; c++) {
    const x = vals[from[c]] * w[c];
    s += factor[c] * (x < 0 ? -x : x);
  }
  return s;
}

/** Noise level from last tick's use. */
export function noiseLevel(usedPrev: number, budget: number): number {
  const a = usedPrev / budget - 1;
  return a < 0 ? 0 : a > 1 ? 1 : a;
}

/** The "Energy left" input: 1 − last tick's use / budget, clamped to 0..1. */
export function energyLeft(usedPrev: number, budget: number): number {
  const e = 1 - usedPrev / budget;
  return e < 0 ? 0 : e > 1 ? 1 : e;
}

/** Energy as the player sees it: % of the budget. */
export const percentOfBudget = (used: number, budget: number): number => (used / budget) * 100;
