import { describe, expect, it } from 'vitest';
import { defaultGenome, genomeHash } from '../../src/common/sim/brain';
import { parse, serialize, startSaved, starterGenome } from '../../src/client/ui/designer/store';
import { biasCount, fieldCount, SENSE_IDS, starterSpec, validateGenome, wireCount, type Genome } from '../../src/common/sim/spec';

/** A new brain (plan §3c): 2–6 input cells, at least one boundary vector cell, 3 Linear neurons (senses plan §2), untrained. */
function expectStarter(g: Genome): void {
  validateGenome(g);
  const n = SENSE_IDS.reduce((a, id) => a + g.spec.senses[id], 0);
  expect(n).toBeGreaterThanOrEqual(2);
  expect(n).toBeLessThanOrEqual(6);
  expect(g.spec.senses.boundary).toBeGreaterThanOrEqual(1);
  expect(g.spec.layers).toEqual([{ n: 3, fn: 'linear' }]);
  expect(g.w.every((w) => w === 0)).toBe(true);
}

describe('designer save', () => {
  it('round-trips name, trainer, training history and the genome exactly', () => {
    const g = defaultGenome(), genome = { ...g, w: g.w.map((_, k) => (k - 8) / 6) };
    const saved = { name: 'Gerald', genome, train: { seed: 4000000000, phases: 3, temps: [0, 1, -0.75] }, trainer: 'backprop' as const };
    const back = parse(serialize(saved));
    expect(back.status).toBe('ok');
    expect(back.saved.name).toBe('Gerald');
    expect(back.saved.trainer).toBe('backprop');
    expect(back.saved.train).toEqual({ seed: 4000000000, phases: 3, temps: [0, 1, -0.75] });
    expect(genomeHash(back.saved.genome)).toBe(genomeHash(genome));
  });
  it('a save from before brain v2 (versions 1 and 2) loads as the starting brain, flagged so the designer can say why', () => {
    for (const v of [1, 2]) {
      const old = JSON.stringify({ v, name: 'Old', nextId: 4, train: { seed: 5, phases: 2 }, genome: { spec: { v: 1, layers: 1, nodes: [], conns: [] }, w: [] } });
      const r = parse(old);
      expect(r.status).toBe('reset');
      expect(r.saved.name).toBe('Old');
      expect(r.saved.train).toEqual({ seed: null, phases: 0, temps: [] });
      expectStarter(r.saved.genome);
      expect(parse(serialize(r.saved)).status).toBe('ok'); // once: saved back as v3
    }
  });
  it('a brain v2 save from before the built-in biases loads with every bias at 0, weights kept', () => {
    const g = defaultGenome(), wires = wireCount(g.spec), weights = Array.from({ length: wires }, (_, k) => (k % 5) / 4 - 0.5);
    const old = JSON.stringify({ v: 3, name: 'No bias', trainer: 'evolution', train: { seed: 3, phases: 1 }, genome: { spec: g.spec, w: weights } });
    const r = parse(old);
    expect(r.status).toBe('ok');
    expect(r.saved.genome.w.slice(0, wires)).toEqual(weights);
    expect(r.saved.genome.w.slice(wires)).toEqual(new Array(biasCount(g.spec) + fieldCount(g.spec)).fill(0));
    expect(r.saved.train).toEqual({ seed: 3, phases: 1, temps: [0] }); // before the temperature slider: ×1
  });
  it('missing → the starting brain, quietly', () => {
    const r = parse(null);
    expect(r.status).toBe('missing');
    expectStarter(r.saved.genome);
  });
  it('the random starter: 2–6 cells (every count), always a boundary vector cell, every sense drawn; seeded', () => {
    const counts = new Set<number>(), seen = new Set<string>();
    for (let seed = 0; seed < 2000; seed++) {
      const s = starterSpec(seed), g = { spec: s, w: new Array(starterGenome(seed).w.length).fill(0) };
      expectStarter(g);
      counts.add(SENSE_IDS.reduce((a, id) => a + s.senses[id], 0));
      for (const id of SENSE_IDS) if (s.senses[id] > (id === 'boundary' ? 1 : 0)) seen.add(id);
      expect(starterSpec(seed)).toEqual(s); // the same seed, the same brain
    }
    expect([...counts].sort()).toEqual([2, 3, 4, 5, 6]);
    expect([...seen].sort()).toEqual([...SENSE_IDS].sort()); // copies of the boundary cell too
    expectStarter(startSaved().genome);
    expect(new Set(Array.from({ length: 40 }, () => JSON.stringify(startSaved().genome.spec))).size).toBeGreaterThan(5); // crypto-seeded
  });
  const good = JSON.parse(serialize(startSaved()));
  const corrupt: [string, string][] = [
    ['not JSON', '{"v":3,'],
    ['another version', JSON.stringify({ ...good, v: 9 })],
    ['no name', JSON.stringify({ ...good, name: '' })],
    ['an unknown trainer', JSON.stringify({ ...good, trainer: 'magic' })],
    ['bad training history', JSON.stringify({ ...good, train: { seed: -1, phases: 0 } })],
    ['temperatures that do not match the phases', JSON.stringify({ ...good, train: { seed: 1, phases: 2, temps: [0] } })],
    ['a temperature off the slider', JSON.stringify({ ...good, train: { seed: 1, phases: 1, temps: [0.3] } })],
    ['weights that don\'t fit', JSON.stringify({ ...good, genome: { ...good.genome, w: [1] } })],
    ['no genome', JSON.stringify({ ...good, genome: undefined })],
  ];
  for (const [what, text] of corrupt) {
    it(`corrupt (${what}) → the starting brain, flagged`, () => {
      const r = parse(text);
      expect(r.status).toBe('corrupt');
      expectStarter(r.saved.genome);
    });
  }
});
