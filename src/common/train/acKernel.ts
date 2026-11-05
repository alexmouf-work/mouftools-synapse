// Actor-critic's rollout kernel (trainers plan T2). The brain is the actor: each tick its wheel outputs y are the mean
// of a Gaussian policy, and the car drives a = y + σ·ε (ε ~ N(0, 1) per wheel, drawn from the lane's episode seed, so
// the same lane gives the same noise on any worker). The critic, owned by the trainer, is linear over what the brain
// sees and computes: V(s) = v · φ(s), φ = [1, every input cell, every hidden neuron, the car's speed / top speed].
// The reward is the training fitness per tick: r = progress this tick − wallPenalty × wall touch (m). Then
//   TD error   δ = r + γ·V(s′) − V(s)          (V of the state after an episode's end is 0)
//   actor      Δw ∝ δ · e,  e ← γλ·e + ∂log π(a|s)/∂w     (∂log π/∂y = ε/σ, carried back by the delta rule, grad.ts)
//   critic     Δv ∝ δ · e_v, e_v ← γλ·e_v + φ(s)
// with eligibility traces (TD(λ)) so a wall touch is blamed on the steering that led to it. Each transition is settled
// on the next tick, once V(s′) is known; the trace and the open transition start afresh at every episode and round.
//   params: [σ, γ, λ, v_0 … v_{nC−1}]
//   grad: the actor's Σ δ·e (paramCount values), then the critic's Σ δ·e_v (nC values)
//   stats: [Σ δ², transitions, Σ r, Σ V(s)]
import { CONFIG } from '../config';
import { cos, log, TAU } from '../fmath';
import { derive, hashU, TAG } from '../rng';
import type { Net } from '../sim/brain';
import { fieldGrads } from '../sim/fieldgrad';
import { backward, preActivations } from './grad';
import type { Kernel, KernelCtx, Lane } from './rollout';

/** The critic's features: a constant, every input cell and hidden neuron, the car's speed. */
export const criticSize = (net: { outStart: number }): number => net.outStart + 2;
/** params before the critic's weights. */
export const AC_HEAD = 3;
const paramSize = (net: Net): number => net.wires + net.nNodes - net.nIn + net.fields;
const TOP = CONFIG.car.wheelSpeed, WALL = CONFIG.train.wallPenalty;

/** A standard normal from two counter-based uniforms (Box–Muller with fmath, so every engine gets the same bits). */
export function gauss(seed: number, a: number, b: number): number {
  const u1 = 1 - hashU(seed, a, b), u2 = hashU(seed, a, b + 1); // u1 in (0, 1]
  return Math.sqrt(-2 * log(u1)) * cos(TAU * u2);
}

/** The noise seed of a lane's episode (kept in lane.mode). */
export const episodeNoise = (seed: number, lane: Lane): number => derive(seed, TAG.trainNoise, lane.id, lane.episode);

// scratch, sized to the net (one lane runs at a time, so one set serves every lane)
let z = new Float64Array(0), delta = new Float64Array(0), g = new Float64Array(0), tA = new Float64Array(0);
let phi = new Float64Array(0), tC = new Float64Array(0);
const eps = new Float64Array(4), err = new Float64Array(4);
let open = false, prevV = 0, prevR = 0, curV = 0;
let cur: { ctx: KernelCtx; params: number[]; lane: Lane; grad: Float64Array; stats: Float64Array } | null = null;

function size(net: Net): void {
  const nP = paramSize(net), nC = criticSize(net);
  if (z.length !== net.nNodes) { z = new Float64Array(net.nNodes); delta = new Float64Array(net.nNodes); }
  if (g.length !== nP) { g = new Float64Array(nP); tA = new Float64Array(nP); }
  if (phi.length !== nC) { phi = new Float64Array(nC); tC = new Float64Array(nC); }
}

function restart(): void { tA.fill(0); tC.fill(0); open = false; }

/** Settle the open transition with TD error d: the traces carry it to every weight that led here. */
function settle(d: number, grad: Float64Array, stats: Float64Array): void {
  const nP = tA.length;
  for (let i = 0; i < nP; i++) grad[i] += d * tA[i];
  for (let j = 0; j < tC.length; j++) grad[nP + j] += d * tC[j];
  stats[0] += d * d; stats[1] += 1;
  open = false;
}

function act(vals: Float64Array, o: number): void {
  const { ctx, params, lane, grad, stats } = cur!;
  const net = ctx.net, c = lane.car!, t = ctx.tracks[lane.track];
  const sigma = params[0], gl = params[1] * params[2];
  // the critic's view of this state
  phi[0] = 1;
  for (let i = 0; i < net.outStart; i++) phi[1 + i] = vals[i];
  phi[net.outStart + 1] = c.v / TOP;
  let V = 0;
  for (let j = 0; j < phi.length; j++) V += params[AC_HEAD + j] * phi[j];
  curV = V;
  stats[3] += V;
  if (open) settle(prevR + params[1] * V - prevV, grad, stats);
  // the policy's score ∂log π/∂w at this state, into the traces
  for (let k = 0; k < 4; k++) { eps[k] = gauss(lane.mode, c.tick, 2 * k); err[k] = eps[k] / sigma; }
  preActivations(net, vals, z);
  g.fill(0);
  backward(net, vals, z, err, delta, g);
  fieldGrads(net, c, t, delta, g); // the cells' learned fields, where they have a gradient
  for (let i = 0; i < g.length; i++) tA[i] = gl * tA[i] + g[i];
  for (let j = 0; j < phi.length; j++) tC[j] = gl * tC[j] + phi[j];
  // the action: the brain's wheels plus the exploration
  for (let k = 0; k < 4; k++) { const a = vals[o + k] + sigma * eps[k]; vals[o + k] = a < -1 ? -1 : a > 1 ? 1 : a; }
}

export const actorCritic: Kernel = {
  gradSize: (net) => paramSize(net) + criticSize(net),
  statSize: 4,
  laneStart(ctx) { size(ctx.net); restart(); },
  episodeStart(_ctx, job, lane) { lane.mode = episodeNoise(job.seed, lane); restart(); },
  tick(ctx, job, lane, grad, stats) {
    size(ctx.net);
    if (job.params.length !== AC_HEAD + phi.length) throw new Error(`actor-critic: ${job.params.length} params, expected ${AC_HEAD + phi.length}`);
    if (cur === null || cur.lane !== lane || cur.grad !== grad || cur.params !== job.params) cur = { ctx, params: job.params, lane, grad, stats };
    const c = lane.car!, p0 = c.prog, w0 = c.wallTicks;
    ctx.runner.tick(ctx.net, ctx.tracks[lane.track], c, undefined, act);
    const r = c.prog - p0 - WALL * (c.wallTicks - w0);
    stats[2] += r;
    prevV = curV; prevR = r; open = true;
  },
  episodeEnd(_ctx, _job, _lane, grad, stats) { if (open) settle(prevR - prevV, grad, stats); },
};
