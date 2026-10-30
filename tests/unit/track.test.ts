import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/common/config';
import { Hasher } from '../../src/common/hash';
import { castRay, generateTrack, type Track } from '../../src/common/sim/track';
import { Rng } from '../../src/common/rng';

const C = CONFIG.track;

function checkTrack(t: Track): void {
  expect(t.len).toBeGreaterThanOrEqual(C.lengthMin);
  expect(t.len).toBeLessThanOrEqual(C.lengthMax);
  expect(Math.abs(t.ds - C.spacing)).toBeLessThan(0.01);
  let finite = true, maxCurv = 0, maxGapErr = 0; // per-sample expect() is slow over 1000 tracks: collect, then assert
  for (let i = 0; i < t.n; i++) {
    for (const a of [t.px, t.py, t.tx, t.ty, t.th, t.curv]) finite &&= Number.isFinite(a[i]);
    maxCurv = Math.max(maxCurv, Math.abs(t.curv[i]));
    const j = (i + 1) % t.n, dx = t.px[j] - t.px[i], dy = t.py[j] - t.py[i];
    maxGapErr = Math.max(maxGapErr, Math.abs(Math.sqrt(dx * dx + dy * dy) - t.ds)); // closed, evenly spaced
  }
  expect(finite).toBe(true);
  expect(maxCurv).toBeLessThanOrEqual(1 / C.minRadius);
  expect(maxGapErr).toBeLessThan(0.05);
  expect(t.pads.length).toBeGreaterThanOrEqual(C.padCountMin);
  expect(t.pads.length).toBeLessThanOrEqual(C.padCountMax);
  for (let a = 0; a < t.pads.length; a++) for (let b = a + 1; b < t.pads.length; b++) {
    const d = Math.abs(t.pads[a].i0 - t.pads[b].i0);
    expect(Math.min(d, t.n - d) * t.ds).toBeGreaterThanOrEqual(C.padApart - 1e-9);
  }
  expect(Math.abs(t.curv[t.startIdx])).toBeLessThan(C.straightCurv);
}

/** Brute-force O(n²) version of the "far parts apart" rule, independent of the generator's grid. */
function bruteFarApart(t: Track): boolean {
  for (let i = 0; i < t.n; i++) for (let j = i + 1; j < t.n; j++) {
    const d = j - i;
    if (Math.min(d, t.n - d) * t.ds <= C.farAlong) continue;
    const ex = t.px[j] - t.px[i], ey = t.py[j] - t.py[i];
    if (ex * ex + ey * ey < C.farApart * C.farApart) return false;
  }
  return true;
}

describe('track generator', () => {
  it('1000 seeds give valid tracks', () => {
    for (let s = 1; s <= 1000; s++) checkTrack(generateTrack(s));
  });
  it('no near-overlaps (brute force, 40 seeds)', () => {
    for (let s = 1; s <= 40; s++) expect(bruteFarApart(generateTrack(s))).toBe(true);
  });
  it('is deterministic', () => {
    const h = (t: Track) => new Hasher().f64s(t.px).f64s(t.py).u32(t.startIdx).hex();
    expect(h(generateTrack(77))).toBe(h(generateTrack(77)));
    expect(h(generateTrack(77))).not.toBe(h(generateTrack(78)));
  });
  it('rays from the start see the walls 12.5 m to each side and the open road ahead', () => {
    for (let s = 1; s <= 20; s++) {
      const t = generateTrack(s), i = t.startIdx, x = t.px[i], y = t.py[i], tx = t.tx[i], ty = t.ty[i];
      expect(Math.abs(castRay(t.grid, x, y, -ty, tx, 80) - t.wallOff)).toBeLessThan(0.3);
      expect(Math.abs(castRay(t.grid, x, y, ty, -tx, 80) - t.wallOff)).toBeLessThan(0.3);
      expect(castRay(t.grid, x, y, tx, ty, 80)).toBeGreaterThan(60); // start sits mid-straight (≥ 150 m)
    }
  });
  it('grid ray cast equals brute force over every wall segment (random rays, incl. through vertices)', () => {
    for (let s = 1; s <= 15; s++) {
      const t = generateTrack(s), g = t.grid, r = new Rng(s);
      const brute = (x: number, y: number, dx: number, dy: number) => {
        let best = 80;
        for (let k = 0; k < g.seg.length; k += 4) {
          const ex = g.seg[k + 2], ey = g.seg[k + 3], den = dx * ey - dy * ex;
          if (Math.abs(den) < 1e-12) continue;
          const wx = g.seg[k] - x, wy = g.seg[k + 1] - y, tt = (wx * ey - wy * ex) / den, u = (wx * dy - wy * dx) / den;
          if (tt >= 0 && u >= -1e-9 && u <= 1 + 1e-9 && tt < best) best = tt;
        }
        return best;
      };
      for (let k = 0; k < 400; k++) {
        const i = r.int(t.n), off = r.range(-11.5, 11.5);
        const x = t.px[i] - t.ty[i] * off, y = t.py[i] + t.tx[i] * off;
        let dx: number, dy: number;
        if (k % 4 === 0) { dx = -t.ty[i]; dy = t.tx[i]; if (k % 8 === 0) { dx = -dx; dy = -dy; } } // through a vertex
        else { const a = r.range(-Math.PI, Math.PI); dx = Math.cos(a); dy = Math.sin(a); }
        const ox = k % 4 === 0 ? t.px[i] : x, oy = k % 4 === 0 ? t.py[i] : y;
        expect(castRay(g, ox, oy, dx, dy, 80)).toBeCloseTo(brute(ox, oy, dx, dy), 9);
      }
    }
  });
});
