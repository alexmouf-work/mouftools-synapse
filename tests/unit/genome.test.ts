import { describe, expect, it } from 'vitest';
import { genomeFromJSON, genomeHash, genomeToJSON, minimalSpec, starterSpec } from '../../src/common/sim/brain';
import { Rng } from '../../src/common/rng';

describe('genome JSON', () => {
  it('round-trips hash-identical, awkward doubles included', () => {
    const awkward = [0.1 + 0.2, 1e-300, -0, 3.9999999999999996, -4, 5e-324, 1 / 3, -2.220446049250313e-16];
    for (const spec of [starterSpec(), minimalSpec()]) {
      const r = new Rng(5);
      const w = spec.conns.map((_, k) => awkward[k] ?? r.range(-4, 4));
      const g = { spec, w };
      const back = genomeFromJSON(genomeToJSON(g));
      expect(genomeHash(back)).toBe(genomeHash(g));
      expect(genomeToJSON(back)).toBe(genomeToJSON(g));
      back.w.forEach((x, k) => expect(x === w[k]).toBe(true));
    }
  });
  it('a broken save fails loudly', () => {
    expect(() => genomeFromJSON('{"spec":{"v":1,"layers":1,"nodes":[],"conns":[{"from":"o:fl","to":"i:f"}]},"w":[1]}')).toThrow();
    expect(() => genomeFromJSON('not json')).toThrow();
  });
});
