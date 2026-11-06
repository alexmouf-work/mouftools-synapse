import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/common/config';
import { compile, evalNet, nodeRate, restRate, zeroGenome } from '../../src/common/sim/brain';
import { speedAct } from '../../src/common/sim/senses';
import { startCar, stepPhysics } from '../../src/common/sim/car';
import { cellMax, energyRefusal, layerMax, maxLoad, restLoad, roundPower, SANDBOX_POWER, senseMax, speedCap } from '../../src/common/sim/energy';
import { defaultSpec, starterSpec, type BrainSpec } from '../../src/common/sim/spec';
import { generateTrack } from '../../src/common/sim/track';

const E = CONFIG.energy;
const big = (): BrainSpec => ({ v: 2, senses: { boundary: 7, far: 5, hd: 8, grid: 6, speed: 1 }, layers: Array.from({ length: 8 }, () => ({ n: 8, fn: 'sigmoid' as const })) });

describe('energy (brain v2: speed follows firing)', () => {
  it('the default brain flat out: every cost plus every wire (hand-computed)', () => {
    const s = defaultSpec();
    const hand = (E.sense.boundary + 3 * E.wire) + (E.sense.hd + 3 * E.wire) + 3 * (E.neuron.tanh + 4 * E.wire) + 4 * E.wheel;
    expect(maxLoad(s)).toBeCloseTo(hand, 12);
    expect(maxLoad(s)).toBeCloseTo(11.35, 12);
  });
  it('at rest: senses silent, tanh neurons and wheels at half rate', () => {
    const s = defaultSpec();
    expect(restLoad(s, restRate)).toBeCloseTo(3 * (E.neuron.tanh + 4 * E.wire) * 0.5 + 4 * E.wheel * 0.5, 12);
  });
  it('speed gets what is left, never below the floor', () => {
    expect(speedCap(0)).toBe(1);
    expect(speedCap(30)).toBeCloseTo(0.7, 12);
    expect(speedCap(95)).toBe(E.speedFloor / 100);
    expect(speedCap(400)).toBe(E.speedFloor / 100);
  });
  it('round power (2026-11-06): cap = max(floor, (P − load) / P_ref), P_ref = round 3\'s power; the sandbox unchanged', () => {
    const B = CONFIG.rounds.budgets, ref = B[B.length - 1];
    expect(B.map((_, r) => roundPower(r + 1))).toEqual([20, 40, 64]);
    for (const load of [0, 3.7, 11.35, 30, 95, 400]) expect(speedCap(load, SANDBOX_POWER)).toBe(speedCap(load)); // the sandbox: P = P_ref = 100
    expect(speedCap(0, roundPower(1))).toBeCloseTo(20 / ref, 12); // round 1: about a third of full speed, even weightless
    expect(speedCap(10, roundPower(2))).toBeCloseTo(30 / ref, 12);
    expect(speedCap(0, roundPower(3))).toBe(1);
    expect(speedCap(19, roundPower(1))).toBe(E.speedFloor / 100); // the floor: 10% of full speed
    expect(speedCap(5, roundPower(1))).toBeLessThan(speedCap(5, roundPower(2))); // faster as the rounds go …
    expect(speedCap(20, roundPower(3))).toBeLessThan(speedCap(5, roundPower(3))); // … and a heavy brain costs speed
    const net = compile(zeroGenome(defaultSpec()), roundPower(1));
    expect(net.power).toBe(20);
    expect(compile(zeroGenome(defaultSpec())).power).toBe(SANDBOX_POWER);
  });
  it('the cap slows the wheels: half the speed share, half the speed', () => {
    const t = generateTrack(3), a = startCar(t), b = startCar(t);
    for (let k = 0; k < 60; k++) { stepPhysics(a, t, 0.5, 0.5, 0.5, 0.5, 1); stepPhysics(b, t, 0.5, 0.5, 0.5, 0.5, 0.5); }
    expect(a.v).toBeCloseTo(30, 6);
    expect(b.v).toBeCloseTo(15, 6);
  });
  it('the sandbox refuses nothing; Multiplayer refuses a design past 100% flat out', () => {
    expect(maxLoad(big())).toBeGreaterThan(100);
    expect(energyRefusal(big(), 'sandbox')).toBeNull();
    expect(energyRefusal(big(), 'match')).toMatch(/races allow 100%/);
    expect(energyRefusal(defaultSpec(), 'match')).toBeNull();
  });
  it('vs CPU rounds (rounds plan §2): 4 wall cells + 5 tanh (9 cells) just fit round 1; 11 such cells don\'t; ×1 ×2 ×3.2 (match polish §1: three rounds)', () => {
    const R = CONFIG.rounds.budgets, sp = (b: number, n: number): BrainSpec => ({ v: 2, senses: { boundary: b, far: 0, hd: 0, grid: 0, speed: 0 }, layers: [{ n, fn: 'tanh' }] });
    expect(maxLoad(sp(4, 5))).toBeCloseTo(19.5, 9);
    expect(energyRefusal(sp(4, 5), R[0])).toBeNull();
    for (const [b, n] of [[5, 6], [4, 7], [6, 5]]) expect(energyRefusal(sp(b, n), R[0])).toBe(`This design needs ${Math.round((maxLoad(sp(b, n)) / R[0]) * 100)}% of round 1's power.`);
    expect(R.map((x) => x / R[0])).toEqual([1, 2, 3.2]);
    expect(energyRefusal(defaultSpec(), R[0])).toBeNull(); // the starting brain fits round 1
  });
  it('the signed speed cell (ruling 2026-11-05): negative going backwards, mirrored, and it costs its size either way', () => {
    const top = CONFIG.car.wheelSpeed;
    expect(speedAct(top / 2)).toBeCloseTo(0.5, 12);
    expect(speedAct(-top / 2)).toBeCloseTo(-0.5, 12);
    expect(speedAct(-2 * top)).toBe(-1);
    expect(speedAct(2 * top)).toBe(1);
    const s: BrainSpec = { v: 2, senses: { boundary: 0, far: 0, hd: 0, grid: 0, speed: 1 }, layers: [{ n: 1, fn: 'linear' }] }, net = compile(zeroGenome(s));
    expect(nodeRate(net, 0, -0.5)).toBe(0.5);
    const out = new Float64Array(net.nNodes);
    expect(evalNet(net, [-0.5], out)).toBeCloseTo(evalNet(net, [0.5], out), 12);
  });
  it('"At maximum firing rate": a cell counts its own cost plus the wires it drives', () => {
    const s = defaultSpec();
    expect(senseMax(s, 'boundary')).toBeCloseTo(E.sense.boundary + 3 * E.wire, 12);
    expect(cellMax(s, 1)).toBeCloseTo(E.neuron.tanh + 4 * E.wire, 12);
    expect(cellMax(s, 2)).toBeCloseTo(E.wheel, 12);
    expect(layerMax(s, 0)).toBeCloseTo(3 * (E.neuron.tanh + 4 * E.wire), 12);
  });
});

describe('a match\'s first brain', () => {
  it('every random starter of 2000 seeds fits round 1\'s budget (matches start on one; tracks-v2 plan)', () => {
    let worst = 0;
    for (let seed = 1; seed <= 2000; seed++) {
      const sp = starterSpec(seed);
      worst = Math.max(worst, maxLoad(sp));
      expect(energyRefusal(sp, CONFIG.rounds.budgets[0])).toBeNull();
    }
    expect(worst).toBeLessThanOrEqual(CONFIG.rounds.budgets[0]);
  });
});
