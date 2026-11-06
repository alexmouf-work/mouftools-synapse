import { describe, expect, it } from 'vitest';
import { genomeFromJSON, genomeHash, genomeToJSON } from '../../src/common/sim/brain';
import { defaultSpec, paramCount, type BrainSpec } from '../../src/common/sim/spec';
import { Rng } from '../../src/common/rng';

describe('genome JSON', () => {
  it('round-trips hash-identical, awkward doubles included', () => {
    const awkward = [0.1 + 0.2, 1e-300, -0, 3.9999999999999996, -4, 5e-324, 1 / 3, -2.220446049250313e-16];
    const big: BrainSpec = { v: 2, senses: { boundary: 3, far: 1, hd: 2, grid: 2, speed: 1 }, layers: [{ n: 4, fn: 'relu' }, { n: 2, fn: 'linear' }] };
    for (const spec of [defaultSpec(), big]) {
      const r = new Rng(5);
      const w = Array.from({ length: paramCount(spec) }, (_, k) => awkward[k] ?? r.range(-4, 4));
      const g = { spec, w };
      const back = genomeFromJSON(genomeToJSON(g));
      expect(genomeHash(back)).toBe(genomeHash(g));
      expect(genomeToJSON(back)).toBe(genomeToJSON(g));
      back.w.forEach((x, k) => expect(x === w[k]).toBe(true));
    }
  });
  it('a broken save fails loudly', () => {
    expect(() => genomeFromJSON('{"spec":{"v":2,"senses":{"boundary":9,"far":0,"hd":0,"grid":0,"speed":0},"layers":[{"n":1,"fn":"tanh"}]},"w":[]}')).toThrow();
    expect(() => genomeFromJSON('{"spec":{"v":2,"senses":{"boundary":1,"far":0,"hd":0,"grid":0,"speed":0},"layers":[{"n":1,"fn":"step"}]},"w":[0,0,0,0,0]}')).toThrow();
    expect(() => genomeFromJSON('{"spec":{"v":2,"senses":{"boundary":1,"far":0,"hd":0,"grid":0,"speed":0},"layers":[{"n":1,"fn":"tanh"}]},"w":[0]}')).toThrow();
    expect(() => genomeFromJSON('not json')).toThrow();
  });
});

describe('saves from before the long-range cell (senses plan §3)', () => {
  it('landmark cells load as long-range boundary cells: weights kept, fields back to the table', async () => {
    const { migrateGenome, fieldIndex, paramCount, validateGenome, starterSpec } = await import('../../src/common/sim/spec');
    const { genomeFromJSON } = await import('../../src/common/sim/brain');
    const spec = { v: 2 as const, senses: { boundary: 1, far: 2, hd: 0, grid: 0, speed: 0 }, layers: [{ n: 2, fn: 'tanh' as const }] };
    const w = Array.from({ length: paramCount(spec) }, (_, i) => ((i % 7) - 3) / 2);
    const old = { spec: { ...spec, senses: { boundary: 1, landmark: 2, hd: 0, grid: 0, speed: 0 } }, w } as unknown as Parameters<typeof migrateGenome>[0];
    const g = migrateGenome(old);
    validateGenome(g);
    expect(Object.keys(g.spec.senses)).toEqual(['boundary', 'far', 'hd', 'grid', 'speed']);
    expect(g.spec.senses.far).toBe(2);
    const a = fieldIndex(g.spec, 'i:far:0');
    g.w.forEach((x, i) => expect(x).toBe(i >= a && i < a + 6 ? 0 : w[i]));
    expect(genomeFromJSON(JSON.stringify(old)).spec.senses.far).toBe(2);
    expect(migrateGenome(g)).toBe(g); // nothing to do
    // new layers and the starter are Linear (senses plan §2)
    expect(starterSpec(7).layers[0].fn).toBe('linear');
  });
});
