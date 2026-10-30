import { describe, expect, it } from 'vitest';
import { Hasher } from '../../src/common/hash';
import { derive, hashU, Rng } from '../../src/common/rng';

describe('rng', () => {
  it('same seed, same stream; different seeds differ', () => {
    const a = new Rng(42), b = new Rng(42), c = new Rng(43);
    const sa = Array.from({ length: 50 }, () => a.u32()), sb = Array.from({ length: 50 }, () => b.u32());
    expect(sa).toEqual(sb);
    expect(Array.from({ length: 50 }, () => c.u32())).not.toEqual(sa);
  });
  it('uniform in [0,1), normal ≈ N(0,1)', () => {
    const r = new Rng(7);
    let s = 0, s2 = 0, lo = 1, hi = 0;
    for (let i = 0; i < 20000; i++) { const u = r.next(); lo = Math.min(lo, u); hi = Math.max(hi, u); }
    expect(lo).toBeGreaterThanOrEqual(0); expect(hi).toBeLessThan(1);
    for (let i = 0; i < 20000; i++) { const z = r.normal(); s += z; s2 += z * z; }
    expect(Math.abs(s / 20000)).toBeLessThan(0.03);
    expect(Math.abs(s2 / 20000 - 1)).toBeLessThan(0.05);
  });
  it('derive and hashU are pure functions of their arguments', () => {
    expect(derive(1, 2, 3)).toBe(derive(1, 2, 3));
    expect(derive(1, 2, 3)).not.toBe(derive(1, 3, 2));
    expect(hashU(9, 4, 100)).toBe(hashU(9, 4, 100));
    expect(hashU(9, 4, 100)).not.toBe(hashU(9, 5, 100));
  });
});

describe('hash', () => {
  it('is FNV-1a', () => {
    expect(new Hasher().hex()).toBe('811c9dc5');
    expect(new Hasher().byte(0x61).hex()).toBe('e40c292c'); // "a"
  });
  it('sees the last bit of a double, and −0 vs +0', () => {
    expect(new Hasher().f64(0.1 + 0.2).hex()).not.toBe(new Hasher().f64(0.3).hex());
    expect(new Hasher().f64(-0).hex()).not.toBe(new Hasher().f64(0).hex());
  });
});
