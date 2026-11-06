// THE energy rule (brain v2, docs/plans/2026-11-04-brain-designer-v2.md §3a, §3aa). One supply, shared each tick
// between thinking and speed: every cell spends its cost × its firing rate (0..1), and every wire its cost × its
// source's rate. What is left is that tick's top speed, never below the floor (10%), so every car can move.
// Costs are % of the supply (halved 2026-11-04: "increase the max energy allowed for a brain by 2x").
// The sandbox refuses nothing; Multiplayer ("match") refuses a design past 100% with everything flat out, and each
// vs CPU round past its own budget (CONFIG.rounds.budgets, rounds plan 2026-11-05 §2).
// Retired with this: the per-minute pool, the noise rule and the energy-left input.
import { CONFIG } from '../config';
import { columns, type BrainSpec, type SenseId } from './spec';

const E = CONFIG.energy;
export type Mode = 'sandbox' | 'match';
/** What a design is held to: the sandbox (no limit), a match at 100%, or a vs CPU round's budget (% flat out). */
export type Rule = Mode | number;
/** The most a design may use flat out under a rule (%); Infinity in the sandbox. */
export const ruleLimit = (r: Rule): number => (r === 'sandbox' ? Infinity : r === 'match' ? 100 : r);

/** Each node's cost at full rate, in compiled node order (inputs, hidden by layer, wheels). */
export function nodeCosts(s: BrainSpec): number[] {
  const out: number[] = [];
  for (const id of columns(s)[0]) out.push(E.sense[id.split(':')[1] as SenseId]);
  s.layers.forEach((l) => { for (let k = 0; k < l.n; k++) out.push(E.neuron[l.fn]); });
  for (let k = 0; k < 4; k++) out.push(E.wheel);
  return out;
}

/** Each node's whole cost per unit of its rate: its own cost plus the wires it drives (each wire costs per source spike). */
export function nodeCoefs(s: BrainSpec): number[] {
  const C = columns(s), costs = nodeCosts(s), out: number[] = [];
  let i = 0;
  C.forEach((col, c) => { const fan = c + 1 < C.length ? C[c + 1].length : 0; for (let k = 0; k < col.length; k++) out.push(costs[i++] + fan * E.wire); });
  return out;
}

/** % of the supply the brain uses with every cell firing flat out: the design's maximum. */
export const maxLoad = (s: BrainSpec): number => nodeCoefs(s).reduce((a, b) => a + b, 0);

/** % used at rest: senses silent, each hidden layer at its function's resting rate, wheels at half rate (stopped). */
export function restLoad(s: BrainSpec, restRate: (fn: BrainSpec['layers'][number]['fn']) => number): number {
  const C = columns(s), co = nodeCoefs(s);
  let i = C[0].length, e = 0;
  s.layers.forEach((l) => { const r = restRate(l.fn); for (let k = 0; k < l.n; k++) e += co[i++] * r; });
  for (let k = 0; k < 4; k++) e += co[i++] * 0.5;
  return e;
}

/**
 * Power (round power plan 2026-11-06): what the brain and the wheels share, on the costs' scale. The sandbox has the
 * whole supply, which is also its reference (P = P_ref = 100: speed cap 100% − load, as before). A match round has
 * CONFIG.rounds.budgets[n − 1] (20, 40, 64) and its reference is the last round's power, so round 1's car is slow even
 * with a tiny brain and round 3's small brain nears full speed.
 */
export const SANDBOX_POWER = 100;
const ROUND_REF = CONFIG.rounds.budgets[CONFIG.rounds.budgets.length - 1];
/** Round n's power (1-based). */
export const roundPower = (n: number): number => CONFIG.rounds.budgets[n - 1];
/** The power that would give full speed with a weightless brain: the sandbox's own 100, a round's P_ref. */
export const powerRef = (power: number): number => (power >= SANDBOX_POWER ? SANDBOX_POWER : ROUND_REF);

/**
 * The speed share for a tick's load (%) under a power: what is left of it over the reference, never below the floor
 * (10% of full speed). As a fraction 0..1; the sandbox's is 100% − load.
 */
export function speedCap(load: number, power = SANDBOX_POWER): number {
  const ref = powerRef(power), left = power - load, floor = (E.speedFloor * ref) / 100;
  return (left < floor ? floor : left) / ref;
}

/** Why a design can't be raced under this rule, or null. The sandbox refuses nothing; a vs CPU round names its budget. */
export function energyRefusal(s: BrainSpec, rule: Rule): string | null {
  if (rule === 'sandbox') return null;
  const m = maxLoad(s), lim = ruleLimit(rule);
  if (m <= lim + 1e-9) return null;
  return rule === 'match' ? `Flat out it would use ${Math.round(m)}% of the energy; races allow 100%.` : `Flat out it would use ${Math.round(m)}% of the energy; this round allows ${Math.round(lim)}%.`;
}

/** "At maximum firing rate, uses x% energy" for one cell: its cost plus the wires it drives. */
export function cellMax(s: BrainSpec, column: number): number {
  const C = columns(s), fan = column + 1 < C.length ? C[column + 1].length : 0;
  const own = column === 0 ? 0 : column === C.length - 1 ? E.wheel : E.neuron[s.layers[column - 1].fn];
  return own + fan * E.wire;
}
export const senseMax = (s: BrainSpec, id: SenseId): number => E.sense[id] + columns(s)[1].length * E.wire;
/** The same for a whole hidden layer. */
export const layerMax = (s: BrainSpec, L: number): number => s.layers[L].n * cellMax(s, L + 1);
