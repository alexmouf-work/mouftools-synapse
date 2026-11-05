// Track generator (tracks plan §1–2; tracks v2, docs/plans/2026-11-05-tracks-v2-and-match-settings.md T1). The seed
// picks a family (loop, kidney, hairpin, chicane, dogleg, clover, figure eight). Each family but the eight is a skeleton
// of straights and corners that the seed draws (how many corners, their angles and radii, the straights' lengths); the
// seed then places the features on it (which kinds, where, how tight: hairpins, chicanes, esses, double apexes,
// decreasing-radius corners), scales the straights to a lap of 2.15–2.85 km and closes the lap by the least change to
// its straights. The lap is traced exactly (arcs and lines), resampled every ~2 m and validated: length 2–3 km,
// tightest corner, no near-overlaps, a ≥ 250 m straight for the start, and (all but the eight) a sweep of ≥ 90° at
// ≥ 60 m and two features found by the detector (detectShape), one a hairpin or a chicane; room for boost pads. A
// failed attempt moves to the next sub-seed (same family); maxAttempts failures throw. Elevation and scenery are
// render-only.
// The figure eight stays flat: its one crossing is declared (60–120°, both passes nearly straight through it and its
// ramps), each sample carries a deck (0 ground, 1 the bridge: the second pass from the start, its flat and ramps) and a
// layer (0 open, 1 the lower pass near the crossing, 2 the bridge), and a boundary ray skips the walls of the other
// layer. A car finds its sample only a few either side of its last one, so it never jumps roads at the crossing.
import { CONFIG } from '../config';
import { atan2, cos, sin, TAU } from '../fmath';
import { derive, Rng, TAG } from '../rng';

const C = CONFIG.track;

export interface WallGrid {
  x0: number;
  y0: number;
  cell: number;
  cols: number;
  rows: number;
  /** CSR: items of cell c are items[start[c] .. start[c+1]). */
  start: Int32Array;
  items: Int32Array;
  /** Per segment: ax, ay, ex, ey (start point and edge vector). */
  seg: Float64Array;
  /** Per segment: its sample's layer (Track.layer). */
  layer: Uint8Array;
}

export interface Pad { i0: number; n: number }

export interface Track {
  seed: number;
  /** Sub-seed that produced a valid track. */
  sub: number;
  n: number;
  /** Spacing between samples (len / n, ≈ CONFIG.track.spacing). */
  ds: number;
  len: number;
  px: Float64Array;
  py: Float64Array;
  /** Unit tangent. */
  tx: Float64Array;
  ty: Float64Array;
  /** Tangent heading (rad). */
  th: Float64Array;
  /** Signed curvature (1/m, + = left), smoothed over CONFIG.track.curvWindow. */
  curv: Float64Array;
  wallOff: number;
  startIdx: number;
  pads: Pad[];
  /** Pad index at each sample, −1 if none. */
  padAt: Int8Array;
  /** Cosmetic gate positions (sample indices). */
  gates: number[];
  grid: WallGrid;
  family: Family;
  /** Per sample: 1 on the figure eight's bridge (its flat and ramps), else 0. */
  deck: Uint8Array;
  /** Per sample: 0 open, 1 the lower pass near the crossing, 2 the bridge. Rays skip the other layer's walls. */
  layer: Uint8Array;
  /** The figure eight's crossing: the sample of each pass nearest to it (null on the other families). */
  crossing: { lower: number; upper: number } | null;
  /** What the feature detector finds on the lap (in lap order). */
  features: Feature[];
}

export type Family = 'loop' | 'kidney' | 'hairpin' | 'chicane' | 'dogleg' | 'clover' | 'eight';
export const FAMILIES: readonly Family[] = ['loop', 'kidney', 'hairpin', 'chicane', 'dogleg', 'clover', 'eight'];
/** The family a seed's track belongs to (every sub-seed keeps it). */
export const familyOf = (seed: number): Family => FAMILIES[new Rng(derive(seed >>> 0, TAG.family)).int(FAMILIES.length)];

/**
 * A track seed of a given family (tracks-v2 T2: the picker's Shuffle, "One family" rounds, training's second track):
 * the first of base's derived seeds whose own family is that family, skipping `avoid`. generateTrack(seed) is then that
 * family's track, so a chosen track is a plain seed everywhere a seed is taken. About 7 draws on average.
 */
export function seedOfFamily(family: Family, base: number, avoid = -1): number {
  for (let k = 0; k < 4096; k++) {
    const s = derive(base >>> 0, TAG.familySeed, k);
    if (familyOf(s) === family && s !== avoid) return s;
  }
  throw new Error(`track: no ${family} seed from ${base}`);
}

/** Metres from the line back to the last row of a race grid of `cars` cars (rows of two, CONFIG.match; match.ts). */
export const gridDepth = (cars: number): number => CONFIG.match.firstRow + Math.floor((Math.max(cars, 1) - 1) / 2) * CONFIG.match.rowGap;

/**
 * The track of a seed. `raceCars` (vs CPU and Multiplayer, tracks plan §4; 0 = not a race): no boost pad on the grid
 * of that many cars, from CONFIG.match.clearPast behind its back row, to clearAhead after the line, so a race track
 * can differ from the same seed's training or drive track, and with the number of cars; races only ask for race tracks.
 */
export function generateTrack(seed: number, raceCars = 0): Track {
  return trackOfFamily(seed, familyOf(seed), raceCars);
}

/** The track a seed would give in a given family (tests and previews; generateTrack uses the seed's own family). */
export function trackOfFamily(seed: number, family: Family, raceCars = 0): Track {
  for (let sub = 0; sub < C.maxAttempts; sub++) {
    const t = attempt(seed >>> 0, sub, family, raceCars);
    if (t) return t;
  }
  throw new Error(`track: no valid ${family} track for seed ${seed} after ${C.maxAttempts} attempts`);
}

/** Why an attempt failed, for the generator tests. */
export type Reject = 'shape' | 'length' | 'radius' | 'proximity' | 'straight' | 'features' | 'pads' | 'crossing';
export const rejectCounts: Record<Reject, number> = { shape: 0, length: 0, radius: 0, proximity: 0, straight: 0, features: 0, pads: 0, crossing: 0 };

// ---- courses: a lap drawn as straights and arcs (tracks v2) ----

/**
 * A piece of a lap: a straight of `len` m (closing the lap may lengthen or shorten it by its share `w`, never below
 * `min`; w 0 = fixed) or an arc of radius r m turning by a rad (+ left).
 */
export type Piece = { arc: false; len: number; min: number; w: number } | { arc: true; r: number; a: number };
const DEG = TAU / 360;
const line = (len: number, min: number): Piece => ({ arc: false, len, min, w: 1 });
const fixed = (len: number): Piece => ({ arc: false, len, min: 0, w: 0 });
const arc = (r: number, deg: number): Piece => ({ arc: true, r, a: deg * DEG });

/** Where a course ends from (0, 0) heading 0, and the heading of each straight. */
function trace(ps: readonly Piece[], heads?: number[]): { x: number; y: number; h: number } {
  let x = 0, y = 0, h = 0;
  for (const p of ps) {
    if (!p.arc) { heads?.push(h); x += p.len * cos(h); y += p.len * sin(h); continue; }
    const s = p.a > 0 ? 1 : -1, cx = x - s * p.r * sin(h), cy = y + s * p.r * cos(h);
    h += p.a;
    x = cx + s * p.r * sin(h); y = cy - s * p.r * cos(h);
  }
  return { x, y, h };
}

/**
 * Close a course: move its end onto its start by changing the straights that may change, each in proportion to its
 * share × length (the least change that closes it). False if the straights are too close to parallel or one would end
 * up under its minimum.
 */
function close(ps: Piece[]): boolean {
  const heads: number[] = [];
  const end = trace(ps, heads);
  let m00 = 0, m01 = 0, m11 = 0, k = 0;
  const lines: { p: Piece & { arc: false }; c: number; s: number; w: number }[] = [];
  for (const p of ps) if (!p.arc) {
    const h = heads[k++], w = p.w * p.len, c = cos(h), s = sin(h);
    if (w > 0) { lines.push({ p, c, s, w }); m00 += w * c * c; m01 += w * c * s; m11 += w * s * s; }
  }
  const det = m00 * m11 - m01 * m01;
  if (!(det > 1e-6 * (m00 + m11) * (m00 + m11))) return false;
  const lx = (-end.x * m11 + end.y * m01) / det, ly = (-end.y * m00 + end.x * m01) / det;
  for (const l of lines) { l.p.len += l.w * (l.c * lx + l.s * ly); if (!(l.p.len >= l.p.min)) return false; }
  return true;
}

/** Points along a course every ≤ 1 m (arcs) and ≤ 2 m (straights), from (x, y) heading h. */
function points(ps: readonly Piece[], x: number, y: number, h: number): Pts {
  const out: Pts = { x: [], y: [] };
  for (const p of ps) {
    if (!p.arc) {
      const m = Math.max(1, Math.ceil(p.len / 2)), dx = cos(h), dy = sin(h);
      for (let k = 0; k < m; k++) { out.x.push(x + dx * p.len * k / m); out.y.push(y + dy * p.len * k / m); }
      x += dx * p.len; y += dy * p.len;
      continue;
    }
    const s = p.a > 0 ? 1 : -1, cx = x - s * p.r * sin(h), cy = y + s * p.r * cos(h);
    const m = Math.max(2, Math.ceil(Math.abs(p.a) * p.r));
    for (let k = 0; k < m; k++) { const g = h + p.a * k / m; out.x.push(cx + s * p.r * sin(g)); out.y.push(cy - s * p.r * cos(g)); }
    h += p.a;
    x = cx + s * p.r * sin(h); y = cy - s * p.r * cos(h);
  }
  return out;
}

type Pts = { x: number[]; y: number[] };

/** Turn by a seeded angle and mirror half the time. */
function place(p: Pts, rng: Rng): Pts {
  const rot = rng.range(0, TAU), c = cos(rot), s = sin(rot), m = rng.next() < 0.5 ? -1 : 1;
  return { x: p.x.map((u, i) => c * u * m - s * p.y[i]), y: p.x.map((u, i) => s * u * m + c * p.y[i]) };
}

// A family's skeleton: straights ("sides") and corners in turn, side i then corner i, turning left 360° in all. The
// seed draws the angles, radii and lengths; the features are then placed on it (decorate); then it is scaled to a lap
// of lapMin–lapMax m and closed.
type Role = 'sweep' | 'hairpin' | 'plain' | 'bend';
interface Corner { deg: number; r: number; role: Role; body?: Piece[] }
interface Side { len: number; start?: boolean; mod?: Piece[]; feat?: boolean }
interface Skeleton { sides: Side[]; corners: Corner[] }

const shuffle = <T>(a: T[], rng: Rng): T[] => { for (let i = a.length - 1; i > 0; i--) { const j = rng.int(i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
const sweep = (rng: Rng, deg: number): Corner => ({ deg, r: rng.range(65, 140), role: 'sweep' });
const pin = (rng: Rng, deg: number): Corner => ({ deg, r: rng.range(28, 40), role: 'hairpin' });
const plain = (rng: Rng, deg: number): Corner => ({ deg, r: rng.range(35, 110), role: 'plain' });

/** Split `total` degrees over m corners, each within [lo, hi] (null if the draw cannot). */
function split(rng: Rng, total: number, m: number, lo: number, hi: number): number[] | null {
  if (m === 0) return total === 0 ? [] : null;
  const w = Array.from({ length: m }, () => rng.range(0.55, 1.45)), sw = w.reduce((a, b) => a + b, 0);
  const out = w.map((v) => total * v / sw);
  return out.every((v) => v >= lo && v <= hi) ? out : null;
}

/** K left corners round a lap (one a sweeper, one maybe a hairpin), plus `extra` degrees for right-hand bends. */
function ring(rng: Rng, K: number, hairpin: boolean, extra = 0): Skeleton | null {
  const sw = rng.range(95, 150), hp = hairpin ? rng.range(165, 195) : 0;
  const rest = split(rng, 360 + extra - sw - hp, K - 1 - (hairpin ? 1 : 0), 30, 140);
  if (!rest) return null;
  const corners = shuffle([sweep(rng, sw), ...(hairpin ? [pin(rng, hp)] : []), ...rest.map((d) => plain(rng, d))], rng);
  const sides: Side[] = corners.map((_, i) => ({ len: i === 0 ? rng.range(300, 450) : rng.range(90, 400), start: i === 0 }));
  return { sides, corners };
}

/** Put `mod` (a kidney's right-hand bend or a dogleg's pair) in the middle of a random non-start side. */
function bendInto(sk: Skeleton, rng: Rng, mod: Piece[]): void {
  const i = 1 + rng.int(sk.sides.length - 1);
  sk.sides[i].mod = mod; sk.sides[i].len = Math.max(sk.sides[i].len, 200);
}

function loopSkeleton(rng: Rng): Skeleton | null {
  return ring(rng, 4 + rng.int(3), rng.next() < 0.5);
}

/** A loop with one side pushed in: a right-hand bend between two left corners. */
function kidneySkeleton(rng: Rng): Skeleton | null {
  const b = rng.range(35, 75), sk = ring(rng, 4 + rng.int(2), rng.next() < 0.4, b);
  if (sk) bendInto(sk, rng, [line(rng.range(60, 160), 50), arc(rng.range(70, 150), -b), line(rng.range(60, 160), 50)]);
  return sk;
}

/** A loop with a step in one side: left, a straight, right (or the mirror). */
function doglegSkeleton(rng: Rng): Skeleton | null {
  const d = rng.range(45, 85), s = rng.next() < 0.5 ? 1 : -1, sk = ring(rng, 4 + rng.int(2), rng.next() < 0.4);
  if (sk) bendInto(sk, rng, [line(rng.range(50, 140), 50), arc(rng.range(40, 90), s * d), line(rng.range(60, 160), 60), arc(rng.range(40, 90), -s * d), line(rng.range(50, 140), 50)]);
  return sk;
}

/** Four corners, a long back straight that always carries a chicane (decorate puts it there). */
function chicaneSkeleton(rng: Rng): Skeleton | null {
  const sk = ring(rng, 4, rng.next() < 0.3);
  if (!sk) return null;
  sk.sides[2].len = rng.range(380, 520);
  sk.sides[2].mod = chicane(rng, rng.next() < 0.5 ? 1 : -1); sk.sides[2].feat = true;
  return sk;
}

/**
 * A tongue into the lap: out along the start straight, a left hairpin, back, a right hairpin, out again, round a wide
 * end, back along the top and down the far side.
 */
function hairpinSkeleton(rng: Rng): Skeleton | null {
  const j = () => rng.range(-15, 15);
  const s0 = rng.range(340, 480), s1 = s0 * rng.range(0.45, 0.72), s2 = s1 + rng.range(-40, 120);
  const h1 = pin(rng, 180 + j()), h2 = { ...pin(rng, 180 + j()), r: rng.range(30, 42) };
  h2.deg = -h2.deg;
  const corners: Corner[] = [h1, h2];
  const sides: Side[] = [{ len: s0, start: true }, { len: s1 }, { len: s2 }];
  let top: number;
  if (rng.next() < 0.5) { const c = { deg: 180 + j(), r: rng.range(62, 100), role: 'sweep' as const }; corners.push(c); top = 2 * c.r; }
  else {
    const c1 = sweep(rng, 90 + j()), side = rng.range(40, 160), c2 = plain(rng, 90 + j());
    c1.r = Math.min(c1.r, 110); corners.push(c1); sides.push({ len: side }); corners.push(c2); top = c1.r + side + c2.r;
  }
  const d = plain(rng, 90 + j()), e = plain(rng, 90);
  const yTop = 2 * h1.r + 2 * h2.r + top, xEnd = s0 - s1 + s2;
  sides.push({ len: Math.max(120, xEnd - d.r + e.r) }); corners.push(d);
  sides.push({ len: Math.max(60, yTop - d.r - e.r) }); corners.push(e);
  return { sides, corners };
}

/** Three leaves: out along a stem, round the leaf's end, back in, a right-hand bend at the waist. */
function cloverSkeleton(rng: Rng): Skeleton | null {
  const sides: Side[] = [], corners: Corner[] = [];
  const kinds = shuffle(['sweep', rng.next() < 0.6 ? 'hairpin' : 'plain', rng.next() < 0.3 ? 'hairpin' : 'plain'] as Role[], rng);
  for (let k = 0; k < 3; k++) {
    const w = rng.range(60, 80), tip = 120 + w;
    sides.push({ len: rng.range(k === 0 ? 290 : 230, 340), start: k === 0 });
    corners.push(kinds[k] === 'hairpin' ? pin(rng, tip) : kinds[k] === 'sweep' ? { deg: tip, r: rng.range(65, 90), role: 'sweep' } : { deg: tip, r: rng.range(45, 64), role: 'plain' });
    sides.push({ len: rng.range(230, 340) });
    corners.push({ deg: -w, r: rng.range(28, 40), role: 'bend' });
  }
  return { sides, corners };
}

// ---- features (plan T1): modules a seed places on a skeleton ----

/** An S of two or three opposite turns (≥ 36° each so the detector, on smoothed curvature, sees ≥ 30°) in ≤ 120 m. */
function chicane(rng: Rng, s: number): Piece[] {
  if (rng.next() < 0.5) { const r = rng.range(30, 45), a = rng.range(38, 55); return [arc(r, s * a), fixed(rng.range(4, 12)), arc(r, -s * a)]; }
  const r = rng.range(28, 34), a = rng.range(36, 42), g = rng.range(4, 8);
  return [arc(r, s * a), fixed(g), arc(r, -2 * s * a), fixed(g), arc(r, s * a)];
}

/** Three or four alternating bends, wider than a chicane (no two neighbours both ≥ 30° within 120 m). */
function esses(rng: Rng, s: number): Piece[] {
  const a = rng.range(20, 26), g = rng.range(6, 12);
  if (rng.next() < 0.5) { const r = rng.range(55, 85); return [arc(r, s * a), fixed(g), arc(r, -2 * s * a), fixed(g), arc(r, s * a)]; }
  const r = rng.range(95, 110);
  return [arc(r, s * a), fixed(g), arc(r, -2 * s * a), fixed(g), arc(r, 2 * s * a), fixed(g), arc(r, -s * a)];
}

type Kind = 'chicane' | 'esses' | 'double apex' | 'decreasing radius';

/**
 * Place the features: at least two in all, at least one a hairpin or a chicane, where and which drawn by the seed.
 * Hairpins come with the skeleton; chicanes and esses go into a side; a double apex or a decreasing radius replaces a
 * plain corner. False if the skeleton has no room for enough.
 */
function decorate(sk: Skeleton, rng: Rng): boolean {
  let count = sk.corners.filter((c) => c.role === 'hairpin').length + sk.sides.filter((s) => s.feat).length;
  const want = Math.max(2, count + (rng.next() < 0.55 ? 1 : 0));
  const place1 = (k: Kind): boolean => {
    if (k === 'chicane' || k === 'esses') {
      const free = sk.sides.filter((s) => !s.start && !s.mod && s.len >= (k === 'chicane' ? 160 : 240));
      if (!free.length) return false;
      const s = free[rng.int(free.length)];
      s.mod = (k === 'chicane' ? chicane : esses)(rng, rng.next() < 0.5 ? 1 : -1); s.feat = true;
      return true;
    }
    const lo = k === 'double apex' ? 80 : 90, free = sk.corners.filter((c) => c.role === 'plain' && !c.body && c.deg >= lo);
    if (!free.length) return false;
    const c = free[rng.int(free.length)], f = rng.range(0.42, 0.6);
    if (k === 'double apex') { const r = rng.range(38, 70); c.body = [arc(r, c.deg * f), fixed(rng.range(16, 28)), arc(r * rng.range(0.8, 1.2), c.deg * (1 - f))]; }
    else { const r = rng.range(75, 115); c.body = [arc(r, c.deg * f), arc(r * rng.range(0.4, 0.55), c.deg * (1 - f))]; }
    return true;
  };
  if (count === 0) { if (!place1('chicane')) return false; count++; }
  const order = shuffle(['chicane', 'esses', 'double apex', 'decreasing radius'] as Kind[], rng);
  for (const k of order) if (count < want && place1(k)) count++;
  return count >= 2;
}

const SKELETONS: Record<Exclude<Family, 'eight'>, (rng: Rng) => Skeleton | null> = {
  loop: loopSkeleton, kidney: kidneySkeleton, hairpin: hairpinSkeleton, chicane: chicaneSkeleton, dogleg: doglegSkeleton, clover: cloverSkeleton,
};

/** A family's lap as pieces, closed, or null (the attempt fails with 'shape'). */
function course(f: Exclude<Family, 'eight'>, rng: Rng): Piece[] | null {
  const sk = SKELETONS[f](rng);
  if (!sk) return null;
  // the last corner takes up the slack so the lap turns 360°: it must keep its role's shape
  const last = sk.corners[sk.corners.length - 1];
  let bends = 0; // turns inside the sides (a kidney's bend; a dogleg's pair sums to 0)
  for (const s of sk.sides) for (const p of s.mod ?? []) if (p.arc) bends += p.a / DEG;
  last.deg = 360 - bends - sk.corners.slice(0, -1).reduce((a, c) => a + c.deg, 0);
  if (last.role === 'bend' ? !(last.deg <= -40 && last.deg >= -95) : !(last.deg >= (last.role === 'sweep' ? 90 : last.role === 'hairpin' ? 160 : 30) && last.deg <= 200)) return null;
  if (!decorate(sk, rng)) return null;
  const ps: Piece[] = [];
  sk.sides.forEach((s, i) => {
    const min = s.start ? C.startMin : C.sideMin;
    if (s.mod) { const f = rng.range(0.35, 0.65); ps.push(line(s.len * f, C.sideMin), ...s.mod, line(s.len * (1 - f), C.sideMin)); }
    else ps.push(line(s.len, min));
    const c = sk.corners[i];
    ps.push(...(c.body ?? [arc(c.r, c.deg)]));
  });
  // scale the straights to a lap of U(lapMin, lapMax), then close it
  let fixedLen = 0, free = 0;
  for (const p of ps) if (p.arc) fixedLen += Math.abs(p.a) * p.r; else if (p.w > 0) free += p.len; else fixedLen += p.len;
  const k = (rng.range(C.lapMin, C.lapMax) - fixedLen) / free;
  if (!(k > 0.4)) return null;
  for (const p of ps) if (!p.arc && p.w > 0) p.len *= k;
  return close(ps) ? ps : null;
}

/**
 * The figure eight: two lobes and the crossing between them. The passes cross at the origin at θ; each lobe is a
 * corner, a straight down its far side (F, which sets how far out the lobe reaches) and the mirror corner.
 */
function eightCourse(rng: Rng): { ps: Piece[]; x: number; y: number; h: number } {
  const th = rng.range(70, 110) * DEG, h0 = th / 2, ch = cos(h0), sh = sin(h0), turn = 90 + h0 / DEG;
  const fR = rng.range(280, 380), rR = rng.range(45, 75), fL = rng.range(280, 380), rL = rng.range(45, 75);
  const legR = (fR / 2 + rR * ch) / sh, legL = (fL / 2 + rL * ch) / sh; // crossing to each lobe's first corner
  const ps: Piece[] = [fixed(legL + legR), arc(rR, -turn), fixed(fR), arc(rR, -turn), fixed(legR + legL), arc(rL, turn), fixed(fL), arc(rL, turn)];
  return { ps, x: -legL * ch, y: -legL * sh, h: h0 };
}

const circ = (a: number, b: number, n: number): number => { const d = a > b ? a - b : b - a; return d < n - d ? d : n - d; };

/** Tangents, headings and smoothed signed curvature of a closed, evenly spaced centreline. */
function geometry(px: Float64Array, py: Float64Array, n: number, ds: number) {
  const tx = new Float64Array(n), ty = new Float64Array(n), th = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i + 1) % n, b = (i - 1 + n) % n;
    const dx = px[a] - px[b], dy = py[a] - py[b];
    const d = Math.sqrt(dx * dx + dy * dy);
    tx[i] = dx / d; ty[i] = dy / d;
    th[i] = atan2(ty[i], tx[i]);
  }
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i + 1) % n, b = (i - 1 + n) % n;
    const cr = tx[b] * ty[a] - ty[b] * tx[a], dt = tx[b] * tx[a] + ty[b] * ty[a];
    raw[i] = atan2(cr, dt) / (2 * ds);
  }
  const half = Math.max(1, Math.round(C.curvWindow / ds / 2));
  const curv = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -half; k <= half; k++) s += raw[(i + k + n) % n];
    curv[i] = s / (2 * half + 1);
  }
  return { tx, ty, th, curv };
}

/** A closed centreline through these points, resampled every ~spacing m, with its geometry (tests and previews). */
export function centreline(x: readonly number[], y: readonly number[]) {
  const r = resample(Float64Array.from(x), Float64Array.from(y), C.spacing);
  return { ...r, ...geometry(r.px, r.py, r.n, r.ds) };
}

/** A course's centreline (the feature detector's tests). */
export const courseLine = (ps: readonly Piece[]) => { const p = points(ps, 0, 0, 0); return centreline(p.x, p.y); };

function attempt(seed: number, sub: number, family: Family, raceCars: number): Track | null {
  const rng = new Rng(derive(seed, TAG.track, sub));
  let raw: Pts;
  if (family === 'eight') { const e = eightCourse(rng); raw = points(e.ps, e.x, e.y, e.h); }
  else { const ps = course(family, rng); if (!ps) return reject('shape'); raw = points(ps, 0, 0, 0); }
  const pts = place(raw, rng);
  const { px, py, len, n, ds } = resample(Float64Array.from(pts.x), Float64Array.from(pts.y), C.spacing);
  if (len < C.lengthMin || len > C.lengthMax) return reject('length');
  const { tx, ty, th, curv } = geometry(px, py, n, ds);
  for (let i = 0; i < n; i++) if (Math.abs(curv[i]) > 1 / C.minRadius) return reject('radius');

  // the figure eight's crossing: exactly one, at 60–120°, both passes nearly straight across it and its ramps
  const zone = new Uint8Array(n); // 1 / 2: near the crossing on the pass through sample a / b
  let ca = -1, cb = -1;
  if (family === 'eight') {
    const x = crossings(px, py, n, ds);
    if (x.length !== 1) return reject('crossing');
    [ca, cb] = x[0];
    // the angle between the passes is in [min, max] when |cos| is below both bounds' |cos| (60–120°: |cos| ≤ ½)
    const dot = tx[ca] * tx[cb] + ty[ca] * ty[cb];
    if (Math.abs(dot) > Math.min(cos(C.crossAngleMin * DEG), -cos(C.crossAngleMax * DEG))) return reject('crossing');
    const reach = (C.crossFlat + C.crossRamp) / ds;
    for (let i = 0; i < n; i++) {
      const da = circ(i, ca, n), db = circ(i, cb, n);
      if (da <= reach && db <= reach) return reject('crossing');
      if (da <= reach) zone[i] = 1; else if (db <= reach) zone[i] = 2;
      if (zone[i] && Math.abs(curv[i]) > C.crossCurv) return reject('crossing');
    }
  }
  if (!farPartsApart(px, py, n, ds, zone)) return reject('proximity');

  // longest circular straight off the crossing; start in its middle
  let bestLen = 0, bestStart = -1;
  {
    const straight = (i: number) => Math.abs(curv[i]) < C.straightCurv && !zone[i];
    let first = -1;
    for (let i = 0; i < n; i++) if (!straight(i)) { first = i; break; }
    if (first < 0) return reject('straight'); // a circle-free "track" of pure straight cannot close
    let run = 0, runStart = 0;
    for (let k = 1; k <= n; k++) {
      const i = (first + k) % n;
      if (straight(i)) {
        if (run === 0) runStart = i;
        run++;
        if (run > bestLen) { bestLen = run; bestStart = runStart; }
      } else run = 0;
    }
  }
  if (bestLen * ds < C.straightLen) return reject('straight');
  const startIdx = (bestStart + Math.floor(bestLen / 2)) % n;

  // a long sweeping curve and two features, one a hairpin or a chicane (all but the figure eight)
  const shape = detectShape(curv, ds);
  if (family !== 'eight' && !shapeOk(shape)) return reject('features');

  // the bridge is the second pass over the crossing from the start
  const deck = new Uint8Array(n), layer = new Uint8Array(n);
  let crossing: Track['crossing'] = null;
  if (ca >= 0) {
    const upperIs = (ca - startIdx + n) % n > (cb - startIdx + n) % n ? 1 : 2;
    for (let i = 0; i < n; i++) if (zone[i]) { const up = zone[i] === upperIs; deck[i] = up ? 1 : 0; layer[i] = up ? 2 : 1; }
    crossing = upperIs === 1 ? { lower: cb, upper: ca } : { lower: ca, upper: cb };
  }

  // pads on the calmest windows off the crossing (and, for a race, off the whole grid and the first 50 m), far enough apart
  const w = Math.round(C.padLen / ds), race = raceCars > 0;
  const behind = Math.ceil((gridDepth(raceCars) + CONFIG.match.clearPast) / ds), ahead = Math.ceil(CONFIG.match.clearAhead / ds);
  const onGrid = (j: number): boolean => { const d = (j - startIdx + n) % n; return d <= ahead || n - d <= behind; };
  const calm: { i: number; c: number }[] = [];
  for (let i = 0; i < n; i++) {
    let c = 0, open = true;
    for (let k = 0; k < w; k++) { const j = (i + k) % n; c += Math.abs(curv[j]); open &&= !zone[j] && !(race && onGrid(j)); }
    if (open) calm.push({ i, c });
  }
  calm.sort((a, b) => (a.c - b.c) || (a.i - b.i));
  const want = C.padCountMin + rng.int(C.padCountMax - C.padCountMin + 1);
  const apart = C.padApart / ds;
  const pads: Pad[] = [];
  for (const { i } of calm) {
    if (pads.length >= want) break;
    let ok = true;
    for (const p of pads) {
      const d = Math.abs(i - p.i0);
      if (Math.min(d, n - d) < apart) { ok = false; break; }
    }
    if (ok) pads.push({ i0: i, n: w });
  }
  if (pads.length < want) return reject('pads');
  pads.sort((a, b) => a.i0 - b.i0);
  const padAt = new Int8Array(n).fill(-1);
  pads.forEach((p, k) => { for (let j = 0; j < p.n; j++) padAt[(p.i0 + j) % n] = k; });

  const gates: number[] = [];
  const gateStep = Math.max(1, Math.round(C.gateEvery / ds));
  for (let k = 0; k * gateStep < n - gateStep / 2; k++) { const g = (startIdx + k * gateStep) % n; if (!zone[g]) gates.push(g); }

  const grid = buildGrid(px, py, tx, ty, n, CONFIG.car.wall, layer);
  return { seed, sub, n, ds, len, px, py, tx, ty, th, curv, wallOff: CONFIG.car.wall, startIdx, pads, padAt, gates, grid, family, deck, layer, crossing, features: shape.features };
}

// ---- the feature detector (plan T1): reads a lap's smoothed curvature ----

export type FeatureKind = 'hairpin' | 'chicane' | 'esses' | 'double apex' | 'decreasing radius';
/** A feature and the sample in its middle. */
export interface Feature { kind: FeatureKind; at: number }
export interface Shape {
  /** Turns of 90° or more at a radius of 60 m or more. */
  sweeps: number;
  features: Feature[];
}

/** A turn: a run of samples curving one way (|curvature| over turnCurv). */
interface Turn { i0: number; m: number; ang: number; peak: number; ratio: number }
/** Turns one way with gaps of at most chainGap between them: one corner. */
interface Group { i0: number; m: number; sign: number; ang: number; turns: Turn[]; hairpin: boolean }

/**
 * The lap's sweeps and features. Corners are same-way turns less than chainGap apart; a corner with 150°+ of turn
 * inside 120 m is a hairpin; alternating corners less than chainGap apart form a chain, a chicane if two neighbours
 * turn 30°+ each within 120 m, else esses if three or more; a corner of two turns is a double apex; a lone turn whose
 * second half is 1.3× as curved as its first is a decreasing radius.
 */
export function detectShape(curv: Float64Array, ds: number): Shape {
  const n = curv.length, k0 = C.turnCurv, out: Shape = { sweeps: 0, features: [] };
  // begin in the middle of the longest calm run, so nothing chains across the beginning
  let best = 0, bestEnd = -1, run = 0;
  for (let k = 0; k < 2 * n; k++) { if (Math.abs(curv[k % n]) <= k0) { run++; if (run > best && run <= n) { best = run; bestEnd = k; } } else run = 0; }
  if (bestEnd < 0) return out;
  const p = (bestEnd - Math.floor(best / 2)) % n;
  const turns: (Turn & { sign: number })[] = [];
  let cur: (Turn & { sign: number }) | null = null;
  for (let k = 1; k <= n; k++) {
    const i = (p + k) % n, c = curv[i], sg = c > k0 ? 1 : c < -k0 ? -1 : 0;
    if (cur && sg === cur.sign) { cur.m++; cur.ang += c * ds; cur.peak = Math.max(cur.peak, Math.abs(c)); continue; }
    if (cur) turns.push(cur);
    cur = sg ? { i0: i, m: 1, ang: c * ds, peak: Math.abs(c), ratio: 1, sign: sg } : null;
  }
  if (cur) turns.push(cur);
  const kept = turns.filter((t) => Math.abs(t.ang) >= C.turnMin * DEG);
  for (const t of kept) {
    let a = 0, b = 0; const h = Math.floor(t.m / 2);
    for (let k = 0; k < t.m; k++) { const v = Math.abs(curv[(t.i0 + k) % n]); if (k < h) a += v; else b += v; }
    t.ratio = (b / (t.m - h)) / (a / Math.max(1, h));
    if (Math.abs(t.ang) >= 90 * DEG && t.peak <= 1 / C.sweepRadius) out.sweeps++;
  }
  const off = (i: number) => (i - p + n) % n; // position along the lap from the beginning
  const gap = (a: { i0: number; m: number }, b: { i0: number }) => (off(b.i0) - off(a.i0) - a.m) * ds;
  const groups: Group[] = [];
  for (const t of kept) {
    const g = groups[groups.length - 1];
    if (g && g.sign === t.sign && gap(g, t) <= C.chainGap) { g.m = off(t.i0) + t.m - off(g.i0); g.ang += t.ang; g.turns.push(t); }
    else groups.push({ i0: t.i0, m: t.m, sign: t.sign, ang: t.ang, turns: [t], hairpin: false });
  }
  const W = Math.round(C.hairpinWithin / ds);
  for (const g of groups) {
    let s = 0, top = 0;
    for (let k = 0; k < g.m; k++) { s += curv[(g.i0 + k) % n] * ds; if (k >= W) s -= curv[(g.i0 + k - W) % n] * ds; top = Math.max(top, Math.abs(s)); }
    g.hairpin = top >= C.hairpinTurn * DEG;
  }
  const mid = (i0: number, m: number) => (i0 + Math.floor(m / 2)) % n;
  const used = new Set<Group>();
  for (const g of groups) if (g.hairpin) out.features.push({ kind: 'hairpin', at: mid(g.i0, g.m) });
  // chains of alternating corners
  for (let a = 0; a < groups.length;) {
    let b = a;
    while (b + 1 < groups.length && !groups[b].hairpin && !groups[b + 1].hairpin && gap(groups[b], groups[b + 1]) <= C.chainGap) b++;
    if (b > a) {
      const ch = groups.slice(a, b + 1);
      let chic = false;
      for (let k = 0; k + 1 < ch.length; k++) {
        const x = ch[k], y = ch[k + 1];
        if (Math.abs(x.ang) >= C.chicaneTurn * DEG && Math.abs(y.ang) >= C.chicaneTurn * DEG && (off(y.i0) + y.m - off(x.i0)) * ds <= C.chicaneWithin) chic = true;
      }
      const ess = !chic && ch.length >= 3 && ch.every((g) => Math.abs(g.ang) >= C.essTurn * DEG);
      if (chic || ess) {
        ch.forEach((g) => used.add(g));
        out.features.push({ kind: chic ? 'chicane' : 'esses', at: mid(ch[0].i0, off(ch[ch.length - 1].i0) + ch[ch.length - 1].m - off(ch[0].i0)) });
      }
    }
    a = b + 1;
  }
  for (const g of groups) {
    if (g.hairpin || used.has(g)) continue;
    if (g.turns.length >= 2 && Math.abs(g.ang) >= 60 * DEG && g.turns.every((t) => Math.abs(t.ang) >= 20 * DEG)) out.features.push({ kind: 'double apex', at: mid(g.i0, g.m) });
    else if (g.turns.length === 1 && Math.abs(g.ang) >= 60 * DEG && g.turns[0].ratio >= C.decreasing) out.features.push({ kind: 'decreasing radius', at: mid(g.i0, g.m) });
  }
  out.features.sort((x, y) => off(x.at) - off(y.at));
  return out;
}

/** The rule for every family but the figure eight: a sweep, two features, one of them a hairpin or a chicane. */
export const shapeOk = (s: Shape): boolean =>
  s.sweeps >= 1 && s.features.length >= 2 && s.features.some((f) => f.kind === 'hairpin' || f.kind === 'chicane');

/**
 * Where the centreline crosses itself: pairs of samples (a, b), a < b, nearest to each crossing point, from every pair
 * of segments more than farAlong apart along the track that cross at a real angle (brute force: only the figure eight
 * asks; collinear pieces of one straight would otherwise "cross" by round-off).
 */
export function crossings(px: Float64Array, py: Float64Array, n: number, ds: number): [number, number][] {
  const out: [number, number][] = [];
  const along = C.farAlong / ds;
  for (let i = 0; i < n; i++) {
    const i1 = (i + 1) % n, ax = px[i], ay = py[i], ex = px[i1] - ax, ey = py[i1] - ay;
    for (let j = i + 1; j < n; j++) {
      if (circ(i, j, n) <= along) continue;
      const j1 = (j + 1) % n, fx = px[j1] - px[j], fy = py[j1] - py[j];
      const den = ex * fy - ey * fx;
      if (den * den < 1e-6 * (ex * ex + ey * ey) * (fx * fx + fy * fy)) continue; // within 0.06° of parallel
      const wx = px[j] - ax, wy = py[j] - ay, u = (wx * fy - wy * fx) / den, v = (wx * ey - wy * ex) / den;
      if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
      out.push([u < 0.5 ? i : i1, v < 0.5 ? j : j1]);
    }
  }
  return out;
}

function reject(r: Reject): null {
  rejectCounts[r]++;
  return null;
}

function resample(dx: Float64Array, dy: Float64Array, spacing: number) {
  const m = dx.length;
  const cum = new Float64Array(m + 1);
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    const ex = dx[j] - dx[i], ey = dy[j] - dy[i];
    cum[i + 1] = cum[i] + Math.sqrt(ex * ex + ey * ey);
  }
  const len = cum[m];
  const n = Math.max(3, Math.round(len / spacing));
  const ds = len / n;
  const px = new Float64Array(n), py = new Float64Array(n);
  let seg = 0;
  for (let k = 0; k < n; k++) {
    const s = k * ds;
    while (seg < m - 1 && cum[seg + 1] < s) seg++;
    const j = (seg + 1) % m;
    const f = (s - cum[seg]) / (cum[seg + 1] - cum[seg]);
    px[k] = dx[seg] + (dx[j] - dx[seg]) * f;
    py[k] = dy[seg] + (dy[j] - dy[seg]) * f;
  }
  return { px, py, len, n, ds };
}

/**
 * Parts more than farAlong apart along the track are at least farApart apart in space, except across the declared
 * crossing (a sample in zone 1 and one in zone 2: the two passes over it).
 */
export function farPartsApart(px: Float64Array, py: Float64Array, n: number, ds: number, zone?: Uint8Array): boolean {
  const cell = C.farApart;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { x0 = Math.min(x0, px[i]); y0 = Math.min(y0, py[i]); x1 = Math.max(x1, px[i]); y1 = Math.max(y1, py[i]); }
  const cols = Math.floor((x1 - x0) / cell) + 1, rows = Math.floor((y1 - y0) / cell) + 1;
  const buckets: number[][] = Array.from({ length: cols * rows }, () => []);
  const ci = new Int32Array(n), cj = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    ci[i] = Math.floor((px[i] - x0) / cell); cj[i] = Math.floor((py[i] - y0) / cell);
    buckets[cj[i] * cols + ci[i]].push(i);
  }
  const along = C.farAlong / ds, r2 = C.farApart * C.farApart;
  for (let i = 0; i < n; i++) {
    for (let gy = cj[i] - 1; gy <= cj[i] + 1; gy++) {
      if (gy < 0 || gy >= rows) continue;
      for (let gx = ci[i] - 1; gx <= ci[i] + 1; gx++) {
        if (gx < 0 || gx >= cols) continue;
        for (const j of buckets[gy * cols + gx]) {
          if (j <= i) continue;
          const d = j - i;
          if (Math.min(d, n - d) <= along) continue;
          if (zone && zone[i] && zone[j] && zone[i] !== zone[j]) continue;
          const ex = px[j] - px[i], ey = py[j] - py[i];
          if (ex * ex + ey * ey < r2) return false;
        }
      }
    }
  }
  return true;
}

function buildGrid(px: Float64Array, py: Float64Array, tx: Float64Array, ty: Float64Array, n: number, off: number, sampleLayer: Uint8Array): WallGrid {
  // wall polylines: left = p + n·off, right = p − n·off, with n = (−ty, tx)
  const wx = new Float64Array(2 * n), wy = new Float64Array(2 * n);
  for (let i = 0; i < n; i++) {
    wx[i] = px[i] - ty[i] * off; wy[i] = py[i] + tx[i] * off;
    wx[n + i] = px[i] + ty[i] * off; wy[n + i] = py[i] - tx[i] * off;
  }
  const seg = new Float64Array(2 * n * 4), layer = new Uint8Array(2 * n);
  for (let side = 0; side < 2; side++) {
    for (let i = 0; i < n; i++) {
      const a = side * n + i, b = side * n + (i + 1) % n, s = (side * n + i) * 4;
      layer[side * n + i] = sampleLayer[i];
      seg[s] = wx[a]; seg[s + 1] = wy[a]; seg[s + 2] = wx[b] - wx[a]; seg[s + 3] = wy[b] - wy[a];
    }
  }
  const cell = C.gridCell, margin = 2 * cell;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < 2 * n; i++) { x0 = Math.min(x0, wx[i]); y0 = Math.min(y0, wy[i]); x1 = Math.max(x1, wx[i]); y1 = Math.max(y1, wy[i]); }
  x0 -= margin; y0 -= margin; x1 += margin; y1 += margin;
  const cols = Math.floor((x1 - x0) / cell) + 1, rows = Math.floor((y1 - y0) / cell) + 1;
  const counts = new Int32Array(cols * rows + 1);
  const m = 2 * n;
  const forCells = (s: number, f: (c: number) => void) => {
    const ax = seg[s * 4], ay = seg[s * 4 + 1], bx = ax + seg[s * 4 + 2], by = ay + seg[s * 4 + 3];
    const gx0 = Math.floor((Math.min(ax, bx) - x0) / cell), gx1 = Math.floor((Math.max(ax, bx) - x0) / cell);
    const gy0 = Math.floor((Math.min(ay, by) - y0) / cell), gy1 = Math.floor((Math.max(ay, by) - y0) / cell);
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) f(gy * cols + gx);
  };
  for (let s = 0; s < m; s++) forCells(s, (c) => counts[c + 1]++);
  const start = new Int32Array(cols * rows + 1);
  for (let c = 0; c < cols * rows; c++) start[c + 1] = start[c] + counts[c + 1];
  const fill = start.slice(0, cols * rows);
  const items = new Int32Array(start[cols * rows]);
  for (let s = 0; s < m; s++) forCells(s, (c) => { items[fill[c]++] = s; });
  return { x0, y0, cell, cols, rows, start, items, seg, layer };
}

/** The layer whose walls a car at sample i cannot see (0: none): the other pass at the figure eight's crossing. */
export const hiddenLayer = (t: Track, i: number): number => { const l = t.layer[i]; return l === 0 ? 0 : 3 - l; };

/**
 * Distance along the ray (ox,oy) + t·(dx,dy) (unit) to the first wall, or maxD if none within it. Grid DDA. Walls of
 * layer `skip` (hiddenLayer of the car's sample; 0 = none) are not there for this ray.
 */
export function castRay(g: WallGrid, ox: number, oy: number, dx: number, dy: number, maxD: number, skip = 0): number {
  const gx = (ox - g.x0) / g.cell, gy = (oy - g.y0) / g.cell;
  let cx = Math.floor(gx), cy = Math.floor(gy);
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
  const tdx = dx !== 0 ? g.cell / Math.abs(dx) : Infinity, tdy = dy !== 0 ? g.cell / Math.abs(dy) : Infinity;
  let tmx = dx !== 0 ? ((cx + (dx > 0 ? 1 : 0)) - gx) * g.cell / dx : Infinity;
  let tmy = dy !== 0 ? ((cy + (dy > 0 ? 1 : 0)) - gy) * g.cell / dy : Infinity;
  let best = maxD;
  const seg = g.seg, items = g.items, start = g.start;
  for (;;) {
    if (cx >= 0 && cy >= 0 && cx < g.cols && cy < g.rows) {
      const c = cy * g.cols + cx;
      for (let k = start[c], e = start[c + 1]; k < e; k++) {
        const id = items[k];
        if (skip !== 0 && g.layer[id] === skip) continue;
        const s = id * 4;
        const ex = seg[s + 2], ey = seg[s + 3];
        const den = dx * ey - dy * ex;
        if (den > -1e-12 && den < 1e-12) continue;
        const wx = seg[s] - ox, wy = seg[s + 1] - oy;
        const t = (wx * ey - wy * ex) / den;
        if (t < 0 || t >= best) continue;
        const u = (wx * dy - wy * dx) / den;
        // a ray through a shared vertex can land at u = −ε on one segment and 1 + ε on the next: accept both edges
        if (u < -1e-9 || u > 1 + 1e-9) continue;
        best = t;
      }
    }
    const tn = tmx < tmy ? tmx : tmy;
    if (best <= tn || tn > maxD) return best;
    if (tmx < tmy) { tmx += tdx; cx += sx; } else { tmy += tdy; cy += sy; }
  }
}

/** Nearest centreline sample to (x, y), searching ±span around a guess. */
export function locate(t: Track, x: number, y: number, guess: number, span: number): number {
  let best = guess, bd = Infinity;
  const n = t.n;
  for (let k = -span; k <= span; k++) {
    const i = ((guess + k) % n + n) % n;
    const ex = x - t.px[i], ey = y - t.py[i];
    const d = ex * ex + ey * ey;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
