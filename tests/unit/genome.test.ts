import { describe, expect, it } from 'vitest';
import { genomeFromJSON, genomeHash, genomeToJSON } from '../../src/common/sim/brain';
import { defaultSpec, wireCount, type BrainSpec } from '../../src/common/sim/spec';
import { Rng } from '../../src/common/rng';

describe('genome JSON', () => {
  it('round-trips hash-identical, awkward doubles included', () => {
    const awkward = [0.1 + 0.2, 1e-300, -0, 3.9999999999999996, -4, 5e-324, 1 / 3, -2.220446049250313e-16];
    const big: BrainSpec = { v: 2, senses: { boundary: 3, landmark: 1, hd: 2, grid: 2, speed: 1 }, layers: [{ n: 4, fn: 'relu' }, { n: 2, fn: 'linear' }] };
    for (const spec of [defaultSpec(), big]) {
      const r = new Rng(5);
      const w = Array.from({ length: wireCount(spec) }, (_, k) => awkward[k] ?? r.range(-4, 4));
      const g = { spec, w };
      const back = genomeFromJSON(genomeToJSON(g));
      expect(genomeHash(back)).toBe(genomeHash(g));
      expect(genomeToJSON(back)).toBe(genomeToJSON(g));
      back.w.forEach((x, k) => expect(x === w[k]).toBe(true));
    }
  });
  it('a broken save fails loudly', () => {
    expect(() => genomeFromJSON('{"spec":{"v":2,"senses":{"boundary":9,"landmark":0,"hd":0,"grid":0,"speed":0},"layers":[{"n":1,"fn":"tanh"}]},"w":[]}')).toThrow();
    expect(() => genomeFromJSON('{"spec":{"v":2,"senses":{"boundary":1,"landmark":0,"hd":0,"grid":0,"speed":0},"layers":[{"n":1,"fn":"step"}]},"w":[0,0,0,0,0]}')).toThrow();
    expect(() => genomeFromJSON('{"spec":{"v":2,"senses":{"boundary":1,"landmark":0,"hd":0,"grid":0,"speed":0},"layers":[{"n":1,"fn":"tanh"}]},"w":[0]}')).toThrow();
    expect(() => genomeFromJSON('not json')).toThrow();
  });
});
