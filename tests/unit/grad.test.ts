import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/common/config';
import { compile, evalNet } from '../../src/common/sim/brain';
import { speedCap } from '../../src/common/sim/energy';
import { startCar } from '../../src/common/sim/car';
import { defaultSpec, paramCount, type BrainSpec } from '../../src/common/sim/spec';
import { driveTeacher, teacherWheels } from '../../src/common/sim/teacher';
import { generateTrack } from '../../src/common/sim/track';
import { Backprop } from '../../src/common/train/backprop';
import { EpisodeCore } from '../../src/common/train/episodes';
import { backward, preActivations } from '../../src/common/train/grad';
import { phaseSeeds } from '../../src/common/train/phase';
import { fresh } from '../../src/common/train/rollout';
import { hashU } from '../../src/common/rng';
import { readSensors } from '../../src/common/sim/sensors';
import { fieldGrads } from '../../src/common/sim/fieldgrad';
import { trainerRefusal } from '../../src/common/train/trainer';

/** One speed cell → one neuron (fn) → the four wheels (tanh). Parameters: speed→h, h→FL, FR, RL, RR; biases h, FL, FR, RL, RR. */
const tiny = (fn: 'tanh' | 'sigmoid' | 'relu' | 'linear'): BrainSpec => ({ v: 2, senses: { boundary: 0, landmark: 0, hd: 0, grid: 0, speed: 1 }, layers: [{ n: 1, fn }] });
const W = [0.6, 0.8, -0.3, 0.5, 0.2, 0.1, -0.2, 0.05, 0, 0.3, 0]; // …then the speed cell's field (gain ×1)
const SPD = 0.5, TARGET = 0.9;
const F: Record<string, [(z: number) => number, (z: number) => number]> = {
  tanh: [Math.tanh, (z) => 1 - Math.tanh(z) ** 2],
  sigmoid: [(z) => 1 / (1 + Math.exp(-z)), (z) => { const s = 1 / (1 + Math.exp(-z)); return s * (1 - s); }],
  relu: [(z) => Math.max(0, z), (z) => (z > 0 ? 1 : 0)],
  linear: [(z) => z, () => 1],
};

/** One forward + backward on the tiny net through the engine, with an error at the front-left wheel only. */
function engineGrad(fn: 'tanh' | 'sigmoid' | 'relu' | 'linear') {
  const net = compile({ spec: tiny(fn), w: W });
  const vals = new Float64Array(net.nNodes), z = new Float64Array(net.nNodes), delta = new Float64Array(net.nNodes);
  evalNet(net, [SPD], vals);
  preActivations(net, vals, z);
  const err = [TARGET - vals[net.outStart], 0, 0, 0];
  const grad = new Float64Array(11);
  backward(net, vals, z, err, delta, grad);
  return { grad, y: vals[net.outStart] };
}

describe('the generalised delta rule, hand-computed on a tiny net', () => {
  for (const fn of ['tanh', 'sigmoid', 'relu', 'linear'] as const) {
    it(fn, () => {
      const [f, df] = F[fn];
      const z1 = W[5] + W[0] * SPD, y1 = f(z1); // z = b + Σ w·x
      const zo = W[6] + W[1] * y1, y = Math.tanh(zo); // the wheels are tanh
      const dOut = (TARGET - y) * (1 - y * y); // output δ = (t − y)·f′(z)
      const d1 = df(z1) * W[1] * dOut; // hidden δ = f′(z)·Σ w·δ (only FL carries an error)
      const hand = [d1 * SPD, dOut * y1, 0, 0, 0, d1, dOut, 0, 0, 0]; // δ·x per wire, then δ per bias
      const { grad, y: yEngine } = engineGrad(fn);
      expect(yEngine).toBeCloseTo(y, 14);
      for (let k = 0; k < 10; k++) expect(grad[k]).toBeCloseTo(hand[k], 14);
    });
  }
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
  // the default brain plus a speed cell (so the brain sees something on the start straight)
  const s = phaseSeeds(11), spec: BrainSpec = { ...defaultSpec(), senses: { ...defaultSpec().senses, speed: 1 } };
  const setup = { spec, trackSeeds: s.trainTracks, episodeTicks: CONFIG.train.episodeTicks };
  const w = Float64Array.from({ length: paramCount(spec) }, (_, k) => ((k * 7) % 5 - 2) / 4);

  it('one tick of a lane adds exactly the hand-built δ·x for e = teacher − brain', () => {
    const core = new EpisodeCore(setup);
    const [out] = core.rollout({ kernel: 'imitate', seed: 3, w, params: [0], ticks: 1, lanes: fresh(1) });
    // rebuild that tick by hand: lane 0's first episode (track 0, start drawn by hashU), the brain, the teacher
    expect(out.lane.track).toBe(0);
    const t = core.tracks[0];
    const c = startCar(t, (t.startIdx + Math.floor(hashU(3, 0, 0) * t.n)) % t.n);
    const net = compile({ spec, w: Array.from(w) });
    const inputs = new Float64Array(net.nIn), vals = new Float64Array(net.nNodes), z = new Float64Array(net.nNodes), delta = new Float64Array(net.nNodes);
    readSensors(c, t, net, inputs);
    const load = evalNet(net, inputs, vals);
    const target = new Float64Array(4);
    teacherWheels(c, t, target, speedCap(load)); // labelled at the speed cap the brain's energy leaves
    preActivations(net, vals, z);
    const grad = new Float64Array(paramCount(spec));
    backward(net, vals, z, [0, 1, 2, 3].map((k) => target[k] - vals[net.outStart + k]), delta, grad);
    fieldGrads(net, c, t, delta, grad); // and the cells' fields, from the error at each cell
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
  it('laps every one of 10 tracks (a lap or more) in a minute without touching a wall', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const t = generateTrack(phaseSeeds(seed).unseenTrack);
      const r = driveTeacher(t, CONFIG.drive.ticks);
      expect(r.prog, `seed ${seed}`).toBeGreaterThan(t.len); // 1.18–1.39 laps (tracks v2: laps of 2–3 km; 1.07 the least over 60 seeds)
      expect(r.wallTicks, `seed ${seed}`).toBe(0);
    }
  });
});

describe('refusals', () => {
  it('every function on every layer has a slope, so no trainer refuses a brain', () => {
    for (const fn of ['linear', 'relu', 'sigmoid', 'tanh'] as const) {
      const spec: BrainSpec = { ...defaultSpec(), layers: [{ n: 3, fn }, { n: 2, fn }] };
      expect(trainerRefusal('backprop', spec)).toBeNull();
      expect(trainerRefusal('evolution', spec)).toBeNull();
    }
  });
});
