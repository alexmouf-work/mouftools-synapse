import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/common/config';
import {
  addSense, defaultGenome, genomeHash, insertLayer, removeLayer, removeSense, setLayerFn, setLayerSize, type EditResult,
} from '../../src/common/sim/brain';
import { maxLoad } from '../../src/common/sim/energy';
import { paramCount, type Genome } from '../../src/common/sim/spec';

const ok = (r: EditResult): Genome => { if (!r.ok) throw new Error(`refused: ${r.reason}`); return r.genome; };

describe('edit ops (brain v2: senses, layers, functions; wiring is fixed)', () => {
  it('adding a sense cell re-tunes the set (cells are numbered by count) up to its maximum, then refuses', () => {
    let g = defaultGenome();
    for (let k = 1; k < CONFIG.senses.boundary.max; k++) g = ok(addSense(g, 'boundary'));
    expect(g.spec.senses.boundary).toBe(7);
    const r = addSense(g, 'boundary');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe('full');
    expect(ok(addSense(g, 'speed')).spec.senses.speed).toBe(1);
    expect(addSense(ok(addSense(g, 'speed')), 'speed').ok).toBe(false);
  });
  it('removing a cell; a sense with none refuses', () => {
    const g = ok(removeSense(defaultGenome(), 'hd'));
    expect(g.spec.senses.hd).toBe(0);
    expect(removeSense(g, 'hd').ok).toBe(false);
  });
  it('a new layer starts with two tanh neurons, where it is put; 8 layers at most; the last layer stays', () => {
    let g = ok(setLayerFn(defaultGenome(), 0, 'relu'));
    g = ok(insertLayer(g, 0));
    expect(g.spec.layers).toEqual([{ n: 2, fn: 'tanh' }, { n: 3, fn: 'relu' }]);
    while (g.spec.layers.length < 8) g = ok(insertLayer(g, g.spec.layers.length));
    expect(insertLayer(g, 0).ok).toBe(false);
    while (g.spec.layers.length > 1) g = ok(removeLayer(g, 0));
    expect(g.spec.layers).toEqual([{ n: 2, fn: 'tanh' }]);
    expect(removeLayer(g, 0).ok).toBe(false);
  });
  it('a layer holds 1 to 8 neurons', () => {
    const g = defaultGenome();
    expect(ok(setLayerSize(g, 0, 8)).spec.layers[0].n).toBe(8);
    expect(setLayerSize(g, 0, 9).ok).toBe(false);
    expect(setLayerSize(g, 0, 0).ok).toBe(false);
  });
  it('any edit leaves an untrained brain: every wire, old or new, at weight 0', () => {
    const trained: Genome = { ...defaultGenome(), w: defaultGenome().w.map((_, k) => (k % 3) - 1) };
    for (const g of [ok(addSense(trained, 'grid')), ok(setLayerFn(trained, 0, 'linear')), ok(setLayerSize(trained, 0, 5)), ok(insertLayer(trained, 1))]) {
      expect(g.w.length).toBe(paramCount(g.spec));
      expect(g.w.every((x) => x === 0)).toBe(true);
    }
  });
  it('vs CPU and Multiplayer refuse an edit past 100% flat out; the sandbox allows it', () => {
    // grow a brain one neuron at a time until the next neuron would pass 100% with everything flat out
    let g = defaultGenome();
    for (let L = 0; L < 7; L++) g = ok(insertLayer(g, 0));
    let crossing: { L: number; n: number } | null = null;
    for (let n = 2; n <= 8 && !crossing; n++) for (let L = 0; L < 8 && !crossing; L++) {
      if (g.spec.layers[L].n >= n) continue;
      const next = ok(setLayerSize(g, L, n));
      if (maxLoad(next.spec) > 100) crossing = { L, n }; else g = next;
    }
    expect(crossing).not.toBeNull();
    const { L, n } = crossing!;
    expect(maxLoad(g.spec)).toBeLessThanOrEqual(100);
    const r = setLayerSize(g, L, n, 'match');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe('energy');
    expect(setLayerSize(g, L, n, 'sandbox').ok).toBe(true);
  });
  it('ops never mutate their input', () => {
    const g = defaultGenome(), h = genomeHash(g);
    addSense(g, 'grid'); removeSense(g, 'hd'); insertLayer(g, 0); setLayerSize(g, 0, 6); setLayerFn(g, 0, 'relu');
    expect(genomeHash(g)).toBe(h);
    expect(g.spec.senses.grid).toBe(0);
  });
});
