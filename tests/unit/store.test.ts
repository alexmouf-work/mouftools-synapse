import { describe, expect, it } from 'vitest';
import { defaultGenome, genomeHash } from '../../src/common/sim/brain';
import { parse, serialize, startSaved } from '../../src/client/ui/designer/store';

describe('designer save', () => {
  it('round-trips name, trainer, training history and the genome exactly', () => {
    const g = defaultGenome(), genome = { ...g, w: g.w.map((_, k) => (k - 8) / 3) };
    const saved = { name: 'Gerald', genome, train: { seed: 4000000000, phases: 3 }, trainer: 'backprop' as const };
    const back = parse(serialize(saved));
    expect(back.status).toBe('ok');
    expect(back.saved.name).toBe('Gerald');
    expect(back.saved.trainer).toBe('backprop');
    expect(back.saved.train).toEqual({ seed: 4000000000, phases: 3 });
    expect(genomeHash(back.saved.genome)).toBe(genomeHash(genome));
  });
  it('a save from before brain v2 (versions 1 and 2) loads as the starting brain, flagged so the designer can say why', () => {
    for (const v of [1, 2]) {
      const old = JSON.stringify({ v, name: 'Old', nextId: 4, train: { seed: 5, phases: 2 }, genome: { spec: { v: 1, layers: 1, nodes: [], conns: [] }, w: [] } });
      const r = parse(old);
      expect(r.status).toBe('reset');
      expect(r.saved.name).toBe('Old');
      expect(r.saved.train).toEqual({ seed: null, phases: 0 });
      expect(genomeHash(r.saved.genome)).toBe(genomeHash(defaultGenome()));
      expect(parse(serialize(r.saved)).status).toBe('ok'); // once: saved back as v3
    }
  });
  it('missing → the starting brain, quietly', () => {
    const r = parse(null);
    expect(r.status).toBe('missing');
    expect(genomeHash(r.saved.genome)).toBe(genomeHash(defaultGenome()));
  });
  const good = JSON.parse(serialize(startSaved()));
  const corrupt: [string, string][] = [
    ['not JSON', '{"v":3,'],
    ['another version', JSON.stringify({ ...good, v: 9 })],
    ['no name', JSON.stringify({ ...good, name: '' })],
    ['an unknown trainer', JSON.stringify({ ...good, trainer: 'magic' })],
    ['bad training history', JSON.stringify({ ...good, train: { seed: -1, phases: 0 } })],
    ['weights that don\'t fit', JSON.stringify({ ...good, genome: { ...good.genome, w: [1] } })],
    ['no genome', JSON.stringify({ ...good, genome: undefined })],
  ];
  for (const [what, text] of corrupt) {
    it(`corrupt (${what}) → the starting brain, flagged`, () => {
      const r = parse(text);
      expect(r.status).toBe('corrupt');
      expect(genomeHash(r.saved.genome)).toBe(genomeHash(defaultGenome()));
    });
  }
});
