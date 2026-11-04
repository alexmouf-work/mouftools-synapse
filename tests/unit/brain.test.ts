import { describe, expect, it } from 'vitest';
import { ACTS, CONFIG, type Act } from '../../src/common/config';
import { ACT_CODE, compile, evalNet, nodeRate, rateOf, restRate, transfer } from '../../src/common/sim/brain';
import { biasCount, biasIndex, columns, defaultSpec, inputIds, paramCount, validateSpec, wireCount, wireList, type BrainSpec } from '../../src/common/sim/spec';

const sig = (x: number) => 1 / (1 + Math.exp(-x));
const F: Record<Act, (x: number) => number> = {
  linear: (x) => Math.min(Math.max(x, -1), 1),
  relu: (x) => Math.min(Math.max(x, 0), 4),
  sigmoid: sig,
  tanh: Math.tanh,
};
const RATE: Record<Act, (y: number) => number> = { linear: (y) => (y + 1) / 2, relu: (y) => Math.min(1, y), sigmoid: (y) => y, tanh: (y) => (y + 1) / 2 };
const E = CONFIG.energy;

/**
 * One speed cell → one neuron (fn) → the four wheels (tanh). Parameters: wires speed→h, then h→FL, FR, RL, RR; then
 * the biases of h, FL, FR, RL, RR (z = b + Σ w·x).
 */
const oneNeuron = (fn: Act): BrainSpec => ({ v: 2, senses: { boundary: 0, landmark: 0, hd: 0, grid: 0, speed: 1 }, layers: [{ n: 1, fn }] });

describe('brain v2: outputs, rates and the energy load, hand-computed for every function', () => {
  for (const fn of ACTS) {
    it(fn, () => {
      for (const [w0, w1, w2, w3, w4, spd, bh, bo] of [[0.7, 0.5, -1, 2, 0, 0.4, 0, 0], [-3, 2, 1, -0.5, 4, 0.9, 0.3, -0.2], [4, -4, 0.2, 0.3, -0.1, 1, -1.5, 0.6]]) {
        const bw = [bo, -bo, 2 * bo, 0];
        const net = compile({ spec: oneNeuron(fn), w: [w0, w1, w2, w3, w4, bh, ...bw] });
        const vals = new Float64Array(net.nNodes);
        const load = evalNet(net, [spd], vals);
        const h = F[fn](bh + w0 * spd);
        expect(vals[1]).toBeCloseTo(h, 14);
        const outs = [w1, w2, w3, w4].map((w, k) => Math.tanh(bw[k] + w * h));
        outs.forEach((y, k) => expect(vals[net.outStart + k]).toBeCloseTo(y, 14));
        // load = Σ (own cost + wires driven × wire cost) × rate
        const hand = (E.sense.speed + 1 * E.wire) * spd + (E.neuron[fn] + 4 * E.wire) * Math.max(0, Math.min(1, RATE[fn](h)))
          + outs.reduce((a, y) => a + E.wheel * (y + 1) / 2, 0);
        expect(load).toBeCloseTo(hand, 12);
      }
    });
  }
  it('rates: tanh and linear map −1..1 to 0..1, ReLU saturates at 1, sigmoid is its own; resting rates', () => {
    expect(rateOf(ACT_CODE.tanh, -1)).toBe(0); expect(rateOf(ACT_CODE.tanh, 1)).toBe(1);
    expect(rateOf(ACT_CODE.relu, 3)).toBe(1); expect(rateOf(ACT_CODE.relu, 0)).toBe(0);
    expect(rateOf(ACT_CODE.sigmoid, 0.3)).toBe(0.3);
    expect(restRate('relu')).toBe(0); expect(restRate('tanh')).toBe(0.5); expect(restRate('sigmoid')).toBe(0.5); expect(restRate('linear')).toBe(0.5);
  });
  it('ReLU caps at 4; linear stays within −1..1', () => {
    expect(transfer(ACT_CODE.relu, 9)).toBe(4);
    expect(transfer(ACT_CODE.linear, 2.5)).toBe(1);
    expect(transfer(ACT_CODE.linear, -7)).toBe(-1);
  });
  it('head-direction cells fire at (cos + 1) / 2', () => {
    const net = compile({ spec: { v: 2, senses: { boundary: 0, landmark: 0, hd: 1, grid: 0, speed: 0 }, layers: [{ n: 1, fn: 'tanh' }] }, w: new Array(10).fill(0) });
    expect(nodeRate(net, 0, -1)).toBe(0); expect(nodeRate(net, 0, 1)).toBe(1);
  });
});

describe('brain v2: shape', () => {
  it('the default brain: one boundary cell, one head-direction cell, three tanh neurons, the wheels; fully wired', () => {
    const s = defaultSpec();
    validateSpec(s);
    expect(inputIds(s)).toEqual(['i:boundary:0', 'i:hd:0']);
    expect(columns(s).map((c) => c.length)).toEqual([2, 3, 4]);
    expect(wireCount(s)).toBe(2 * 3 + 3 * 4);
    expect(biasCount(s)).toBe(3 + 4);
    expect(paramCount(s)).toBe(18 + 7);
    expect(biasIndex(s, 'h0:0')).toBe(18); expect(biasIndex(s, 'o:fl')).toBe(21); expect(biasIndex(s, 'o:rr')).toBe(24);
    expect(() => biasIndex(s, 'i:hd:0')).toThrow();
    expect(wireList(s).slice(0, 4)).toEqual([['i:boundary:0', 'h0:0'], ['i:boundary:0', 'h0:1'], ['i:boundary:0', 'h0:2'], ['i:hd:0', 'h0:0']]);
    expect(compile({ spec: s, w: new Array(25).fill(0) }).ids).toEqual(['i:boundary:0', 'i:hd:0', 'h0:0', 'h0:1', 'h0:2', 'o:fl', 'o:fr', 'o:rl', 'o:rr']);
  });
  const bad: [string, (s: BrainSpec) => void][] = [
    ['another version', (s) => { (s as { v: number }).v = 1; }],
    ['eight boundary cells', (s) => { s.senses.boundary = 8; }],
    ['two speed cells', (s) => { s.senses.speed = 2; }],
    ['an unknown sense', (s) => { (s.senses as Record<string, number>).eye = 1; }],
    ['no hidden layer', (s) => { s.layers = []; }],
    ['nine layers', (s) => { s.layers = Array.from({ length: 9 }, () => ({ n: 1, fn: 'tanh' as const })); }],
    ['nine in a layer', (s) => { s.layers[0].n = 9; }],
    ['an empty layer', (s) => { s.layers[0].n = 0; }],
    ['step (no longer offered)', (s) => { (s.layers[0] as { fn: string }).fn = 'step'; }],
  ];
  for (const [name, edit] of bad) it(`rejects ${name}`, () => { const s = defaultSpec(); edit(s); expect(() => validateSpec(s)).toThrow(); });
  it('rejects weights out of range or misaligned', () => {
    const s = defaultSpec();
    expect(() => compile({ spec: s, w: [1, 2] })).toThrow();
    expect(() => compile({ spec: s, w: new Array(18).fill(0) })).toThrow(); // weights but no biases
    expect(() => compile({ spec: s, w: new Array(25).fill(4.5) })).toThrow();
    expect(() => compile({ spec: s, w: new Array(25).fill(NaN) })).toThrow();
  });
});
