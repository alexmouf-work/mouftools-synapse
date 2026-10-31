import { describe, expect, it } from 'vitest';
import { cos, sin } from '../../src/common/fmath';
import { eyeDirection, readSensors } from '../../src/common/sim/sensors';
import { startCar } from '../../src/common/sim/car';
import { castRay, generateTrack } from '../../src/common/sim/track';
import { CONFIG } from '../../src/common/config';
import { INPUTS } from '../../src/common/sim/spec';
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

describe('spikes (rate coding, one rule for every input)', () => {
  it('fires at SPIKE_MAX_HZ × |reading|: near wall fast, nothing in range never, unwired never', () => {
    const t = new SpikeTrains(4);
    const readings = [0.9, 0.2, 0, 0.9], used = [1, 1, 1, 0];
    for (let k = 0; k < 600; k++) t.update(readings, used, 1 / 60, k / 60); // 10 s
    expect(t.counts[0]).toBeGreaterThan(t.counts[1]);
    expect(Math.abs(t.counts[0] - SPIKE_MAX_HZ * 0.9 * 10)).toBeLessThanOrEqual(1);
    expect(Math.abs(t.counts[1] - SPIKE_MAX_HZ * 0.2 * 10)).toBeLessThanOrEqual(1);
    expect(t.counts[2]).toBe(0);
    expect(t.counts[3]).toBe(0);
    expect(spikeRate(-0.5)).toBe(spikeRate(0.5)); // road ahead by magnitude
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

describe('eye directions: one rule for the sensors and the beams', () => {
  it('eyeDirection is the heading turned by each eye angle, and it is what the sensors cast along', () => {
    const tr = generateTrack(6), c = startCar(tr);
    for (const hdg of [0, 0.7, -2.1, 3.0]) {
      c.hdg = hdg;
      const out = new Float64Array(10);
      readSensors(c, tr, Uint8Array.from([1, 1, 1, 1, 1, 1, 0, 0, 0, 0]), CONFIG.budget[0] * 1200, out);
      for (let e = 0; e < 6; e++) {
        const { dx, dy } = eyeDirection(hdg, e);
        const a = hdg - (INPUTS[e].deg as number) * Math.PI / 180; // clockwise eye angle from the nose
        expect(dx).toBeCloseTo(cos(a), 12); expect(dy).toBeCloseTo(sin(a), 12);
        expect(out[e]).toBeCloseTo(1 - castRay(tr.grid, c.x, c.y, dx, dy, CONFIG.sensors.eyeRange) / CONFIG.sensors.eyeRange, 12);
      }
    }
    // the left eye looks left of the heading (counter-clockwise), the right eye right, the back eye behind
    const L = eyeDirection(0, 0), R = eyeDirection(0, 4), B = eyeDirection(0, 5);
    expect(L.dy).toBeCloseTo(1, 12); expect(R.dy).toBeCloseTo(-1, 12); expect(B.dx).toBeCloseTo(-1, 12);
  });
});
