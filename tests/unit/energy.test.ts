import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/common/config';
import { compile, evalNet, starterSpec } from '../../src/common/sim/brain';
import { energyLeft, minutePercent, minutePool, noiseLevel, percentOfBudget, poolFor, runsOutAt, staticCost, wireFactor, wireFactors } from '../../src/common/sim/energy';
import { newRecording } from '../../src/common/sim/race';
import { Runner } from '../../src/common/sim/race';
import type { BrainSpec } from '../../src/common/sim/spec';
import { generateTrack } from '../../src/common/sim/track';
import { hashU } from '../../src/common/rng';

describe('energy maths', () => {
  it('Starter static cost = 5 eyes + road + speed + energy left + 2 tanh + 1 ReLU', () => {
    const s = staticCost(starterSpec());
    expect(s.sensors).toBeCloseTo(5 * 0.6 + 0.6 + 0.3 + 0.3, 12);
    expect(s.upkeep).toBeCloseTo(0.5 + 0.25 + 0.5, 12);
    expect(percentOfBudget(s.total, CONFIG.budget[0])).toBeCloseTo(54.5, 9);
  });
  it('skip surcharge: +50% per extra layer spanned', () => {
    expect(wireFactor(1)).toBeCloseTo(0.1, 15);
    expect(wireFactor(2)).toBeCloseTo(0.15, 15);
    expect(wireFactor(3)).toBeCloseTo(0.2, 15);
    expect(() => wireFactor(0)).toThrow();
  });
  it('per-tick use = static + Σ factor·|out·w| (hand-computed)', () => {
    // layers 3, line 2 empty: speed → n1 (span 1), n1 → wheel (span 2: line 3 only), bias → wheel (span 3)
    const spec: BrainSpec = {
      v: 1, layers: 3, nodes: [{ id: 'n1', layer: 1, act: 'tanh', dropout: 0 }, { id: 'n2', layer: 3, act: 'step', dropout: 0 }],
      conns: [{ from: 'i:spd', to: 'n1' }, { from: 'n1', to: 'o:fr' }, { from: 'i:bias', to: 'o:fl' }],
    };
    const net = compile({ spec, w: [2, -1.5, 0.5] });
    const inputs = new Float64Array(10); inputs[8] = 0.25; inputs[9] = 1;
    const vals = new Float64Array(net.nNodes);
    const used = evalNet(net, inputs, vals, 0, 0, 0);
    const h = Math.tanh(0.5);
    const expected = 0.3 + 0.5 + 0.2 + 0.1 * Math.abs(0.25 * 2) + 0.15 * Math.abs(h * -1.5) + 0.2 * Math.abs(1 * 0.5);
    expect(used).toBeCloseTo(expected, 13);
  });
  it('empty hidden lines are free to cross (review call 2026-10-30)', () => {
    const spec: BrainSpec = {
      v: 1, layers: 3, nodes: [{ id: 'n1', layer: 2, act: 'tanh', dropout: 0 }],
      conns: [{ from: 'i:f', to: 'n1' }, { from: 'n1', to: 'o:fl' }, { from: 'i:f', to: 'o:fr' }],
    };
    expect([...wireFactors(spec)].map((f) => Math.round(f * 1000))).toEqual([100, 100, 150]);
    // car → wheels with only the empty line on the board: span 1, no surcharge
    expect([...wireFactors({ v: 1, layers: 1, nodes: [], conns: [{ from: 'i:f', to: 'o:fl' }] })]).toEqual([0.1]);
  });
  it('overage → noise level a, and Energy left', () => {
    expect(noiseLevel(5, 10)).toBe(0);
    expect(noiseLevel(10, 10)).toBe(0);
    expect(noiseLevel(15, 10)).toBeCloseTo(0.5, 15);
    expect(noiseLevel(20, 10)).toBe(1);
    expect(noiseLevel(35, 10)).toBe(1);
    expect(energyLeft(0, 10)).toBe(1);
    expect(energyLeft(2.5, 10)).toBeCloseTo(0.75, 15);
    expect(energyLeft(14, 10)).toBe(0);
  });
  it('noise mixes after the transfer function: (1 − a)·clean + a·U(−1, 1)', () => {
    const spec: BrainSpec = { v: 1, layers: 1, nodes: [{ id: 'n1', layer: 1, act: 'sigmoid', dropout: 0 }],
      conns: [{ from: 'i:bias', to: 'n1' }, { from: 'n1', to: 'o:rl' }] };
    const net = compile({ spec, w: [0.8, 1] });
    const inputs = new Float64Array(10); inputs[9] = 1;
    const vals = new Float64Array(net.nNodes);
    const a = 0.3, seed = 1234, tick = 17;
    evalNet(net, inputs, vals, a, seed, tick);
    const u = (k: number) => 2 * hashU(seed, k, tick) - 1;
    const bias = 0.7 * 1 + a * u(9);
    const h = 0.7 * (1 / (1 + Math.exp(-0.8 * bias))) + a * u(101);
    const o = 0.7 * Math.max(-1, Math.min(1, h)) + a * u(12);
    expect(vals[9]).toBeCloseTo(bias, 14);
    expect(vals[10]).toBeCloseTo(h, 14);
    expect(vals[net.outStart + 2]).toBeCloseTo(o, 14);
    evalNet(net, inputs, vals, 1, seed, tick);
    expect(vals[net.outStart + 2]).toBeCloseTo(u(12), 14); // all noise at 200%
  });
  it('a brain far over budget drives on noise', () => {
    const spec = starterSpec();
    const net = compile({ spec, w: spec.conns.map(() => 4) });
    const r = new Runner(), t = generateTrack(3);
    const res = r.run(net, t, { ticks: 100, pool: 2 * 100, noiseSeed: 5, earlyStop: false });
    expect(res.ticks).toBe(100);
  });
  it('the budget is a pool for the run (ruling 2026-10-31): used accumulates, Energy left drains, noise only once spent', () => {
    const spec: BrainSpec = { v: 1, layers: 1, nodes: [], conns: [{ from: 'i:bias', to: 'o:fl' }, { from: 'i:energy', to: 'o:fr' }, { from: 'i:bias', to: 'o:rl' }] };
    const net = compile({ spec, w: [1, 0.5, 1] });
    const ticks = 200, rec = newRecording(net, ticks), t = generateTrack(3);
    const perTick = 0.3 + 0.1 * 1 + 0.1 * 1; // energy input wired (0.3) + two bias wires firing |1 × 1| (+ the energy wire, below)
    const pool = 0.5 * perTick * ticks; // spent about half way
    new Runner().run(net, t, { ticks, pool, noiseSeed: 8, earlyStop: false, record: rec });
    let sum = 0, spentAt = -1;
    for (let k = 0; k < ticks; k++) {
      const left = rec.act[k * net.nNodes + 7], bias = rec.act[k * net.nNodes + 9];
      const before = sum; // used up to the previous tick
      if (before < pool) {
        expect(left).toBeCloseTo(energyLeft(before, pool), 12); // drains as 1 − used / pool
        expect(bias).toBe(1); // no noise while the pool lasts
      } else if (spentAt < 0) spentAt = k;
      sum += rec.energy[k];
      expect(rec.used[k]).toBeCloseTo(sum, 9);
    }
    expect(spentAt).toBeGreaterThan(60);
    expect(spentAt).toBeLessThan(140);
    const k = ticks - 1; // spent: signals are noisy now, by a = used / pool − 1
    expect(rec.act[k * net.nNodes + 9]).not.toBe(1);
    expect(noiseLevel(rec.used[k - 1], pool)).toBeGreaterThan(0);
  });
  it('pools are prorated by run length; the workbench shows the per-minute estimate', () => {
    expect(minutePool()).toBe(CONFIG.budget[0] * 1200);
    expect(poolFor(400)).toBe(minutePool() / 3); // a 20 s training episode
    expect(poolFor(600)).toBe(minutePool() / 2); // the 30 s race
    expect(minutePercent(6.3)).toBeCloseTo(63, 9); // Starter-like: 6.3 per tick → 63% of the minute
    expect(runsOutAt(6.3)).toBe(Infinity);
    expect(runsOutAt(12.5)).toBeCloseTo(48, 9); // 125%: the pool is spent at 0:48
  });
});
