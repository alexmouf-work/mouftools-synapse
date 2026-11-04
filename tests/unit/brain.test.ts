import { describe, expect, it } from 'vitest';
import { ACTS, type Act } from '../../src/common/config';
import { compile, evalNet, minimalSpec, starterSpec, transfer } from '../../src/common/sim/brain';
import { validateSpec, type BrainSpec } from '../../src/common/sim/spec';

const sig = (x: number) => 1 / (1 + Math.exp(-x));
const EXPECT: Record<Act, (x: number) => number> = {
  linear: (x) => Math.min(Math.max(x, -1), 1),
  step: (x) => (x > 0 ? 1 : 0),
  relu: (x) => Math.min(Math.max(x, 0), 4),
  sigmoid: sig,
  tanh: Math.tanh,
};

/** bias → n1 (act) → front-left wheel, plus speed → n1. */
function oneNeuron(act: Act): BrainSpec {
  return {
    v: 1, layers: 1, nodes: [{ id: 'n1', layer: 1, act, dropout: 0 }],
    conns: [{ from: 'i:bias', to: 'n1' }, { from: 'i:spd', to: 'n1' }, { from: 'n1', to: 'o:fl' }],
  };
}

describe('brain outputs, hand-computed, for every transfer function', () => {
  for (const act of ACTS) {
    it(act, () => {
      for (const [wb, ws, spd, wo] of [[0.7, 0.5, 0.4, 1.5], [-0.3, 2, -0.2, -0.8], [3, 2, 0.9, 0.25], [0, 0, 0.5, 1]]) {
        const net = compile({ spec: oneNeuron(act), w: [wb, ws, wo] });
        const inputs = new Float64Array(10); inputs[9] = 1; inputs[8] = spd;
        const vals = new Float64Array(net.nNodes);
        evalNet(net, inputs, vals, 0, 0, 0);
        const h = EXPECT[act](wb * 1 + ws * spd);
        expect(vals[10]).toBeCloseTo(h, 14);
        expect(vals[net.outStart]).toBeCloseTo(Math.max(-1, Math.min(1, wo * h)), 14);
        expect(vals[net.outStart + 1]).toBe(0); // unwired wheel
      }
    });
  }
  it('ReLU caps at 4; wheels clamp to −1..1; step is 0 at exactly 0', () => {
    expect(transfer(1, 9)).toBe(4);
    expect(transfer(1, -2)).toBe(0);
    expect(transfer(4, 2.5)).toBe(1);
    expect(transfer(4, -7)).toBe(-1);
    expect(transfer(0, 0)).toBe(0);
  });
});

describe('spec validation', () => {
  const base = (): BrainSpec => ({
    v: 1, layers: 2,
    nodes: [{ id: 'n1', layer: 1, act: 'tanh', dropout: 0 }, { id: 'n2', layer: 2, act: 'relu', dropout: 0 }],
    conns: [{ from: 'i:f', to: 'n1' }, { from: 'n1', to: 'n2' }, { from: 'n2', to: 'o:fl' }],
  });
  it('accepts presets and a two-layer net', () => {
    validateSpec(starterSpec()); validateSpec(minimalSpec()); validateSpec(base());
    expect(starterSpec().conns.length).toBe(17);
    expect(minimalSpec().conns.length).toBe(16);
  });
  const bad: [string, (s: BrainSpec) => void][] = [
    ['backward wire', (s) => s.conns.push({ from: 'n2', to: 'n1' })],
    ['same-layer wire', (s) => { s.nodes.push({ id: 'n3', layer: 1, act: 'tanh', dropout: 0 }); s.conns.push({ from: 'n1', to: 'n3' }); }],
    ['wire into the car', (s) => s.conns.push({ from: 'n1', to: 'i:f' })],
    ['wire out of a wheel', (s) => s.conns.push({ from: 'o:fl', to: 'n2' })],
    ['duplicate wire', (s) => s.conns.push({ from: 'i:f', to: 'n1' })],
    ['dropout', (s) => { s.nodes[0].dropout = 0.1; }],
    ['four layers', (s) => { s.layers = 4; }],
    ['unknown act', (s) => { (s.nodes[0] as { act: string }).act = 'gelu'; }],
    ['eleven in a layer', (s) => { for (let k = 3; k <= 12; k++) s.nodes.push({ id: `n${k}`, layer: 1, act: 'step', dropout: 0 }); }],
    ['neuron on a missing layer', (s) => { s.nodes[1].layer = 3; }],
  ];
  for (const [name, edit] of bad) it(`rejects ${name}`, () => { const s = base(); edit(s); expect(() => validateSpec(s)).toThrow(); });
  it('rejects weights out of range or misaligned', () => {
    expect(() => compile({ spec: base(), w: [1, 2] })).toThrow();
    expect(() => compile({ spec: base(), w: [1, 2, 4.5] })).toThrow();
    expect(() => compile({ spec: base(), w: [1, 2, NaN] })).toThrow();
  });
});
