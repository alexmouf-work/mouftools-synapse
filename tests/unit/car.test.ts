import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/common/config';
import { startCar, stepPhysics } from '../../src/common/sim/car';
import { generateTrack, type Track } from '../../src/common/sim/track';
import { Rng } from '../../src/common/rng';

/** Exact distance from (x, y) to the centreline polyline (brute force). */
function distToCentre(t: Track, x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i < t.n; i++) {
    const j = (i + 1) % t.n, ax = t.px[i], ay = t.py[i], ex = t.px[j] - ax, ey = t.py[j] - ay;
    const u = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey)));
    const dx = x - ax - u * ex, dy = y - ay - u * ey;
    best = Math.min(best, Math.sqrt(dx * dx + dy * dy));
  }
  return best;
}

describe('car', () => {
  it('a car driven into the walls never ends a tick outside them', () => {
    for (let s = 1; s <= 12; s++) {
      const t = generateTrack(s), c = startCar(t), r = new Rng(s);
      let o = [1, 1, 1, 1], walls = 0;
      for (let k = 0; k < 1500; k++) {
        if (k % 25 === 0) o = [r.range(-1, 1), r.range(-1, 1), r.range(-1, 1), r.range(-1, 1)].map((x, i) => (k % 50 === 0 ? (i % 2 ? 0.2 : 1) : x));
        if (stepPhysics(c, t, o[0], o[1], o[2], o[3])) walls++;
        if (k % 5 === 0) expect(distToCentre(t, c.x, c.y)).toBeLessThanOrEqual(CONFIG.car.wall);
        expect(Math.abs(c.off)).toBeLessThanOrEqual(CONFIG.car.wallCar + 1e-9);
      }
      expect(walls).toBeGreaterThan(0); // the test really hit walls
    }
  });
  it('accelerates at the limit to wheel speed and turns toward the slower side', () => {
    const t = generateTrack(4);
    const c = startCar(t);
    stepPhysics(c, t, 1, 1, 1, 1);
    expect(c.v).toBeCloseTo(CONFIG.car.accel / CONFIG.tick.hz, 12);
    const d = startCar(t), h0 = d.hdg;
    for (let k = 0; k < 10; k++) stepPhysics(d, t, 1, 0.6, 1, 0.6); // left side faster → turns right (clockwise)
    const dh = Math.atan2(Math.sin(d.hdg - h0), Math.cos(d.hdg - h0));
    expect(dh).toBeLessThan(0);
    const e = startCar(t);
    for (let k = 0; k < 20; k++) stepPhysics(e, t, 0, 0, 0, 0);
    expect(e.v).toBe(0);
    expect(e.prog).toBe(0);
  });
  it('front/rear mismatch scrubs speed', () => {
    const t = generateTrack(4);
    const a = startCar(t), b = startCar(t);
    for (let k = 0; k < 20; k++) { stepPhysics(a, t, 0.5, 0.5, 0.5, 0.5); stepPhysics(b, t, 1, 1, 0, 0); }
    expect(b.v).toBeLessThan(a.v);
  });
});
