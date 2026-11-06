// The five senses (docs/plans/2026-11-04-brain-designer-v2.md §2), named after the rat cells they imitate. Each sense's
// cells share one rule; adding a cell re-tunes the set (directions, preferred angles, scales and phases spread evenly).
// That even spread is each cell's default; since B2e each cell's field is learned from there (fieldOf and friends).
// These functions are THE definition: the sim reads cells through them and the designer's graphs plot them.
import { CONFIG } from '../config';
import { cos, exp, PI, sin, wrapAngle } from '../fmath';
import type { SenseId } from './spec';

const S = CONFIG.senses;

/** A field's direction for cell k of n, degrees clockwise from the nose: ahead for one, spread −90…+90 for more. */
export const spreadDeg = (k: number, n: number): number => (n <= 1 ? 0 : -90 + (180 * k) / (n - 1));
/**
 * Boundary vector cells' untrained directions by count (match-flow v2 plan §4, principal 2026-11-05: "pick useful
 * directions to cover"): mirror-symmetric about the nose, weighted to the front, reaching the sides as the count
 * grows. Degrees clockwise from the nose, cell 0 the leftmost.
 */
export const BOUNDARY_DIRS: readonly (readonly number[])[] = [
  [], [0], [-30, 30], [-45, 0, 45], [-60, -20, 20, 60], [-75, -30, 0, 30, 75], [-80, -45, -15, 15, 45, 80],
  [-90, -55, -25, 0, 25, 55, 90], [-90, -60, -35, -12, 12, 35, 60, 90],
];
/** The two kinds of boundary vector cell: the short one, and the long-range one (senses plan §3). */
export type FieldSense = 'boundary' | 'far';
export const isFieldSense = (id: SenseId): id is FieldSense => id === 'boundary' || id === 'far';
/** An untrained field's direction for cell k of n: both kinds of boundary cell from the table, by their own count. */
export const fieldDirDeg = (_sense: FieldSense, k: number, n: number): number =>
  n < BOUNDARY_DIRS.length ? BOUNDARY_DIRS[n][k] : spreadDeg(k, n);
/**
 * A field's untrained angular width (degrees), for both kinds of boundary cell: 0.6 × the gap to the nearest
 * neighbour, so neighbouring fields cross at half activation (exp(−(0.5/0.6)²) ≈ 0.5), within 20–60°; one cell alone
 * keeps 60°.
 */
export function fieldWidthDeg(sense: FieldSense, n: number, k = 0): number {
  if (n >= BOUNDARY_DIRS.length) return n > 1 ? S.fieldSpreadDeg / n : S[sense].widthDeg;
  if (n <= 1) return S[sense].widthDeg;
  const d = BOUNDARY_DIRS[n], gap = Math.min(k > 0 ? d[k] - d[k - 1] : Infinity, k < n - 1 ? d[k + 1] - d[k] : Infinity);
  const w = 0.6 * gap;
  return w < 20 ? 20 : w > S.boundary.widthDeg ? S.boundary.widthDeg : w;
}

/** Activation of a field cell for a target `dist` metres away at `offDeg` degrees from the cell's direction. */
export function fieldAct(offDeg: number, dist: number, range: number, widthDeg: number): number {
  const u = offDeg / widthDeg, near = 1 - dist / range;
  return near <= 0 ? 0 : exp(-(u * u)) * near;
}
/**
 * The long-range cell (senses plan, "Long-range cell inverted" 2026-11-06): the short cell's response inverted, so it
 * fires d / R along its field's centre (capped at 1: 1 with no wall in range, near 0 with a wall close by).
 */
export const farAct = (offDeg: number, dist: number, range: number, widthDeg: number): number => 1 - fieldAct(offDeg, dist, range, widthDeg);

/** Head-direction cell k of n: preferred heading (radians, counter-clockwise like the sim); two cells are cos and sin. */
export const hdPreferred = (k: number, n: number): number => (2 * PI * k / n) * (n === 2 ? 0.5 : 1);
export const hdAct = (heading: number, pref: number): number => cos(wrapAngle(heading - pref));

/** Grid cell k: the first two take two scales, more take spread phases. */
export const gridScale = (k: number): number => (k % 2 ? S.grid.largeM : S.grid.smallM);
export const gridPhase = (k: number): number => Math.floor(k / 2) * S.grid.phaseStep;
const GRID_C = [0, 1, 2].map((a) => cos((a * PI) / 3)), GRID_S = [0, 1, 2].map((a) => sin((a * PI) / 3));
/**
 * Activation of grid cell (scale, phase) at world position (x, y): three plane waves 60° apart, 0..1. A learned
 * field also shifts the lattice by (ox, oy) metres and turns it by `rot` radians.
 */
export function gridAct(x: number, y: number, scale: number, phase: number, ox = 0, oy = 0, rot = 0): number {
  let X = x - ox, Y = y - oy;
  if (rot !== 0) { const cr = cos(rot), sr = sin(rot), x0 = X; X = cr * x0 + sr * Y; Y = -sr * x0 + cr * Y; }
  let g = 0;
  for (let a = 0; a < 3; a++) g += cos(((X * GRID_C[a] + Y * GRID_S[a]) / scale) * 2 * PI + phase);
  const v = (g + 1.5) / 4.5;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Speed cell: the signed forward speed (ruling 2026-11-05): 0 at rest, 1 at top wheel speed forwards, −1 backwards
 * (sooner with a gain above 1); the same response mirrored for negative speeds. */
export const speedAct = (v: number, gain = 1): number => { const x = (v * gain) / CONFIG.car.wheelSpeed; return x < -1 ? -1 : x > 1 ? 1 : x; };

// ---- learnable receptive fields (B2e, plan §3ad) ----
// Each cell's tuning is its default (the even spread above) moved by its field parameters in the genome, each
// a number in −cap..cap like a weight (0 = the default, so an untrained cell is exactly as before):
//   boundary, far:      direction = default + 45°·p0 (any direction), width = default · 2^(p1/2) in 20–180°,
//                       range = default · 2^(p2/2) in 5–20 m (boundary) or 30–80 m (far, default 60 m)
//   head direction:     preferred = default + p0 · 45°
//   grid:               scale = default · 2^(p0/2) in 10–60 m, offset (15 m · p1, 15 m · p2), orientation p3 · 15°
//   speed:              gain = 2^(p0/4), 0.5–2×
// Energy costs don't change with the field.
export const FIELD_DIR_DEG = 45, FIELD_LOG2 = 0.5, GRID_SHIFT_M = 15, GRID_ROT = PI / 12, HD_STEP = PI / 4, SPEED_LOG2 = 0.25;
export const FIELD_BOUNDS = {
  width: [20, 180], boundaryRange: [5, 20], farRange: [30, 80], gridScale: [10, 60], speedGain: [0.5, 2],
} as const;
const LN2 = 0.6931471805599453;
/** 2^x with fmath's exp (no engine maths in the sim). */
export const pow2 = (x: number): number => exp(x * LN2);

/**
 * v = def · 2^(p·k) clamped to [lo, hi], and dv/dp (0 beyond a bound; at a bound itself the slope from inside, so a
 * default sitting on its bound, like the boundary cells' 20 m, can still be learned inward).
 */
export function scaled(def: number, p: number, k: number, lo: number, hi: number): { v: number; dv: number } {
  const v = def * pow2(p * k);
  if (v < lo) return { v: lo, dv: 0 };
  if (v > hi) return { v: hi, dv: 0 };
  return { v, dv: v * LN2 * k };
}

/** A boundary cell's field (either kind): direction (degrees clockwise from the nose, −180..180), width (°), range (m). */
export interface Field { dirDeg: number; widthDeg: number; rangeM: number; dWidth: number; dRange: number }
export function fieldOf(sense: FieldSense, k: number, n: number, p0 = 0, p1 = 0, p2 = 0): Field {
  let dir = fieldDirDeg(sense, k, n) + FIELD_DIR_DEG * p0;
  dir -= 360 * Math.round(dir / 360);
  const [wl, wh] = FIELD_BOUNDS.width, [rl, rh] = sense === 'boundary' ? FIELD_BOUNDS.boundaryRange : FIELD_BOUNDS.farRange;
  const w = scaled(fieldWidthDeg(sense, n, k), p1, FIELD_LOG2, wl, wh);
  const r = scaled(S[sense].rangeM, p2, FIELD_LOG2, rl, rh);
  return { dirDeg: dir, widthDeg: w.v, rangeM: r.v, dWidth: w.dv, dRange: r.dv };
}
/** A head-direction cell's preferred heading (radians). */
export const hdOf = (k: number, n: number, p0 = 0): number => hdPreferred(k, n) + HD_STEP * p0;
/** A grid cell's scale (m), phase, offset (m), orientation (radians), and d scale / d p0. */
export interface Grid { scale: number; phase: number; ox: number; oy: number; rot: number; dScale: number }
export function gridOf(k: number, p0 = 0, p1 = 0, p2 = 0, p3 = 0): Grid {
  const [lo, hi] = FIELD_BOUNDS.gridScale, s = scaled(gridScale(k), p0, FIELD_LOG2, lo, hi);
  return { scale: s.v, phase: gridPhase(k), ox: GRID_SHIFT_M * p1, oy: GRID_SHIFT_M * p2, rot: GRID_ROT * p3, dScale: s.dv };
}
/** A speed cell's gain. */
export const speedGainOf = (p0 = 0): number => pow2(SPEED_LOG2 * p0);

/** A sense value as a firing rate 0..1 (head direction's cosine maps −1..1 to 0..1; the signed speed cell, its size). */
export const senseRate = (id: SenseId, v: number): number => (id === 'hd' ? (v + 1) / 2 : id === 'speed' && v < 0 ? -v : v);

/** Text for the designer. */
export const SENSE_INFO: Record<SenseId, { name: string; desc: string }> = {
  boundary: { name: 'Boundary vector cells', desc: 'Fires faster when approaching a wall.' },
  far: { name: 'Long-range boundary vector cells', desc: 'Fires faster the further away the wall is (up to 60 m).' },
  hd: { name: 'Head direction cells', desc: 'Fires faster when facing a given angle.' },
  grid: { name: 'Grid cells', desc: 'Fires on a hexagonal grid.' },
  speed: { name: 'Speed cells', desc: '+1 at top speed forwards, −1 at top speed backwards.' },
};
