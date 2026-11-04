// The five senses (docs/plans/2026-11-04-brain-designer-v2.md §2), named after the rat cells they imitate. Each sense's
// cells share one rule; adding a cell re-tunes the set (directions, preferred angles, scales and phases spread evenly).
// These functions are THE definition: the sim reads cells through them and the designer's graphs plot them.
import { CONFIG } from '../config';
import { cos, exp, PI, sin, wrapAngle } from '../fmath';
import type { SenseId } from './spec';

const S = CONFIG.senses;

/** A field's direction for cell k of n, degrees clockwise from the nose: ahead for one, spread −90…+90 for more. */
export const spreadDeg = (k: number, n: number): number => (n <= 1 ? 0 : -90 + (180 * k) / (n - 1));
/** A field's angular width (degrees): narrower the more cells share the front. */
export const fieldWidthDeg = (sense: 'boundary' | 'landmark', n: number): number =>
  n > 1 ? S.fieldSpreadDeg / n : sense === 'boundary' ? S.boundary.widthDeg : S.landmark.widthDeg;

/** Activation of a field cell for a target `dist` metres away at `offDeg` degrees from the cell's direction. */
export function fieldAct(offDeg: number, dist: number, range: number, widthDeg: number): number {
  const u = offDeg / widthDeg, near = 1 - dist / range;
  return near <= 0 ? 0 : exp(-(u * u)) * near;
}

/** Head-direction cell k of n: preferred heading (radians, counter-clockwise like the sim); two cells are cos and sin. */
export const hdPreferred = (k: number, n: number): number => (2 * PI * k / n) * (n === 2 ? 0.5 : 1);
export const hdAct = (heading: number, pref: number): number => cos(wrapAngle(heading - pref));

/** Grid cell k: the first two take two scales, more take spread phases. */
export const gridScale = (k: number): number => (k % 2 ? S.grid.largeM : S.grid.smallM);
export const gridPhase = (k: number): number => Math.floor(k / 2) * S.grid.phaseStep;
const GRID_C = [0, 1, 2].map((a) => cos((a * PI) / 3)), GRID_S = [0, 1, 2].map((a) => sin((a * PI) / 3));
/** Activation of grid cell (scale, phase) at world position (x, y): three plane waves 60° apart, 0..1. */
export function gridAct(x: number, y: number, scale: number, phase: number): number {
  let g = 0;
  for (let a = 0; a < 3; a++) g += cos(((x * GRID_C[a] + y * GRID_S[a]) / scale) * 2 * PI + phase);
  const v = (g + 1.5) / 4.5;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Speed cell: 0 at rest, 1 at top wheel speed. */
export const speedAct = (v: number): number => { const x = v / CONFIG.car.wheelSpeed; return x < 0 ? 0 : x > 1 ? 1 : x; };

/** A sense value as a firing rate 0..1 (head direction's cosine maps −1..1 to 0..1). */
export const senseRate = (id: SenseId, v: number): number => (id === 'hd' ? (v + 1) / 2 : v);

/** Text for the designer. */
export const SENSE_INFO: Record<SenseId, { name: string; desc: string }> = {
  boundary: { name: 'Boundary vector cells', desc: 'Fires faster when approaching a wall.' },
  landmark: { name: 'Landmark cells', desc: 'Fires faster when the finish line is in view.' },
  hd: { name: 'Head direction cells', desc: 'Fires faster when facing a given angle.' },
  grid: { name: 'Grid cells', desc: 'Fires on a hexagonal grid.' },
  speed: { name: 'Speed cells', desc: 'Fires faster at higher speeds.' },
};
