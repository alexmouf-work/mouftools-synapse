// B2e: learnable receptive fields (brain v2 plan §3ad). An untrained cell reads exactly as before; the field
// parameters move each cell's tuning within its bounds; backprop's field gradients match finite differences wherever
// the sense is smooth (and boundary direction and width, which rays sample, have none).
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/common/config';
import { compile, setWeights, zeroGenome } from '../../src/common/sim/brain';
import { startCar } from '../../src/common/sim/car';
import { fieldGrads } from '../../src/common/sim/fieldgrad';
import { FIELD_BOUNDS, fieldDirDeg, fieldOf, fieldWidthDeg, gridOf, gridPhase, gridScale, hdOf, hdPreferred, speedGainOf } from '../../src/common/sim/senses';
import { readSensors } from '../../src/common/sim/sensors';
import { FIELD_PARAMS, fieldCount, fieldIndex, inputIds, paramCount, type BrainSpec, type SenseId } from '../../src/common/sim/spec';
import { generateTrack } from '../../src/common/sim/track';
import { Rng } from '../../src/common/rng';

const ALL: BrainSpec = { v: 2, senses: { boundary: 3, landmark: 2, hd: 2, grid: 2, speed: 1 }, layers: [{ n: 2, fn: 'tanh' }] };

describe('learned receptive fields', () => {
  it('field parameters of 0 are the even spread: every cell tuned as before', () => {
    const net = compile(zeroGenome(ALL));
    inputIds(ALL).forEach((id, i) => {
      const [, s, kk] = id.split(':'), k = Number(kk), n = ALL.senses[s as SenseId], q = 4 * i;
      if (s === 'boundary' || s === 'landmark') {
        expect(net.tune[q]).toBe(fieldDirDeg(s, k, n));
        expect(net.tune[q + 1]).toBe(fieldWidthDeg(s, n, k));
        expect(net.tune[q + 2]).toBe(s === 'boundary' ? CONFIG.senses.boundary.rangeM : CONFIG.senses.landmark.rangeM);
      } else if (s === 'hd') expect(net.tune[q]).toBe(hdPreferred(k, n));
      else if (s === 'grid') { expect(net.tune[q]).toBe(gridScale(k)); expect(net.gridPhase[i]).toBe(gridPhase(k)); expect([net.tune[q + 1], net.tune[q + 2], net.tune[q + 3]]).toEqual([0, 0, 0]); }
      else expect(net.tune[q]).toBe(1);
    });
    expect(fieldCount(ALL)).toBe(3 * 3 + 2 * 3 + 2 + 2 * 4 + 1);
    expect(paramCount(ALL) - fieldIndex(ALL, 'i:boundary:0')).toBe(fieldCount(ALL));
  });

  it('stays within its bounds however far the parameters go (any direction; width 20–180°; ranges; scale; gain)', () => {
    for (const p of [-4, -2, 0, 2, 4]) {
      for (const s of ['boundary', 'landmark'] as const) for (const n of [1, 3]) {
        const f = fieldOf(s, 0, n, p, p, p), [rl, rh] = s === 'boundary' ? FIELD_BOUNDS.boundaryRange : FIELD_BOUNDS.landmarkRange;
        expect(f.dirDeg).toBeGreaterThanOrEqual(-180); expect(f.dirDeg).toBeLessThanOrEqual(180);
        expect(f.widthDeg).toBeGreaterThanOrEqual(20); expect(f.widthDeg).toBeLessThanOrEqual(180);
        expect(f.rangeM).toBeGreaterThanOrEqual(rl); expect(f.rangeM).toBeLessThanOrEqual(rh);
      }
      const g = gridOf(1, p, p, p, p);
      expect(g.scale).toBeGreaterThanOrEqual(10); expect(g.scale).toBeLessThanOrEqual(60);
      expect(speedGainOf(p)).toBeGreaterThanOrEqual(0.5 - 1e-12); expect(speedGainOf(p)).toBeLessThanOrEqual(2 + 1e-12);
    }
    // the boundary range can shrink to its 5 m floor; a landmark can look out to 40 m and in to 10 m
    expect(fieldOf('boundary', 0, 1, 0, 0, -4).rangeM).toBe(5);
    expect(fieldOf('landmark', 0, 1, 0, 0, -4).rangeM).toBe(10);
    expect(hdOf(0, 1, 4) - hdOf(0, 1, 0)).toBeCloseTo(Math.PI, 12);
  });

  it('backprop\'s field gradients equal finite differences wherever the sense is smooth', () => {
    const t = generateTrack(5), r = new Rng(3), nW = paramCount(ALL);
    const w = Array.from({ length: nW }, () => 0);
    for (let a = fieldIndex(ALL, 'i:boundary:0'); a < nW; a++) w[a] = r.range(-1, 1);
    const net = compile({ spec: ALL, w }), inputs = new Float64Array(net.nIn), plus = new Float64Array(net.nIn), minus = new Float64Array(net.nIn);
    let compared = 0;
    const senseOf = inputIds(ALL).map((id) => id.split(':')[1] as SenseId);
    for (let s = 0; s < 40; s++) {
      const c = startCar(t, (t.startIdx + s * 37) % t.n);
      c.x += r.range(-4, 4); c.y += r.range(-4, 4); c.hdg += r.range(-0.6, 0.6); c.v = r.range(5, 50);
      setWeights(net, w);
      readSensors(c, t, net, inputs);
      for (let i = 0; i < net.nIn; i++) {
        const delta = new Float64Array(net.nNodes); delta[i] = 1;
        const grad = new Float64Array(nW);
        readSensors(c, t, net, inputs); // the reading the gradient belongs to (it keeps the boundary rays it used)
        fieldGrads(net, c, t, delta, grad);
        const a = net.fieldAt[i], sense = senseOf[i];
        for (let j = 0; j < FIELD_PARAMS[sense]; j++) {
          const num = (h: number) => {
            const wp = [...w], wm = [...w]; wp[a + j] += h; wm[a + j] -= h;
            setWeights(net, wp); readSensors(c, t, net, plus);
            setWeights(net, wm); readSensors(c, t, net, minus);
            setWeights(net, w);
            return (plus[i] - minus[i]) / (2 * h);
          };
          const n1 = num(1e-5), n2 = num(2e-5);
          if (sense === 'boundary' && j < 2) { expect(grad[a + j]).toBe(0); continue; } // ray-sampled: no gradient
          if (Math.abs(n1 - n2) > 1e-4 * (1 + Math.abs(n1))) continue; // a kink (a clamp, a ray switching walls)
          expect(grad[a + j]).toBeCloseTo(n1, 5);
          if (grad[a + j] !== 0) compared++;
        }
      }
    }
    expect(compared).toBeGreaterThan(100);
  });
});
