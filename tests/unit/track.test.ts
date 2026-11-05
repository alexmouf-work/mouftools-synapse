import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/common/config';
import { Hasher } from '../../src/common/hash';
import { castRay, courseLine, crossings, detectShape, FAMILIES, familyOf, generateTrack, hiddenLayer, shapeOk, trackOfFamily, type Piece, type Track } from '../../src/common/sim/track';
import { startCar, stepPhysics } from '../../src/common/sim/car';
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
  // the start sits on a straight of at least straightLen
  let run = 1;
  for (const dir of [1, -1]) for (let k = 1; k < t.n && Math.abs(t.curv[(t.startIdx + dir * k + t.n) % t.n]) < C.straightCurv; k++) run++;
  expect(run * t.ds).toBeGreaterThanOrEqual(C.straightLen);
  // every family but the figure eight: a sweep, two features, one a hairpin or a chicane (and the track says which)
  const shape = detectShape(t.curv, t.ds);
  expect(t.features).toEqual(shape.features);
  if (t.family !== 'eight') expect(shapeOk(shape)).toBe(true);
  // nothing on the figure eight's crossing: no start, pad or gate on the ramps (or under them)
  expect(t.layer[t.startIdx]).toBe(0);
  for (const p of t.pads) for (let j = 0; j < p.n; j++) expect(t.layer[(p.i0 + j) % t.n]).toBe(0);
  for (const g of t.gates) expect(t.layer[g]).toBe(0);
  expect(t.crossing !== null).toBe(t.family === 'eight');
  if (t.family !== 'eight') expect(Math.max(...t.layer, ...t.deck)).toBe(0);
}

/** Brute-force O(n²) version of the "far parts apart" rule, independent of the generator's grid. */
function bruteFarApart(t: Track): boolean {
  for (let i = 0; i < t.n; i++) for (let j = i + 1; j < t.n; j++) {
    const d = j - i;
    if (Math.min(d, t.n - d) * t.ds <= C.farAlong) continue;
    if (t.layer[i] && t.layer[j] && t.layer[i] !== t.layer[j]) continue; // the declared crossing
    const ex = t.px[j] - t.px[i], ey = t.py[j] - t.py[i];
    if (ex * ex + ey * ey < C.farApart * C.farApart) return false;
  }
  return true;
}

const D = Math.PI / 180;
const L = (len: number): Piece => ({ arc: false, len, min: 0, w: 0 });
const A = (r: number, deg: number): Piece => ({ arc: true, r, a: deg * D });
/** A stadium: two straights with `mid` in the middle of each, two ends `end`; closed by symmetry. */
const stadium = (end: Piece[], mid: Piece[] = []): Piece[] => [L(200), ...mid, L(200), ...end, L(200), ...mid, L(200), ...end];
const kinds = (ps: Piece[]) => { const c = courseLine(ps), s = detectShape(c.curv, c.ds); return { sweeps: s.sweeps, kinds: s.features.map((f) => f.kind) }; };

describe('feature detector', () => {
  it('finds known shapes', () => {
    expect(kinds(stadium([A(80, 180)]))).toEqual({ sweeps: 2, kinds: [] });
    expect(kinds(stadium([A(35, 180)]))).toEqual({ sweeps: 0, kinds: ['hairpin', 'hairpin'] });
    expect(kinds(stadium([A(80, 180)], [A(32, 40), L(6), A(32, -80), L(6), A(32, 40)]))).toEqual({ sweeps: 2, kinds: ['chicane', 'chicane'] });
    expect(kinds(stadium([A(80, 180)], [A(40, 45), L(8), A(40, -45)]))).toEqual({ sweeps: 2, kinds: ['chicane', 'chicane'] });
    expect(kinds(stadium([A(80, 180)], [A(70, 24), L(8), A(70, -48), L(8), A(70, 24)]))).toEqual({ sweeps: 2, kinds: ['esses', 'esses'] });
    expect(kinds(stadium([A(65, 95), L(20), A(65, 85)]))).toEqual({ sweeps: 2, kinds: ['double apex', 'double apex'] }); // the 95° halves sweep
    expect(kinds(stadium([A(100, 100), A(45, 80)]))).toEqual({ sweeps: 0, kinds: ['decreasing radius', 'decreasing radius'] });
    // the same corner the other way round opens out: not a decreasing radius
    expect(kinds(stadium([A(45, 80), A(100, 100)])).kinds).toEqual([]);
    // two opposite turns too far apart, or under 30°: neither a chicane nor esses
    expect(kinds(stadium([A(80, 180)], [A(40, 45), L(60), A(40, -45)])).kinds).toEqual([]);
    expect(kinds(stadium([A(80, 180)], [A(60, 20), L(6), A(60, -20)])).kinds).toEqual([]);
  });
});

describe('track generator', () => {
  it('1000 seeds give valid tracks', () => {
    for (let s = 1; s <= 1000; s++) checkTrack(generateTrack(s));
  });
  it('every family over 200 seeds meets the rules (2–3 km, straight, sweep, features), and varies', () => {
    for (const f of FAMILIES) {
      const seen = new Set<string>();
      for (let s = 1; s <= 200; s++) {
        const t = trackOfFamily(s, f);
        expect(t.family).toBe(f);
        checkTrack(t);
        seen.add(t.features.map((x) => x.kind).join());
      }
      if (f !== 'eight') expect(seen.size).toBeGreaterThanOrEqual(5); // features placed by the seed
    }
  }, 60_000);
  it('no near-overlaps (brute force, 40 seeds and 5 of each family)', () => {
    for (let s = 1; s <= 40; s++) expect(bruteFarApart(generateTrack(s))).toBe(true);
    for (const f of FAMILIES) for (let s = 1; s <= 5; s++) expect(bruteFarApart(trackOfFamily(s, f))).toBe(true);
  });
  it('the seed picks the family: all seven, about equally, and every family gives valid tracks', () => {
    const count: Record<string, number> = {};
    for (let s = 1; s <= 700; s++) count[familyOf(s)] = (count[familyOf(s)] ?? 0) + 1;
    expect(Object.keys(count).sort()).toEqual([...FAMILIES].sort());
    for (const f of FAMILIES) expect(count[f]).toBeGreaterThan(60);
    for (let s = 1; s <= 50; s++) expect(generateTrack(s).family).toBe(familyOf(s));
  });
  it('the figure eight: one crossing at 60–120°, both passes nearly straight across it, the bridge the second pass', () => {
    for (let s = 1; s <= 40; s++) {
      const t = trackOfFamily(s, 'eight'), x = crossings(t.px, t.py, t.n, t.ds);
      expect(x.length).toBe(1);
      const { lower, upper } = t.crossing!;
      expect([lower, upper].sort((a, b) => a - b)).toEqual(x[0]);
      const dot = t.tx[lower] * t.tx[upper] + t.ty[lower] * t.ty[upper];
      expect(Math.abs(dot)).toBeLessThanOrEqual(0.5 + 1e-12); // 60–120°
      expect((upper - t.startIdx + t.n) % t.n).toBeGreaterThan((lower - t.startIdx + t.n) % t.n); // second from the start
      const reach = (C.crossFlat + C.crossRamp) / t.ds, circ = (a: number, b: number) => Math.min(Math.abs(a - b), t.n - Math.abs(a - b));
      for (let i = 0; i < t.n; i++) {
        expect(t.deck[i]).toBe(circ(i, upper) <= reach ? 1 : 0); // a pure function of the sample index
        expect(t.layer[i]).toBe(circ(i, upper) <= reach ? 2 : circ(i, lower) <= reach ? 1 : 0);
        if (t.layer[i]) expect(Math.abs(t.curv[i])).toBeLessThanOrEqual(C.crossCurv);
      }
    }
  });
  it('at the crossing a ray skips the other pass\'s walls (and only there), equal to brute force over what it may see', () => {
    for (let s = 1; s <= 6; s++) {
      const t = trackOfFamily(s, 'eight'), g = t.grid, r = new Rng(s);
      const brute = (x: number, y: number, dx: number, dy: number, skip: number) => {
        let best = 80;
        for (let k = 0; k < g.seg.length; k += 4) {
          if (skip && g.layer[k / 4] === skip) continue;
          const ex = g.seg[k + 2], ey = g.seg[k + 3], den = dx * ey - dy * ex;
          if (Math.abs(den) < 1e-12) continue;
          const wx = g.seg[k] - x, wy = g.seg[k + 1] - y, tt = (wx * ey - wy * ex) / den, u = (wx * dy - wy * dx) / den;
          if (tt >= 0 && u >= -1e-9 && u <= 1 + 1e-9 && tt < best) best = tt;
        }
        return best;
      };
      for (const at of [t.crossing!.lower, t.crossing!.upper]) {
        const skip = hiddenLayer(t, at);
        expect(skip).toBe(at === t.crossing!.lower ? 2 : 1);
        for (let k = 0; k < 200; k++) {
          const i = (at + r.int(60) - 30 + t.n) % t.n, a = r.range(-Math.PI, Math.PI), dx = Math.cos(a), dy = Math.sin(a);
          expect(castRay(g, t.px[i], t.py[i], dx, dy, 80, hiddenLayer(t, i))).toBeCloseTo(brute(t.px[i], t.py[i], dx, dy, hiddenLayer(t, i)), 9);
        }
        // across the crossing, sideways to the other pass: without the skip its wall is 12.5 m away; with it, only
        // this pass's own walls (further, as the passes cross at an angle)
        const o = at === t.crossing!.lower ? t.crossing!.upper : t.crossing!.lower, nx = -t.ty[o], ny = t.tx[o];
        // (the crossing's sample is up to a sample's length from the exact crossing point)
        expect(Math.abs(castRay(g, t.px[at], t.py[at], nx, ny, 80) - t.wallOff)).toBeLessThan(1.5);
        expect(castRay(g, t.px[at], t.py[at], nx, ny, 80, skip)).toBeGreaterThan(t.wallOff + 5);
      }
    }
  });
  it('a car keeps its own road through the crossing, and cutting across it is a wall', () => {
    for (let s = 1; s <= 10; s++) {
      const t = trackOfFamily(s, 'eight'), circ = (a: number, b: number) => Math.min(Math.abs(a - b), t.n - Math.abs(a - b));
      for (const pass of [t.crossing!.lower, t.crossing!.upper]) {
        // straight through: from 40 m before the crossing to 40 m after, never on the other pass
        const c = startCar(t, (pass - 20 + t.n) % t.n);
        let walls = 0;
        for (let k = 0; k < 60 && circ(c.idx, pass) < 25; k++) { if (stepPhysics(c, t, 0.6, 0.6, 0.6, 0.6)) walls++; expect(circ(c.idx, pass)).toBeLessThan(30); }
        expect(walls).toBe(0);
        // turned onto the other road at the crossing: it hits this road's wall, it does not switch roads
        const o = pass === t.crossing!.lower ? t.crossing!.upper : t.crossing!.lower, d = startCar(t, pass);
        d.hdg = t.th[o];
        let hit = false;
        for (let k = 0; k < 40; k++) { hit = stepPhysics(d, t, 0.5, 0.5, 0.5, 0.5) || hit; expect(circ(d.idx, pass)).toBeLessThan(circ(d.idx, o)); }
        expect(hit).toBe(true);
      }
    }
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
      expect(castRay(t.grid, x, y, tx, ty, 80)).toBeGreaterThan(60); // start sits mid-straight (≥ 250 m)
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
