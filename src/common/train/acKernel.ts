// Actor-critic's rollout kernel (trainers plan T2; GAE since step 3 of the fast-gradient-trainers plan). The brain is
// the actor: each tick its wheel outputs y are the mean of a Gaussian policy, and the car drives a = y + σ·ε (ε ~ N(0,
// 1) per wheel, drawn from the lane's episode seed, so the same lane gives the same noise on any worker). The critic,
// owned by the trainer, is linear over what the brain sees and computes: V(s) = v · φ(s), φ = [1, every input cell,
// every hidden neuron, the car's speed / top speed]. The reward is the training fitness per tick:
// r = progress this tick − wallPenalty × wall touch (m). Each tick's score g = ∂log π(a|s)/∂w (∂log π/∂y = ε/σ, carried
// back by the delta rule, grad.ts) waits in the lane's buffer until its advantage is known:
//   TD error   δ_t = r_t + γ·V(s_{t+1}) − V(s_t)        (V after an episode's end is 0)
//   advantage  A_t = δ_t + γλ·A_{t+1}                  (GAE(γ, λ), computed backwards at an episode's or the round's end;
//                                                       the round's last tick, whose next state is unseen, is dropped)
// The lane returns Σ A·g, Σ g, Σ A, Σ A² and the critic's Σ A·φ (toward the λ-return A + V), so the trainer can
// normalise the advantages over the whole round's batch exactly (Â = (A − mean) / sd): Σ Â·g = (Σ A·g − mean·Σ g)/sd.
//   params: [σ, γ, λ, v_0 … v_{nC−1}]
//   grad: Σ A·g (paramCount values), Σ g (paramCount), the critic's Σ A·φ (nC values)
//   stats: [Σ δ², transitions, Σ r, Σ V(s), Σ A, Σ A²]
import { CONFIG } from '../config';
import { cos, log, TAU } from '../fmath';
import { derive, hashU, TAG } from '../rng';
import type { Net } from '../sim/brain';
import { fieldGrads } from '../sim/fieldgrad';
import { backward } from './grad';
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

// scratch, sized to the net (one lane runs at a time, so one set serves every lane); the lane's buffer of this round's
// ticks: each score g (nP values), features φ (nC), V and r
let z = new Float64Array(0), delta = new Float64Array(0), g = new Float64Array(0);
let G = new Float64Array(0), PHI = new Float64Array(0), Vs = new Float64Array(0), Rs = new Float64Array(0);
let len = 0, from = 0;
const eps = new Float64Array(4), err = new Float64Array(4);
let cur: { ctx: KernelCtx; params: number[]; lane: Lane } | null = null;

function size(net: Net, ticks: number): void {
  const nP = paramSize(net), nC = criticSize(net);
  if (z.length !== net.nNodes) { z = new Float64Array(net.nNodes); delta = new Float64Array(net.nNodes); }
  if (g.length !== nP) g = new Float64Array(nP);
  if (G.length !== ticks * nP || PHI.length !== ticks * nC) { G = new Float64Array(ticks * nP); PHI = new Float64Array(ticks * nC); Vs = new Float64Array(ticks); Rs = new Float64Array(ticks); }
}

/**
 * Settle buffered ticks from..len−1 by GAE: `last` is V of the state after them (0 at an episode's end) or null when
 * it is unseen (the round's end: the final tick is dropped). Adds every settled tick's terms into grad and stats.
 */
function settle(params: number[], last: number | null, grad: Float64Array, stats: Float64Array): void {
  const gamma = params[1], gl = gamma * params[2], nP = g.length, nC = PHI.length / Math.max(1, Vs.length);
  let end = len, next = last ?? 0;
  if (last === null) { end = len - 1; next = end >= from ? Vs[end] : 0; } // the final tick's V bootstraps the one before
  let A = 0;
  for (let t = end - 1; t >= from; t--) {
    const d = Rs[t] + gamma * next - Vs[t];
    A = d + gl * A;
    next = Vs[t];
    const go = t * nP, po = t * nC;
    for (let i = 0; i < nP; i++) { grad[i] += A * G[go + i]; grad[nP + i] += G[go + i]; }
    for (let j = 0; j < nC; j++) grad[2 * nP + j] += A * PHI[po + j];
    stats[0] += d * d; stats[1] += 1; stats[4] += A; stats[5] += A * A;
  }
  from = len;
}

function act(vals: Float64Array, o: number): void {
  const { ctx, params, lane } = cur!;
  const net = ctx.net, c = lane.car!, t = ctx.tracks[lane.track], nP = g.length, nC = PHI.length / Vs.length;
  const sigma = params[0], po = len * nC;
  // the critic's view of this state
  PHI[po] = 1;
  for (let i = 0; i < net.outStart; i++) PHI[po + 1 + i] = vals[i];
  PHI[po + net.outStart + 1] = c.v / TOP;
  let V = 0;
  for (let j = 0; j < nC; j++) V += params[AC_HEAD + j] * PHI[po + j];
  Vs[len] = V;
  // the policy's score ∂log π/∂w at this state, into the buffer
  for (let k = 0; k < 4; k++) { eps[k] = gauss(lane.mode, c.tick, 2 * k); err[k] = eps[k] / sigma; }
  g.fill(0);
  backward(net, vals, null, err, delta, g);
  fieldGrads(net, c, t, delta, g); // the cells' learned fields, where they have a gradient
  G.set(g, len * nP);
  // the action: the brain's wheels plus the exploration
  for (let k = 0; k < 4; k++) { const a = vals[o + k] + sigma * eps[k]; vals[o + k] = a < -1 ? -1 : a > 1 ? 1 : a; }
}

export const actorCritic: Kernel = {
  gradSize: (net) => 2 * paramSize(net) + criticSize(net),
  statSize: 6,
  laneStart(ctx, job) { size(ctx.net, job.ticks); len = 0; from = 0; },
  episodeStart(_ctx, job, lane) { lane.mode = episodeNoise(job.seed, lane); },
  tick(ctx, job, lane, _grad, stats) {
    if (job.params.length !== AC_HEAD + criticSize(ctx.net)) throw new Error(`actor-critic: ${job.params.length} params, expected ${AC_HEAD + criticSize(ctx.net)}`);
    if (cur === null || cur.lane !== lane || cur.params !== job.params) cur = { ctx, params: job.params, lane };
    const c = lane.car!, p0 = c.prog, w0 = c.wallTicks;
    ctx.runner.tick(ctx.net, ctx.tracks[lane.track], c, undefined, act);
    const r = c.prog - p0 - WALL * (c.wallTicks - w0);
    Rs[len++] = r;
    stats[2] += r; stats[3] += Vs[len - 1];
  },
  episodeEnd(_ctx, job, _lane, grad, stats) { settle(job.params, 0, grad, stats); },
  laneEnd(_ctx, job, _lane, grad, stats) { settle(job.params, null, grad, stats); },
};
