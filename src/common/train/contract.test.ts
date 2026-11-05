// The trainer contract (contract.suite.ts) for evolution and backprop, and the metered env.
import { describe, expect, it } from 'vitest';
import { paramCount, defaultSpec } from '../sim/spec';
import { contractSuite, makeEnv } from './contract.suite';
import { trainerIds } from './trainer';
import './neuroevo';
import './backprop';
import './actorCritic';
import './arp';

const nW = paramCount(defaultSpec());

contractSuite(['evolution', 'backprop']);

describe('the contract covers every registered trainer', () => {
  it('evolution and backprop here, actor-critic and A_RP in contract-rl.test.ts', () => {
    expect([...trainerIds()].sort((a, b) => (a < b ? -1 : 1))).toEqual(['ac', 'arp', 'backprop', 'evolution']);
  });
});

describe('metered env', () => {
  it('throws on a request that could overrun, before running it', async () => {
    const env = await makeEnv(2, 1000);
    // 2 policies × 2 tracks × 400 ticks = 1600 > 1000
    await expect(env.runEpisodes([new Float64Array(nW), new Float64Array(nW)])).rejects.toThrow(/overruns/);
    expect(env.used).toBe(0);
  });
  it('openCar meters one tick per step and applies exploration noise to the wheels', async () => {
    const env = await makeEnv(2, 3);
    const car = env.openCar(new Float64Array(nW), 0);
    car.step([1, 1, 1, 1]);
    expect(car.state.v).toBeGreaterThan(0); // zero brain, but the noise pushed every wheel forward
    car.step(); car.step();
    expect(env.used).toBe(3);
    expect(() => car.step()).toThrow(/overruns/);
  });
});
