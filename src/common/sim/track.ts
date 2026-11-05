// Track generator (tracks plan §1–2, mock-up reference/track-shapes-mockup.html). The seed picks a family (loop,
// kidney, hairpin, chicane, dogleg, clover, figure eight); the family's control points get a seeded jitter; then a
// closed centripetal Catmull-Rom through them, resampled every ~2 m, validated (length, tightest corner, no
// near-overlaps, one long straight for the start, room for boost pads). A failed attempt moves to the next sub-seed
// (same family); maxAttempts failures throw. Elevation and scenery are render-only.
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
}

export type Family = 'loop' | 'kidney' | 'hairpin' | 'chicane' | 'dogleg' | 'clover' | 'eight';
export const FAMILIES: readonly Family[] = ['loop', 'kidney', 'hairpin', 'chicane', 'dogleg', 'clover', 'eight'];
/** The family a seed's track belongs to (every sub-seed keeps it). */
export const familyOf = (seed: number): Family => FAMILIES[new Rng(derive(seed >>> 0, TAG.family)).int(FAMILIES.length)];

export function generateTrack(seed: number): Track {
  return trackOfFamily(seed, familyOf(seed));
}

/** The track a seed would give in a given family (tests and previews; generateTrack uses the seed's own family). */
export function trackOfFamily(seed: number, family: Family): Track {
  for (let sub = 0; sub < C.maxAttempts; sub++) {
    const t = attempt(seed >>> 0, sub, family);
    if (t) return t;
  }
  throw new Error(`track: no valid ${family} track for seed ${seed} after ${C.maxAttempts} attempts`);
}

/** Why an attempt failed, for the generator tests. */
export type Reject = 'length' | 'radius' | 'proximity' | 'straight' | 'pads' | 'crossing';
export const rejectCounts: Record<Reject, number> = { length: 0, radius: 0, proximity: 0, straight: 0, pads: 0, crossing: 0 };

// Control points of the mock-up's shapes, in its units (x about −1.5..1.5). Changed only where the validator needs it:
// the kidney keeps one flat side (the start straight), the hairpin is shorter with wider half-circle turns (each at
// least 25 m round once jittered) and the chicane's kink is a gentler step.
const SHAPES: Record<'kidney' | 'hairpin' | 'chicane' | 'dogleg', readonly (readonly [number, number])[]> = {
  kidney: [[-1.0, -0.62], [1.0, -0.62], [1.42, -0.36], [1.52, 0.08], [1.26, 0.5], [0.74, 0.64], [0.3, 0.42], [0, 0.34], [-0.3, 0.42], [-0.74, 0.64], [-1.26, 0.5], [-1.52, 0.08], [-1.42, -0.36]],
  hairpin: [[-0.95, -0.5], [1.05, -0.55], [1.244, -0.469], [1.325, -0.275], [1.244, -0.081], [1.05, 0], [0.2, 0], [0.023, 0.073], [-0.05, 0.25], [0.023, 0.427], [0.2, 0.5], [1.05, 0.5], [1.227, 0.573], [1.3, 0.75], [1.227, 0.927], [1.05, 1.0], [-0.95, 0.74], [-1.233, 0.558], [-1.35, 0.12], [-1.233, -0.318]],
  chicane: [[-1.3, -0.6], [-0.5, -0.62], [-0.2, -0.45], [0.2, -0.45], [0.5, -0.62], [1.3, -0.6], [1.55, 0], [1.3, 0.6], [-1.3, 0.6], [-1.55, 0]],
  dogleg: [[-1.2, -0.8], [0.15, -0.8], [0.45, -0.55], [0.45, -0.1], [0.75, 0.05], [1.2, 0.05], [1.4, 0.45], [1.0, 0.8], [-1.2, 0.8], [-1.45, 0.4], [-1.45, -0.5]],
};

type Pts = { x: number[]; y: number[] };

/** Today's loop: K jittered points round a circle (its random draws unchanged, so a loop seed gives the same track). */
function loopPoints(rng: Rng): Pts {
  const K = C.kMin + rng.int(C.kMax - C.kMin + 1);
  const step = TAU / K;
  const R = rng.range(C.radiusMin, C.radiusMax);
  const x: number[] = [], y: number[] = [];
  for (let i = 0; i < K; i++) {
    const a = i * step + (2 * rng.next() - 1) * C.angleJitter * step;
    const r = R * rng.range(C.radiusScaleMin, 1);
    x.push(r * cos(a)); y.push(r * sin(a));
  }
  return { x, y };
}

/** A mock-up shape: each point jittered, stretched, scaled to a seeded lap length, turned and maybe mirrored. */
function shapePoints(base: readonly (readonly [number, number])[], rng: Rng): Pts {
  const a = rng.range(1 - C.aspectJitter, 1 + C.aspectJitter);
  const x: number[] = [], y: number[] = [];
  for (const [px, py] of base) {
    x.push((px + (2 * rng.next() - 1) * C.pointJitter) * a);
    y.push((py + (2 * rng.next() - 1) * C.pointJitter) / a);
  }
  return place({ x, y }, rng);
}

/** Scale to a lap of U(lapMin, lapMax) (by the control polygon), turn by a seeded angle, mirror half the time. */
function place(p: Pts, rng: Rng): Pts {
  const K = p.x.length;
  let per = 0;
  for (let i = 0; i < K; i++) { const j = (i + 1) % K, dx = p.x[j] - p.x[i], dy = p.y[j] - p.y[i]; per += Math.sqrt(dx * dx + dy * dy); }
  const S = rng.range(C.lapMin, C.lapMax) / per, rot = rng.range(0, TAU), c = cos(rot), s = sin(rot), m = rng.next() < 0.5 ? -1 : 1;
  const x: number[] = [], y: number[] = [];
  for (let i = 0; i < K; i++) { const u = p.x[i] * S * m, v = p.y[i] * S; x.push(c * u - s * v); y.push(s * u + c * v); }
  return { x, y };
}

/** A path drawn by heading and distance (metres, radians), for the clover and the figure eight. */
class Turtle {
  readonly p: Pts = { x: [], y: [] };
  constructor(public x: number, public y: number, public h: number) {}
  line(len: number): void {
    const m = Math.max(1, Math.ceil(len / C.straightStep)), dx = cos(this.h), dy = sin(this.h);
    for (let k = 0; k < m; k++) { this.p.x.push(this.x + dx * len * k / m); this.p.y.push(this.y + dy * len * k / m); }
    this.x += dx * len; this.y += dy * len;
  }
  /** Arc of radius r turning by a (+ left, − right), a point every ≤ 30°. */
  arc(r: number, a: number): void {
    const side = a > 0 ? 1 : -1, cx = this.x - side * r * sin(this.h), cy = this.y + side * r * cos(this.h);
    const m = Math.max(1, Math.ceil(Math.abs(a) / (TAU / 12)));
    for (let k = 0; k < m; k++) {
      const h = this.h + a * k / m;
      this.p.x.push(cx + side * r * sin(h)); this.p.y.push(cy - side * r * cos(h));
    }
    this.h += a;
    this.x = cx + side * r * sin(this.h); this.y = cy - side * r * cos(this.h);
  }
}

const DEG = TAU / 360;

/** Three leaves at 120°: out along a stem, round the leaf's tip, back in, a right-hand bend at the waist. */
function cloverPoints(rng: Rng): Pts {
  const waist = rng.range(65, 80) * DEG, tip = rng.range(52, 60), stem = rng.range(170, 182), bend = rng.range(28, 38);
  const t = new Turtle(0, 0, 0);
  for (let k = 0; k < 3; k++) { t.line(stem); t.arc(tip, TAU / 3 + waist); t.line(stem); t.arc(bend, -waist); }
  return place01(t.p, rng);
}

/**
 * Two lobes and the crossing between them: the passes cross at the origin at θ, each lobe a right-angle-ish corner,
 * a straight down its far side and the mirror corner (the far straight's length F sets how far out the lobe reaches).
 */
function eightPoints(rng: Rng): Pts {
  const th = rng.range(75, 105) * DEG, h0 = th / 2, ch = cos(h0), sh = sin(h0);
  const x: number[] = [], y: number[] = [];
  const lobe = (mx: number, F: number, r: number) => {
    const L = (F / 2 + r * ch) / sh; // the leg from the crossing to the lobe's first corner
    const t = new Turtle(L * ch, L * sh, h0);
    t.arc(r, -(TAU / 4 + h0)); t.line(F); t.arc(r, -(TAU / 4 + h0));
    const out = { x: t.p.x.map((v) => v * mx), y: t.p.y.slice() };
    return { L, out };
  };
  const right = lobe(1, rng.range(180, 215), rng.range(38, 50)), left = lobe(-1, rng.range(180, 215), rng.range(38, 50));
  const leg = (ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax, dy = by - ay, m = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy) / C.straightStep));
    for (let k = 0; k < m; k++) { x.push(ax + dx * k / m); y.push(ay + dy * k / m); }
  };
  x.push(...right.out.x); y.push(...right.out.y);
  leg(right.L * ch, -right.L * sh, -left.L * ch, left.L * sh); // the second leg, lower right to upper left
  x.push(...left.out.x); y.push(...left.out.y);
  leg(-left.L * ch, -left.L * sh, right.L * ch, right.L * sh); // the first leg, lower left to upper right
  return place01({ x, y }, rng);
}

/** Turn and mirror a shape already in metres. */
function place01(p: Pts, rng: Rng): Pts {
  const rot = rng.range(0, TAU), c = cos(rot), s = sin(rot), m = rng.next() < 0.5 ? -1 : 1;
  return { x: p.x.map((u, i) => c * u * m - s * p.y[i]), y: p.x.map((u, i) => s * u * m + c * p.y[i]) };
}

function familyPoints(f: Family, rng: Rng): Pts {
  switch (f) {
    case 'loop': return loopPoints(rng);
    case 'clover': return cloverPoints(rng);
    case 'eight': return eightPoints(rng);
    default: return shapePoints(SHAPES[f], rng);
  }
}

const circ = (a: number, b: number, n: number): number => { const d = a > b ? a - b : b - a; return d < n - d ? d : n - d; };

function attempt(seed: number, sub: number, family: Family): Track | null {
  const rng = new Rng(derive(seed, TAG.track, sub));
  const pts = familyPoints(family, rng);
  const cx = Float64Array.from(pts.x), cy = Float64Array.from(pts.y);
  const dense = catmullRomClosed(cx, cy, 64);
  const { px, py, len, n, ds } = resample(dense.x, dense.y, C.spacing);
  if (len < C.lengthMin || len > C.lengthMax) return reject('length');

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

  // the bridge is the second pass over the crossing from the start
  const deck = new Uint8Array(n), layer = new Uint8Array(n);
  let crossing: Track['crossing'] = null;
  if (ca >= 0) {
    const upperIs = (ca - startIdx + n) % n > (cb - startIdx + n) % n ? 1 : 2;
    for (let i = 0; i < n; i++) if (zone[i]) { const up = zone[i] === upperIs; deck[i] = up ? 1 : 0; layer[i] = up ? 2 : 1; }
    crossing = upperIs === 1 ? { lower: cb, upper: ca } : { lower: ca, upper: cb };
  }

  // pads on the calmest windows off the crossing, far enough apart
  const w = Math.round(C.padLen / ds);
  const calm: { i: number; c: number }[] = [];
  for (let i = 0; i < n; i++) {
    let c = 0, open = true;
    for (let k = 0; k < w; k++) { const j = (i + k) % n; c += Math.abs(curv[j]); open &&= !zone[j]; }
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
  return { seed, sub, n, ds, len, px, py, tx, ty, th, curv, wallOff: CONFIG.car.wall, startIdx, pads, padAt, gates, grid, family, deck, layer, crossing };
}

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

function catmullRomClosed(cx: Float64Array, cy: Float64Array, per: number): { x: Float64Array; y: Float64Array } {
  const K = cx.length;
  const x = new Float64Array(K * per), y = new Float64Array(K * per);
  const knot = (ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax, dy = by - ay;
    return Math.sqrt(Math.sqrt(dx * dx + dy * dy)); // centripetal: |d|^0.5
  };
  for (let i = 0; i < K; i++) {
    const i0 = (i - 1 + K) % K, i1 = i, i2 = (i + 1) % K, i3 = (i + 2) % K;
    const x0 = cx[i0], y0 = cy[i0], x1 = cx[i1], y1 = cy[i1], x2 = cx[i2], y2 = cy[i2], x3 = cx[i3], y3 = cy[i3];
    const t0 = 0, t1 = t0 + knot(x0, y0, x1, y1), t2 = t1 + knot(x1, y1, x2, y2), t3 = t2 + knot(x2, y2, x3, y3);
    for (let k = 0; k < per; k++) {
      const t = t1 + (t2 - t1) * k / per;
      const a1x = (t1 - t) / (t1 - t0) * x0 + (t - t0) / (t1 - t0) * x1, a1y = (t1 - t) / (t1 - t0) * y0 + (t - t0) / (t1 - t0) * y1;
      const a2x = (t2 - t) / (t2 - t1) * x1 + (t - t1) / (t2 - t1) * x2, a2y = (t2 - t) / (t2 - t1) * y1 + (t - t1) / (t2 - t1) * y2;
      const a3x = (t3 - t) / (t3 - t2) * x2 + (t - t2) / (t3 - t2) * x3, a3y = (t3 - t) / (t3 - t2) * y2 + (t - t2) / (t3 - t2) * y3;
      const b1x = (t2 - t) / (t2 - t0) * a1x + (t - t0) / (t2 - t0) * a2x, b1y = (t2 - t) / (t2 - t0) * a1y + (t - t0) / (t2 - t0) * a2y;
      const b2x = (t3 - t) / (t3 - t1) * a2x + (t - t1) / (t3 - t1) * a3x, b2y = (t3 - t) / (t3 - t1) * a2y + (t - t1) / (t3 - t1) * a3y;
      x[i * per + k] = (t2 - t) / (t2 - t1) * b1x + (t - t1) / (t2 - t1) * b2x;
      y[i * per + k] = (t2 - t) / (t2 - t1) * b1y + (t - t1) / (t2 - t1) * b2y;
    }
  }
  return { x, y };
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
