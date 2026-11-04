import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/common/config';
import { compile, evalNet, starterSpec } from '../../src/common/sim/brain';
import { startCar } from '../../src/common/sim/car';
import type { BrainSpec } from '../../src/common/sim/spec';
import { driveTeacher, teacherWheels } from '../../src/common/sim/teacher';
import { generateTrack } from '../../src/common/sim/track';
import { Backprop } from '../../src/common/train/backprop';
import { EpisodeCore } from '../../src/common/train/episodes';
import { backward, preActivations, wheelSlope } from '../../src/common/train/grad';
import { phaseSeeds } from '../../src/common/train/phase';
import { fresh } from '../../src/common/train/rollout';
import { hashU } from '../../src/common/rng';
import { readSensors } from '../../src/common/sim/sensors';
import { trainerRefusal } from '../../src/common/train/trainer';

/** bias → n1, speed → n1, n1 → FL wheel, speed → FL wheel. */
const tiny = (act: 'tanh' | 'sigmoid' | 'relu' | 'linear'): BrainSpec => ({
  v: 1, layers: 1, nodes: [{ id: 'n1', layer: 1, act, dropout: 0 }],
  conns: [{ from: 'i:bias', to: 'n1' }, { from: 'i:spd', to: 'n1' }, { from: 'n1', to: 'o:fl' }, { from: 'i:spd', to: 'o:fl' }],
});
const W = [0.4, -0.6, 0.8, 0.3];
const SPD = 0.5, TARGET = 0.9;
const F: Record<string, [(z: number) => number, (z: number) => number]> = {
  tanh: [Math.tanh, (z) => 1 - Math.tanh(z) ** 2],
  sigmoid: [(z) => 1 / (1 + Math.exp(-z)), (z) => { const s = 1 / (1 + Math.exp(-z)); return s * (1 - s); }],
  relu: [(z) => Math.max(0, z), (z) => (z > 0 ? 1 : 0)],
  linear: [(z) => z, () => 1],
};

/** One forward + backward on the tiny net through the engine. */
function engineGrad(act: 'tanh' | 'sigmoid' | 'relu' | 'linear', a = 0) {
  const net = compile({ spec: tiny(act), w: W });
  const inputs = new Float64Array(10); inputs[9] = 1; inputs[8] = SPD;
  const vals = new Float64Array(net.nNodes), z = new Float64Array(net.nNodes), delta = new Float64Array(net.nNodes);
  evalNet(net, inputs, vals, 0, 0, 0);
  preActivations(net, vals, z);
  const err = [TARGET - vals[net.outStart], 0, 0, 0];
  const grad = new Float64Array(4);
  backward(net, vals, z, err, a, delta, grad);
  return { grad, y: vals[net.outStart] };
}

describe('the generalised delta rule, hand-computed on a tiny net', () => {
  for (const act of ['tanh', 'sigmoid', 'relu', 'linear'] as const) {
    it(act, () => {
      const [f, df] = F[act];
      const z1 = W[0] * 1 + W[1] * SPD, y1 = f(z1);
      const y = W[2] * y1 + W[3] * SPD; // inside −1..1: the wheel's slope is 1
      const dOut = (TARGET - y) * 1; // output δ = (t − y)·f′(z)
      const d1 = df(z1) * W[2] * dOut; // hidden δ = f′(z)·Σ w·δ
      const hand = [d1 * 1, d1 * SPD, dOut * y1, dOut * SPD]; // δ·x per wire
      const { grad, y: yEngine } = engineGrad(act);
      expect(yEngine).toBeCloseTo(y, 14);
      for (let k = 0; k < 4; k++) expect(grad[k]).toBeCloseTo(hand[k], 14);
    });
  }
  it('over budget every slope is scaled by (1 − a)', () => {
    const clean = engineGrad('tanh').grad, noisy = engineGrad('tanh', 0.25).grad;
    expect(noisy[2]).toBeCloseTo(0.75 * clean[2], 14); // one slope (the wheel's)
    expect(noisy[0]).toBeCloseTo(0.75 * 0.75 * clean[0], 14); // two (wheel and n1)
  });
  it('a wheel pinned at ±1 passes the error only when it points back into range', () => {
    expect(wheelSlope(0.3, 1)).toBe(1);
    expect(wheelSlope(1.5, -0.2)).toBe(1);
    expect(wheelSlope(1.5, 0.2)).toBe(0);
    expect(wheelSlope(-1.5, 0.2)).toBe(1);
    expect(wheelSlope(-1.5, -0.2)).toBe(0);
  });
  it('the trainer step is Δw = η · (Σ δ·x) / samples', () => {
    const b = new Backprop({ start: 'fresh' }) as unknown as { update(s: Float64Array, st: Float64Array): Float64Array; loss: number };
    const sum = Float64Array.from([1.2, -0.4, 0, 3]), stats = Float64Array.from([8, 4, 0]);
    const dw = b.update(sum, stats);
    const eta = CONFIG.train.backprop.lr;
    expect(Array.from(dw)).toEqual([eta * 1.2 / 4, eta * -0.4 / 4, 0, eta * 3 / 4]);
    expect(b.loss).toBe(8 / (4 * 4));
  });
});

describe('copying the teacher (imitate kernel)', () => {
  const s = phaseSeeds(11), spec = starterSpec();
  const setup = { spec, trackSeeds: s.trainTracks, noiseSeeds: s.trainNoise, pool: CONFIG.budget[0] * CONFIG.train.episodeTicks, episodeTicks: CONFIG.train.episodeTicks };
  const w = Float64Array.from(spec.conns, (_, k) => ((k * 7) % 5 - 2) / 4);

  it('one tick of a lane adds exactly the hand-built δ·x for e = teacher − brain', () => {
    const core = new EpisodeCore(setup);
    const [out] = core.rollout({ kernel: 'imitate', seed: 3, w, params: [0], ticks: 1, lanes: fresh(1) });
    // rebuild that tick by hand: lane 0's first episode (track 0, start drawn by hashU), the brain, the teacher
    expect(out.lane.track).toBe(0);
    const t = core.tracks[0];
    const c = startCar(t, (t.startIdx + Math.floor(hashU(3, 0, 0) * t.n)) % t.n);
    const net = compile({ spec, w: Array.from(w) });
    const inputs = new Float64Array(10), vals = new Float64Array(net.nNodes), z = new Float64Array(net.nNodes), delta = new Float64Array(net.nNodes);
    readSensors(c, t, net.inUsed, setup.pool, inputs);
    evalNet(net, inputs, vals, 0, 0, 0);
    const target = new Float64Array(4);
    teacherWheels(c, t, target);
    preActivations(net, vals, z);
    const grad = new Float64Array(spec.conns.length);
    backward(net, vals, z, [0, 1, 2, 3].map((k) => target[k] - vals[net.outStart + k]), 0, delta, grad);
    expect(Array.from(out.grad)).toEqual(Array.from(grad));
    expect(grad.some((g) => g !== 0)).toBe(true);
    expect(out.stats[1]).toBe(1);
  });

  it('lanes give the same bits however they are split', () => {
    const core = new EpisodeCore(setup);
    const job = { kernel: 'imitate' as const, seed: 9, w, params: [0.5], ticks: 300, lanes: fresh(6) };
    const all = core.rollout(job);
    const parts = [core.rollout({ ...job, lanes: job.lanes.slice(0, 2) }), new EpisodeCore(setup).rollout({ ...job, lanes: job.lanes.slice(2) })].flat();
    expect(parts.map((o) => Array.from(o.grad))).toEqual(all.map((o) => Array.from(o.grad)));
    expect(parts.map((o) => o.lane)).toEqual(all.map((o) => o.lane));
  });
});

describe('the teacher', () => {
  it('laps every one of 10 tracks in a minute without touching a wall', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const t = generateTrack(phaseSeeds(seed).unseenTrack);
      const r = driveTeacher(t, CONFIG.drive.ticks, CONFIG.budget[0] * CONFIG.drive.ticks);
      expect(r.prog, `seed ${seed}`).toBeGreaterThan(2 * t.len);
      expect(r.wallTicks, `seed ${seed}`).toBe(0);
    }
  });
});

describe('refusals', () => {
  it('backprop refuses step neurons with a reason the workbench can show, and init throws it', () => {
    const spec = starterSpec();
    expect(trainerRefusal('backprop', spec)).toBeNull();
    expect(trainerRefusal('evolution', spec)).toBeNull();
    const stepped: BrainSpec = { ...spec, nodes: spec.nodes.map((n) => (n.id === 'n2' ? { ...n, act: 'step' } : n)) };
    const why = trainerRefusal('backprop', stepped);
    expect(why).toMatch(/step neurons have none \(n2\)/);
    expect(trainerRefusal('evolution', stepped)).toBeNull();
  });
});
