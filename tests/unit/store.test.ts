import { describe, expect, it } from 'vitest';
import { draftOf, genomeHash, starterSpec, zeroGenome } from '../../src/common/sim/brain';
import { parse, serialize, starterSaved } from '../../src/client/ui/workbench/store';

describe('workbench save', () => {
  it('round-trips name, next id and the genome exactly', () => {
    const s = starterSpec();
    const saved = { name: 'Gerald', draft: draftOf({ spec: s, w: s.conns.map((_, k) => (k - 8) / 3) }, 12), train: { seed: 4000000000, phases: 3 } };
    const back = parse(serialize(saved));
    expect(back.status).toBe('ok');
    expect(back.saved.name).toBe('Gerald');
    expect(back.saved.draft.nextId).toBe(12);
    expect(back.saved.train).toEqual({ seed: 4000000000, phases: 3 });
    expect(genomeHash(back.saved.draft.genome)).toBe(genomeHash(saved.draft.genome));
  });
  it('a v1 save (before training existed) loads with no training history', () => {
    const v1 = JSON.stringify({ v: 1, name: 'Old', nextId: 4, genome: good.genome });
    const r = parse(v1);
    expect(r.status).toBe('ok');
    expect(r.saved.train).toEqual({ seed: null, phases: 0 });
  });
  it('missing → Starter, quietly', () => {
    const r = parse(null);
    expect(r.status).toBe('missing');
    expect(genomeHash(r.saved.draft.genome)).toBe(genomeHash(zeroGenome(starterSpec())));
  });
  const good = JSON.parse(serialize(starterSaved()));
  const corrupt: [string, string][] = [
    ['not JSON', '{"v":1,'],
    ['another version', JSON.stringify({ ...good, v: 3 })],
    ['a bad training record', JSON.stringify({ ...good, train: { seed: -1, phases: 0 } })],
    ['no genome', JSON.stringify({ ...good, genome: undefined })],
    ['a backward wire', JSON.stringify({ ...good, genome: { ...good.genome, spec: { ...good.genome.spec, conns: [{ from: 'o:fl', to: 'n1' }] }, w: [0] } })],
    ['a weight out of range', JSON.stringify({ ...good, genome: { ...good.genome, w: good.genome.w.map(() => 9) } })],
    ['weights misaligned', JSON.stringify({ ...good, genome: { ...good.genome, w: [] } })],
    ['an empty name', JSON.stringify({ ...good, name: ' ' })],
    ['null', 'null'],
  ];
  for (const [what, text] of corrupt) {
    it(`corrupt (${what}) → Starter, flagged`, () => {
      const r = parse(text);
      expect(r.status).toBe('corrupt');
      expect(genomeHash(r.saved.draft.genome)).toBe(genomeHash(zeroGenome(starterSpec())));
    });
  }
});
