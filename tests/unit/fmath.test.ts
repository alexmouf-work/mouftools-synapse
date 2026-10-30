import { describe, expect, it } from 'vitest';
import * as F from '../../src/common/fmath';

const xs: number[] = [];
for (let i = -2000; i <= 2000; i++) xs.push(i * 0.0137);
xs.push(0, -0, 1e-12, -1e-12, 1e-300, 50, -50, 700, -700);

describe('fmath matches the engine to ~1e-14 (and is built only from exact IEEE ops)', () => {
  it('sin, cos', () => {
    for (const x of xs) {
      expect(Math.abs(F.sin(x) - Math.sin(x))).toBeLessThan(1e-14 * Math.max(1, Math.abs(x)));
      expect(Math.abs(F.cos(x) - Math.cos(x))).toBeLessThan(1e-14 * Math.max(1, Math.abs(x)));
    }
  });
  it('exp, tanh, sigmoid', () => {
    for (const x of xs) {
      if (Math.abs(x) < 700) expect(Math.abs(F.exp(x) / Math.exp(x) - 1)).toBeLessThan(1e-13);
      expect(Math.abs(F.tanh(x) - Math.tanh(x))).toBeLessThan(1e-15 + 1e-14 * Math.abs(Math.tanh(x)));
      expect(Math.abs(F.sigmoid(x) - 1 / (1 + Math.exp(-x)))).toBeLessThan(1e-15);
    }
    expect(F.tanh(0)).toBe(0);
    expect(F.sigmoid(0)).toBe(0.5);
    expect(F.exp(0)).toBe(1);
  });
  it('atan2, log', () => {
    for (const y of [-3, -1, -1e-9, 0, 1e-9, 0.5, 1, 7]) for (const x of [-5, -1, -1e-9, 0, 1e-9, 0.3, 1, 9]) {
      expect(Math.abs(F.atan2(y, x) - Math.atan2(y, x))).toBeLessThan(1e-14);
    }
    for (const x of [1e-300, 1e-9, 0.1, 0.5, 1, 1.4142135623730951, 2, 10, 12345.678]) {
      expect(Math.abs(F.log(x) - Math.log(x))).toBeLessThan(1e-13 * Math.max(1, Math.abs(Math.log(x))));
    }
    expect(() => F.log(0)).toThrow();
  });
  it('wrapAngle', () => {
    for (const a of [-20, -Math.PI, 0, Math.PI, 3 * Math.PI, 20]) {
      const w = F.wrapAngle(a);
      expect(w).toBeGreaterThan(-Math.PI);
      expect(w).toBeLessThanOrEqual(Math.PI);
      expect(Math.abs(Math.sin(w) - Math.sin(a))).toBeLessThan(1e-12);
    }
  });
});
