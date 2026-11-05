// Actor-critic (T2) and A_RP (T3): each kernel's tick against a hand-built step, each trainer's update rule, the
// temperature, the learned fields, and lanes split across workers.
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/common/config';
import { tanh } from '../../src/common/fmath';
import { derive, hashU, TAG } from '../../src/common/rng';
import { compile, evalNet } from '../../src/common/sim/brain';
import { startCar } from '../../src/common/sim/car';
import { fieldGrads } from '../../src/common/sim/fieldgrad';
import { Runner } from '../../src/common/sim/race';
import { readSensors } from '../../src/common/sim/sensors';
import { defaultSpec, fieldIndex, paramCount, type BrainSpec } from '../../src/common/sim/spec';
import { gauss, criticSize } from '../../src/common/train/acKernel';
import { ActorCritic } from '../../src/common/train/actorCritic';
import { Arp } from '../../src/common/train/arp';
import { EpisodeCore, InlineExecutor } from '../../src/common/train/episodes';
import { backward, preActivations } from '../../src/common/train/grad';
import { phaseSeeds, runPhase } from '../../src/common/train/phase';
import { fresh } from '../../src/common/train/rollout';
import { trainerRefusal } from '../../src/common/train/trainer';

// the default brain plus a speed cell, with fixed weights (the wheels' biases push forward so the car moves)
const s = phaseSeeds(11), spec: BrainSpec = { ...defaultSpec(), senses: { ...defaultSpec().senses, speed: 1 } };
const setup = { spec, trackSeeds: s.trainTracks, episodeTicks: CONFIG.train.episodeTicks };
const nP = paramCount(spec);
const w = Float64Array.from({ length: nP }, (_, k) => ((k * 7) % 5 - 2) / 4);
/** Lane 0's first episode: track 0, at the place hashU draws, at rest; its noise seed. */
function laneStart(core: EpisodeCore, seed: number) {
  const t = core.tracks[0];
  return { t, c: startCar(t, (t.startIdx + Math.floor(hashU(seed, 0, 0) * t.n)) % t.n), noise: derive(seed, TAG.trainNoise, 0, 1) };
}
/** One brain tick by hand: inputs, node values, pre-activations. */
function think(net: ReturnType<typeof compile>, c: ReturnType<typeof startCar>, t: EpisodeCore['tracks'][0]) {
  const inputs = new Float64Array(net.nIn), vals = new Float64Array(net.nNodes), z = new Float64Array(net.nNodes);
  readSensors(c, t, net, inputs);
  evalNet(net, inputs, vals);
  preActivations(net, vals, z);
  return { vals, z };
}

describe('actor-critic (T2)', () => {
  const A = CONFIG.train.ac;
  it('two ticks of a lane give exactly δ·∂log π/∂w and δ·φ for the first transition, by hand', () => {
    const core = new EpisodeCore(setup);
    const net = compile({ spec, w: Array.from(w) }), nC = criticSize(net);
    const v = Array.from({ length: nC }, (_, j) => (j % 3) * 0.2 - 0.1);
    const sigma = 0.3, gamma = 0.9, lambda = 0.5;
    const [out] = core.rollout({ kernel: 'actorCritic', seed: 3, w, params: [sigma, gamma, lambda, ...v], ticks: 2, lanes: fresh(1) });
    const { t, c, noise } = laneStart(core, 3);
    // tick 0: the critic's view, the policy's score at the action it drew, the action, the reward
    const phi = (vals: Float64Array) => [1, ...Array.from(vals.subarray(0, net.outStart)), c.v / CONFIG.car.wheelSpeed];
    const V = (f: number[]) => f.reduce((a, x, j) => a + x * v[j], 0);
    const { vals, z } = think(net, c, t);
    const phi0 = phi(vals), V0 = V(phi0);
    const eps = [0, 1, 2, 3].map((k) => gauss(noise, 0, 2 * k));
    const g0 = new Float64Array(nP), delta = new Float64Array(net.nNodes);
    backward(net, vals, z, eps.map((e) => e / sigma), delta, g0);
    fieldGrads(net, c, t, delta, g0);
    const p0 = c.prog, w0 = c.wallTicks;
    new Runner().tick(net, t, c, undefined, (vv, o) => { for (let k = 0; k < 4; k++) vv[o + k] = Math.max(-1, Math.min(1, vv[o + k] + sigma * eps[k])); });
    const r0 = c.prog - p0 - CONFIG.train.wallPenalty * (c.wallTicks - w0);
    // tick 1 settles it: δ = r + γ·V(s′) − V(s); the trace then is ∂log π(a₀|s₀)/∂w and φ(s₀)
    const V1 = V(phi(think(net, c, t).vals));
    const d0 = r0 + gamma * V1 - V0;
    const hand = [...Array.from(g0, (x) => d0 * x), ...phi0.map((x) => d0 * x)];
    expect(out.grad.length).toBe(nP + nC);
    for (let i = 0; i < hand.length; i++) expect(out.grad[i]).toBeCloseTo(hand[i], 12);
    expect(g0.some((x) => x !== 0)).toBe(true);
    expect(out.stats[1]).toBe(1); // the second transition is still open when the round ends
    expect(out.stats[0]).toBeCloseTo(d0 * d0, 12);
  });

  it('the update is Δw = α · Σ δ·e / n for the actor and Δv = β · Σ δ·e_v / n for the critic', async () => {
    const ac = new ActorCritic({ start: 'fresh' });
    const exec = new InlineExecutor();
    await exec.setup(setup);
    const { MeteredEnv } = await import('../../src/common/train/env');
    ac.init({ spec, w: Array.from(w) }, 1, new MeteredEnv(setup, exec, 1e6));
    const nC = ac.v.length;
    const sum = Float64Array.from({ length: nP + nC }, (_, i) => (i % 4) - 1.5), stats = Float64Array.from([2, 4, 0.8, 1.2]);
    const dw = (ac as unknown as { update(a: Float64Array, b: Float64Array): Float64Array }).update(sum, stats);
    for (let i = 0; i < nP; i++) expect(dw[i]).toBe((A.alpha * sum[i]) / 4);
    for (let j = 0; j < nC; j++) expect(ac.v[j]).toBe((A.beta * sum[nP + j]) / 4);
    expect(ac.tdErr).toBe(0.5);
  });

  it('temperature scales σ, and σ falls over the phase', async () => {
    const exec = new InlineExecutor();
    await exec.setup(setup);
    const { MeteredEnv } = await import('../../src/common/train/env');
    const at = (t: number) => { const a = new ActorCritic({ start: 'fresh', temperature: t }); a.init({ spec, w: Array.from(w) }, 1, new MeteredEnv(setup, exec, 1e6)); return a.sigma(); };
    expect(at(0)).toBe(A.sigma);
    expect(at(1)).toBe(2 * A.sigma);
    expect(at(-2)).toBe(A.sigma / 4);
    expect(A.sigmaEnd).toBeLessThan(A.sigma);
  });
});

describe('A_RP (T3)', () => {
  const R = CONFIG.train.arp;
  it('y − E[y] is ∂log P(y)/∂z for a ±1 unit with E[y] = tanh z (so A_RP needs no slope at the wheels)', () => {
    for (const zz of [-1.3, -0.2, 0, 0.7, 2]) for (const y of [1, -1]) {
      const lp = (q: number) => Math.log((1 + y * Math.tanh(q)) / 2), h = 1e-6;
      expect((lp(zz + h) - lp(zz - h)) / (2 * h)).toBeCloseTo(y - Math.tanh(zz), 6);
    }
  });

  it('one tick of a lane gives exactly ρ-free Σ δ·x with δ = y − E[y] on reward, λ(−y − E[y]) on penalty, by hand', () => {
    const core = new EpisodeCore(setup);
    const net = compile({ spec, w: Array.from(w) });
    const sN = 0.75, lam = 0.2;
    const [out] = core.rollout({ kernel: 'arp', seed: 5, w, params: [sN, lam], ticks: 1, lanes: fresh(1) });
    const { t, c, noise } = laneStart(core, 5);
    const seen = { ...c };
    const { vals, z } = think(net, c, t);
    const E = [0, 1, 2, 3].map((k) => vals[net.outStart + k]);
    const Y = E.map((e, k) => (hashU(noise, 0, k) < (1 + e) / 2 ? 1 : -1));
    expect(E.every((e, k) => Math.abs(e - tanh(z[net.outStart + k])) < 1e-15)).toBe(true);
    const p0 = c.prog, w0 = c.wallTicks;
    new Runner().tick(net, t, c, undefined, (vv, o) => { for (let k = 0; k < 4; k++) vv[o + k] = Math.max(-1, Math.min(1, E[k] + sN * (Y[k] - E[k]))); });
    const reward = c.prog > p0 && c.wallTicks === w0;
    const grad = new Float64Array(nP), delta = new Float64Array(net.nNodes);
    backward(net, vals, z, E.map((e, k) => (reward ? Y[k] - e : lam * (-Y[k] - e))), delta, grad, 1, true);
    fieldGrads(net, seen, t, delta, grad);
    expect(Array.from(out.grad)).toEqual(Array.from(grad));
    expect(grad.some((x) => x !== 0)).toBe(true);
    expect(Array.from(out.stats)).toEqual([reward ? 1 : 0, 1]);
    // the wheels' error is at z: a wheel's bias term is exactly its δ
    for (let k = 0; k < 4; k++) expect(grad[net.wires + net.outStart - net.nIn + k]).toBe(reward ? Y[k] - E[k] : lam * (-Y[k] - E[k]));
  });

  it('the update is Δw = ρ · Σ δ·x / n; temperature scales the firing randomness', () => {
    const a = new Arp({ start: 'fresh' });
    const sum = Float64Array.from([1.2, -0.4, 0, 3]), stats = Float64Array.from([3, 4]);
    const dw = (a as unknown as { update(x: Float64Array, y: Float64Array): Float64Array }).update(sum, stats);
    expect(Array.from(dw)).toEqual([R.lr * 1.2 / 4, R.lr * -0.4 / 4, 0, R.lr * 3 / 4].map((x) => x));
    expect(a.rewardRate).toBe(0.75);
    expect(new Arp({ start: 'fresh', temperature: 1 }).noise()).toBe(2 * R.noise);
    expect(new Arp({ start: 'fresh', temperature: -1 }).noise()).toBe(R.noise / 2);
  });
});

describe('both', () => {
  for (const kernel of ['actorCritic', 'arp'] as const) {
    it(`${kernel}: lanes give the same bits however they are split`, () => {
      const core = new EpisodeCore(setup);
      const params = kernel === 'arp' ? [0.75, 0.2] : [0.3, 0.98, 0.9, ...new Array(criticSize(compile({ spec, w: Array.from(w) }))).fill(0.05)];
      const job = { kernel, seed: 9, w, params, ticks: 300, lanes: fresh(6) };
      const all = core.rollout(job);
      const parts = [core.rollout({ ...job, lanes: job.lanes.slice(0, 2) }), new EpisodeCore(setup).rollout({ ...job, lanes: job.lanes.slice(2) })].flat();
      expect(parts.map((o) => Array.from(o.grad))).toEqual(all.map((o) => Array.from(o.grad)));
      expect(parts.map((o) => o.lane)).toEqual(all.map((o) => o.lane));
    });
  }

  for (const id of ['ac', 'arp']) {
    it(`${id}: temperature is a run input (×2 changes the result and repeats exactly)`, async () => {
      const o = { T: 400_000, trainer: id };
      const cool = await runPhase(new InlineExecutor(), defaultSpec(), 5, o);
      const hot = await runPhase(new InlineExecutor(), defaultSpec(), 5, { ...o, temperature: 1 });
      const again = await runPhase(new InlineExecutor(), defaultSpec(), 5, { ...o, temperature: 1 });
      expect(hot.hash).not.toBe(cool.hash);
      expect(again.hash).toBe(hot.hash);
    }, 120_000);

    it(`${id}: learns the cells' fields where they have a gradient (head direction), not a boundary cell's direction`, async () => {
      const r = await runPhase(new InlineExecutor(), defaultSpec(), 4, { T: 400_000, trainer: id });
      const g = r.final, hd = fieldIndex(g.spec, 'i:hd:0'), b = fieldIndex(g.spec, 'i:boundary:0');
      expect(g.w[hd]).not.toBe(0);
      expect(g.w[b]).toBe(0); // direction: no gradient (its rays decide which wall they hit, not how strongly)
      expect(g.w[b + 1]).toBe(0); // width: likewise
    }, 120_000);
  }

  it('neither refuses any function on any layer', () => {
    for (const fn of ['linear', 'relu', 'sigmoid', 'tanh'] as const) {
      const sp: BrainSpec = { ...defaultSpec(), layers: [{ n: 3, fn }, { n: 2, fn }] };
      expect(trainerRefusal('ac', sp)).toBeNull();
      expect(trainerRefusal('arp', sp)).toBeNull();
    }
  });
});
