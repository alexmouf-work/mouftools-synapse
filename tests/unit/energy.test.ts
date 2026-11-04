import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/common/config';
import { restRate } from '../../src/common/sim/brain';
import { startCar, stepPhysics } from '../../src/common/sim/car';
import { cellMax, energyRefusal, layerMax, maxLoad, restLoad, senseMax, speedCap } from '../../src/common/sim/energy';
import { defaultSpec, type BrainSpec } from '../../src/common/sim/spec';
import { generateTrack } from '../../src/common/sim/track';

const E = CONFIG.energy;
const big = (): BrainSpec => ({ v: 2, senses: { boundary: 7, landmark: 5, hd: 8, grid: 6, speed: 1 }, layers: Array.from({ length: 8 }, () => ({ n: 8, fn: 'sigmoid' as const })) });

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
  it('the cap slows the wheels: half the speed share, half the speed', () => {
    const t = generateTrack(3), a = startCar(t), b = startCar(t);
    for (let k = 0; k < 60; k++) { stepPhysics(a, t, 0.5, 0.5, 0.5, 0.5, 1); stepPhysics(b, t, 0.5, 0.5, 0.5, 0.5, 0.5); }
    expect(a.v).toBeCloseTo(30, 6);
    expect(b.v).toBeCloseTo(15, 6);
  });
  it('the sandbox refuses nothing; vs CPU and Multiplayer refuse a design past 100% flat out', () => {
    expect(maxLoad(big())).toBeGreaterThan(100);
    expect(energyRefusal(big(), 'sandbox')).toBeNull();
    expect(energyRefusal(big(), 'match')).toMatch(/races allow 100%/);
    expect(energyRefusal(defaultSpec(), 'match')).toBeNull();
  });
  it('"At maximum firing rate": a cell counts its own cost plus the wires it drives', () => {
    const s = defaultSpec();
    expect(senseMax(s, 'boundary')).toBeCloseTo(E.sense.boundary + 3 * E.wire, 12);
    expect(cellMax(s, 1)).toBeCloseTo(E.neuron.tanh + 4 * E.wire, 12);
    expect(cellMax(s, 2)).toBeCloseTo(E.wheel, 12);
    expect(layerMax(s, 0)).toBeCloseTo(3 * (E.neuron.tanh + 4 * E.wire), 12);
  });
});
