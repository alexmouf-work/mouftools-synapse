import { describe, expect, it } from 'vitest';
import { cos, sin } from '../../src/common/fmath';
import { bearingDir, boundaryValue } from '../../src/common/sim/sensors';
import { BOUNDARY_DIRS, fieldAct, fieldDirDeg, fieldWidthDeg } from '../../src/common/sim/senses';
import { startCar } from '../../src/common/sim/car';
import { castRay, generateTrack } from '../../src/common/sim/track';
import { CONFIG } from '../../src/common/config';
import { weightStyle } from '../../src/client/ui/weights';
import { FLASH_S, SPIKE_MAX_HZ, SpikeTrains, spikeRate } from '../../src/client/ui/drive/spikes';

describe('weight colours (principal 2026-10-31: red −1, black 0, green +1; thicker and brighter with |w|)', () => {
  it('maps −1, −0.5, 0, 0.5, 1, 4', () => {
    const s = (w: number) => weightStyle(w);
    expect(s(-1).rgb).toEqual([225, 45, 55]);
    expect(s(-0.5).rgb).toEqual([113, 23, 28]);
    expect(s(0).rgb).toEqual([0, 0, 0]);
    expect(s(0.5).rgb).toEqual([23, 100, 43]);
    expect(s(1).rgb).toEqual([45, 200, 85]);
    expect(s(4).rgb).toEqual([45, 200, 85]); // colour clamps beyond ±1 …
    expect(s(-4).rgb).toEqual([225, 45, 55]);
    expect(s(0).width).toBe(1); expect(s(0).alpha).toBeCloseTo(0.3, 12); // a new wire: thin, dark, faint
    expect(s(4).width).toBe(4); expect(s(4).alpha).toBeCloseTo(1, 12); // … thickness and brightness keep growing to the cap
    const ws = [0, 0.5, 1, 4].map((w) => s(w));
    for (let k = 1; k < ws.length; k++) { expect(ws[k].width).toBeGreaterThan(ws[k - 1].width); expect(ws[k].alpha).toBeGreaterThan(ws[k - 1].alpha); }
    expect(s(-0.5).width).toBe(s(0.5).width); // magnitude, not sign
    expect(s(9).width).toBe(4); // capped at the weight cap
  });
});

describe('spikes (rate coding, one rule for every cell)', () => {
  it('fires at SPIKE_MAX_HZ × rate: fast near 1, never at 0, never when switched off', () => {
    const t = new SpikeTrains(4);
    const readings = [0.9, 0.2, 0, 0.9], used = [1, 1, 1, 0];
    for (let k = 0; k < 600; k++) t.update(readings, used, 1 / 60, k / 60); // 10 s
    expect(t.counts[0]).toBeGreaterThan(t.counts[1]);
    expect(Math.abs(t.counts[0] - SPIKE_MAX_HZ * 0.9 * 10)).toBeLessThanOrEqual(1);
    expect(Math.abs(t.counts[1] - SPIKE_MAX_HZ * 0.2 * 10)).toBeLessThanOrEqual(1);
    expect(t.counts[2]).toBe(0);
    expect(t.counts[3]).toBe(0);
    expect(spikeRate(3)).toBe(SPIKE_MAX_HZ); // clamped
  });
  it('a spike is a short flash; slow frames still count every spike', () => {
    const t = new SpikeTrains(1);
    t.update([1], [1], 1, 1); // one 1 s frame at full rate
    expect(t.counts[0]).toBe(SPIKE_MAX_HZ);
    expect(t.flash(0, 1)).toBe(1);
    expect(t.flash(0, 1 + FLASH_S)).toBe(0);
  });
});

describe('boundary vector cells: one rule for the sensors and the beams', () => {
  it('bearingDir turns the heading clockwise by the field angle; a cell reads the best of three rays across its field', () => {
    const tr = generateTrack(6), c = startCar(tr), R = CONFIG.senses.boundary.rangeM;
    for (const hdg of [0, 0.7, -2.1, 3.0]) {
      c.hdg = hdg;
      for (const n of [1, 3, 7]) for (let k = 0; k < n; k++) {
        const deg = fieldDirDeg('boundary', k, n), w = fieldWidthDeg('boundary', n, k);
        const { dx, dy } = bearingDir(hdg, deg), a = hdg - deg * Math.PI / 180;
        expect(dx).toBeCloseTo(cos(a), 12); expect(dy).toBeCloseTo(sin(a), 12);
        let best = 0;
        for (const off of [-w / 2, 0, w / 2]) { const d = bearingDir(hdg, deg + off); best = Math.max(best, fieldAct(off, castRay(tr.grid, c.x, c.y, d.dx, d.dy, R), R, w)); }
        expect(boundaryValue(c, tr, deg, w, R)).toBeCloseTo(best, 12);
      }
    }
    // three cells: left, ahead, right (match-flow v2 table); the left one looks counter-clockwise of the heading
    expect(fieldDirDeg('boundary', 0, 3)).toBe(-45); expect(fieldDirDeg('boundary', 1, 3)).toBe(0); expect(fieldDirDeg('boundary', 2, 3)).toBe(45);
    // the table: mirror-symmetric about the nose, ascending, reaching the sides as the count grows; neighbours cross at half activation
    for (let n = 1; n < BOUNDARY_DIRS.length; n++) {
      const d = BOUNDARY_DIRS[n];
      expect(d.length).toBe(n);
      d.forEach((x, k) => { expect(x + d[n - 1 - k]).toBe(0); if (k) expect(x).toBeGreaterThan(d[k - 1]); });
      if (n > 2) expect(d[n - 1]).toBeGreaterThanOrEqual(BOUNDARY_DIRS[n - 1][n - 2] - 5);
    }
    expect(fieldWidthDeg('boundary', 1)).toBe(60); expect(fieldWidthDeg('boundary', 2, 0)).toBeCloseTo(36, 12);
    expect(bearingDir(0, -90).dy).toBeCloseTo(1, 12); expect(bearingDir(0, 90).dy).toBeCloseTo(-1, 12);
  });
});
