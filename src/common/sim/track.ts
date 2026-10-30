// Track generator: closed centripetal Catmull-Rom through K jittered points round a circle, resampled every ~2 m, then
// validated (length, tightest corner, no near-overlaps, one long straight for the start, room for boost pads). A
// failed attempt moves to the next sub-seed; maxAttempts failures throw. Elevation and scenery are render-only.
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
}

export function generateTrack(seed: number): Track {
  for (let sub = 0; sub < C.maxAttempts; sub++) {
    const t = attempt(seed >>> 0, sub);
    if (t) return t;
  }
  throw new Error(`track: no valid track for seed ${seed} after ${C.maxAttempts} attempts`);
}

/** Why an attempt failed, for the generator tests. */
export type Reject = 'length' | 'radius' | 'proximity' | 'straight' | 'pads';
export const rejectCounts: Record<Reject, number> = { length: 0, radius: 0, proximity: 0, straight: 0, pads: 0 };

function attempt(seed: number, sub: number): Track | null {
  const rng = new Rng(derive(seed, TAG.track, sub));
  const K = C.kMin + rng.int(C.kMax - C.kMin + 1);
  const step = TAU / K;
  const R = rng.range(C.radiusMin, C.radiusMax);
  const cx = new Float64Array(K), cy = new Float64Array(K);
  for (let i = 0; i < K; i++) {
    const a = i * step + (2 * rng.next() - 1) * C.angleJitter * step;
    const r = R * rng.range(C.radiusScaleMin, 1);
    cx[i] = r * cos(a);
    cy[i] = r * sin(a);
  }
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
  if (!farPartsApart(px, py, n, ds)) return reject('proximity');

  // longest circular straight; start in its middle
  let bestLen = 0, bestStart = -1;
  {
    let first = -1;
    for (let i = 0; i < n; i++) if (Math.abs(curv[i]) >= C.straightCurv) { first = i; break; }
    if (first < 0) return reject('straight'); // a circle-free "track" of pure straight cannot close
    let run = 0, runStart = 0;
    for (let k = 1; k <= n; k++) {
      const i = (first + k) % n;
      if (Math.abs(curv[i]) < C.straightCurv) {
        if (run === 0) runStart = i;
        run++;
        if (run > bestLen) { bestLen = run; bestStart = runStart; }
      } else run = 0;
    }
  }
  if (bestLen * ds < C.straightLen) return reject('straight');
  const startIdx = (bestStart + Math.floor(bestLen / 2)) % n;

  // pads on the calmest windows, far enough apart
  const w = Math.round(C.padLen / ds);
  const calm: { i: number; c: number }[] = [];
  for (let i = 0; i < n; i++) {
    let c = 0;
    for (let k = 0; k < w; k++) c += Math.abs(curv[(i + k) % n]);
    calm.push({ i, c });
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
  for (let k = 0; k * gateStep < n - gateStep / 2; k++) gates.push((startIdx + k * gateStep) % n);

  const grid = buildGrid(px, py, tx, ty, n, CONFIG.car.wall);
  return { seed, sub, n, ds, len, px, py, tx, ty, th, curv, wallOff: CONFIG.car.wall, startIdx, pads, padAt, gates, grid };
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

/** Parts more than farAlong apart along the track are at least farApart apart in space. */
export function farPartsApart(px: Float64Array, py: Float64Array, n: number, ds: number): boolean {
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
          const ex = px[j] - px[i], ey = py[j] - py[i];
          if (ex * ex + ey * ey < r2) return false;
        }
      }
    }
  }
  return true;
}

function buildGrid(px: Float64Array, py: Float64Array, tx: Float64Array, ty: Float64Array, n: number, off: number): WallGrid {
  // wall polylines: left = p + n·off, right = p − n·off, with n = (−ty, tx)
  const wx = new Float64Array(2 * n), wy = new Float64Array(2 * n);
  for (let i = 0; i < n; i++) {
    wx[i] = px[i] - ty[i] * off; wy[i] = py[i] + tx[i] * off;
    wx[n + i] = px[i] + ty[i] * off; wy[n + i] = py[i] - tx[i] * off;
  }
  const seg = new Float64Array(2 * n * 4);
  for (let side = 0; side < 2; side++) {
    for (let i = 0; i < n; i++) {
      const a = side * n + i, b = side * n + (i + 1) % n, s = (side * n + i) * 4;
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
  return { x0, y0, cell, cols, rows, start, items, seg };
}

/** Distance along the ray (ox,oy) + t·(dx,dy) (unit) to the first wall, or maxD if none within it. Grid DDA. */
export function castRay(g: WallGrid, ox: number, oy: number, dx: number, dy: number, maxD: number): number {
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
        const s = items[k] * 4;
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
