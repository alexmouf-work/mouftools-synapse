import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/common/config';
import {
  addLayer, addNeuron, addWire, clearWires, deepSpec, draftOf, minimalSpec, removeNeuron, removeWire, setAct, starterSpec,
  unplug, wireCheck, zeroGenome, type Draft, type EditResult,
} from '../../src/common/sim/brain';
import { estimate, staticCost, wireFactors } from '../../src/common/sim/energy';
import { validateGenome } from '../../src/common/sim/spec';

const ok = (r: EditResult): Draft => { if (!r.ok) throw new Error(`refused: ${r.reason}`); return r.draft; };
const weightOf = (d: Draft, from: string, to: string) => {
  const k = d.genome.spec.conns.findIndex((c) => c.from === from && c.to === to);
  return k < 0 ? undefined : d.genome.w[k];
};
/** Starter with distinct non-zero weights, so carried weights can be told apart. */
const trained = (): Draft => { const s = starterSpec(); return draftOf({ spec: s, w: s.conns.map((_, k) => 0.1 * (k + 1)) }); };

describe('edit ops', () => {
  it('ids are stable and never reused after a delete', () => {
    let d = trained();
    const r1 = addNeuron(d, 1); d = ok(r1);
    expect(r1.ok && r1.id).toBe('n4');
    d = removeNeuron(d, 'n4');
    const r2 = addNeuron(d, 1);
    expect(r2.ok && r2.id).toBe('n5');
    expect(ok(r2).genome.spec.nodes.map((n) => n.id)).toEqual(['n1', 'n2', 'n3', 'n5']);
  });
  it('kept wires keep their weights through any edit; new wires start at 0', () => {
    let d = trained();
    const before = d.genome.spec.conns.map((c) => [c.from, c.to, weightOf(d, c.from, c.to)]);
    d = ok(addNeuron(d, 1));
    d = ok(addWire(d, 'i:b', 'n4'));
    d = ok(addLayer(d));
    d = setAct(d, 'n2', 'sigmoid');
    for (const [from, to, w] of before) expect(weightOf(d, from as string, to as string)).toBe(w);
    expect(weightOf(d, 'i:b', 'n4')).toBe(0);
    validateGenome(d.genome);
  });
  it('wires only run to a later layer', () => {
    const d = ok(addLayer(trained())); // n4 on layer 2
    expect(wireCheck(d.genome.spec, 'n4', 'n1')).toBe('backward');
    expect(wireCheck(d.genome.spec, 'n1', 'n2')).toBe('backward'); // same line
    expect(wireCheck(d.genome.spec, 'n1', 'i:f')).toBe('into-car');
    expect(wireCheck(d.genome.spec, 'o:fl', 'n4')).toBe('from-wheel');
    expect(wireCheck(d.genome.spec, 'n1', 'n1')).toBe('same');
    expect(wireCheck(d.genome.spec, 'i:f', 'n1')).toBe('duplicate');
    expect(wireCheck(d.genome.spec, 'n9', 'o:fl')).toBe('unknown');
    expect(wireCheck(d.genome.spec, 'n1', 'n4')).toBeNull();
    expect(wireCheck(d.genome.spec, 'i:b', 'o:rr')).toBeNull(); // car straight to a wheel, skipping lines
    const r = addWire(d, 'n4', 'n1');
    expect(r.ok).toBe(false);
  });
  it('caps: 10 neurons per layer, 3 layers', () => {
    let d = trained();
    for (let k = 3; k < CONFIG.brain.maxPerLayer; k++) d = ok(addNeuron(d, 1));
    expect(addNeuron(d, 1)).toEqual({ ok: false, reason: 'layer-full' });
    d = ok(addLayer(d)); d = ok(addLayer(d));
    expect(d.genome.spec.layers).toBe(3);
    expect(addLayer(d)).toEqual({ ok: false, reason: 'max-layers' });
    expect(addNeuron(d, 4)).toEqual({ ok: false, reason: 'unknown' });
    for (let L = 2; L <= 3; L++) for (let k = 1; k < CONFIG.brain.maxPerLayer; k++) d = ok(addNeuron(d, L));
    expect(d.genome.spec.nodes.length).toBe(30);
    validateGenome(d.genome);
  });
  it('removing the last neuron of a line removes the line and re-numbers the later ones', () => {
    let d = trained();
    const r2 = addLayer(d); d = ok(r2); const mid = r2.ok ? r2.id! : '';
    const r3 = addLayer(d); d = ok(r3); const last = r3.ok ? r3.id! : '';
    d = ok(addWire(d, 'n1', mid)); d = ok(addWire(d, mid, last)); d = ok(addWire(d, 'n1', last)); d = ok(addWire(d, last, 'o:fl'));
    d = removeNeuron(d, mid);
    expect(d.genome.spec.layers).toBe(2);
    expect(d.genome.spec.nodes.find((n) => n.id === last)?.layer).toBe(2);
    expect(weightOf(d, 'n1', last)).toBe(0);
    expect(weightOf(d, last, 'o:fl')).toBe(0);
    expect(d.genome.spec.conns.some((c) => c.from === mid || c.to === mid)).toBe(false); // dangling wires pruned
    validateGenome(d.genome);
  });
  it('the only line stays (empty) when its last neuron goes; car → wheel wires survive', () => {
    let d = draftOf(zeroGenome(minimalSpec()));
    d = ok(addNeuron(d, 1));
    d = removeNeuron(d, 'n1');
    expect(d.genome.spec.layers).toBe(1);
    expect(d.genome.spec.nodes).toEqual([]);
    expect(d.genome.spec.conns.length).toBe(16);
  });
  it('unplug, remove a wire, clear wires', () => {
    let d = trained();
    d = unplug(d, 'n2');
    expect(d.genome.spec.conns.some((c) => c.from === 'n2' || c.to === 'n2')).toBe(false);
    expect(d.genome.spec.nodes.length).toBe(3);
    d = removeWire(d, 'i:f', 'n1');
    expect(weightOf(d, 'i:f', 'n1')).toBeUndefined();
    d = clearWires(d);
    expect(d.genome.spec.conns).toEqual([]);
    expect(d.genome.w).toEqual([]);
    expect(d.genome.spec.nodes.length).toBe(3);
  });
  it('ops never mutate their input', () => {
    const d = trained(), snap = JSON.stringify(d);
    ok(addNeuron(d, 1)); ok(addLayer(d)); removeNeuron(d, 'n1'); setAct(d, 'n1', 'step'); unplug(d, 'i:f'); clearWires(d);
    ok(addWire(d, 'i:b', 'n1')); removeWire(d, 'i:f', 'n1');
    expect(JSON.stringify(d)).toBe(snap);
  });
});

describe('workbench estimate', () => {
  it('= exact static cost + every wire at the assumed activity, through the same wire factors', () => {
    for (const s of [starterSpec(), minimalSpec(), deepSpec()]) {
      const e = estimate(s);
      let wires = 0; for (const f of wireFactors(s)) wires += f * CONFIG.cost.estimateActivity;
      expect(e.total).toBeCloseTo(staticCost(s).total + wires, 12);
    }
    expect(estimate(starterSpec()).wires).toBeCloseTo(17 * 0.05, 12); // the mock-up's 0.05 per wire
    expect(Math.round(estimate(starterSpec()).total * 10)).toBe(63); // 63% of budget 10, as the mock-up shows
    expect(estimate(deepSpec()).total).toBeLessThan(CONFIG.budget[0]);
  });
});
