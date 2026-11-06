// A_RP's rollout kernel (associative reward-penalty, Barto & Anandan 1985; trainers plan T3). Each wheel is a
// stochastic unit: it fires y = +1 with probability (1 + E[y]) / 2, else −1, where E[y] = tanh(z) is the wheel's own
// output (what it drives in a race). While training the car drives E[y] + s·(y − E[y]) (s, the firing randomness: 1
// drives the spikes themselves), with the spikes drawn from the lane's episode seed. After the tick, one bit of
// reinforcement: reward if the car made progress without touching a wall, else penalty. Then, at each wheel,
//   reward   δ = y − E[y]          (fire that way again)
//   penalty  δ = λ·(−y − E[y])     (fire the other way, more gently)
// and Δw = ρ·δ·x. y − E[y] is ∂log P(y)/∂z for these units, so δ is the error at z itself (no slope); the hidden
// layers and the cells' learned fields get theirs from it by the delta rule (grad.ts, fieldgrad.ts), as backprop's do.
//   params: [s, λ]   grad: Σ δ·x (paramCount values)   stats: [rewarded ticks, ticks]
import { hashU } from '../rng';
import type { Net } from '../sim/brain';
import type { CarState } from '../sim/car';
import { fieldGrads } from '../sim/fieldgrad';
import { episodeNoise } from './acKernel';
import { backward } from './grad';
import type { Kernel, KernelCtx, Lane } from './rollout';

let z = new Float64Array(0), delta = new Float64Array(0);
const E = new Float64Array(4), Y = new Float64Array(4), err = new Float64Array(4);
/** The car as the cells read it (before the tick's physics), for the fields' gradient afterwards. */
let seen: CarState | null = null;
let cur: { params: number[]; lane: Lane } | null = null;

function act(vals: Float64Array, o: number): void {
  const { params, lane } = cur!;
  const s = params[0], c = lane.car!;
  for (let k = 0; k < 4; k++) {
    const e = vals[o + k];
    E[k] = e;
    Y[k] = hashU(lane.mode, c.tick, k) < (1 + e) / 2 ? 1 : -1;
    const a = e + s * (Y[k] - e);
    vals[o + k] = a < -1 ? -1 : a > 1 ? 1 : a;
  }
  seen = Object.assign(seen ?? { ...c }, c);
}

export const arp: Kernel = {
  gradSize: (net: Net) => net.wires + net.nNodes - net.nIn + net.fields,
  statSize: 2,
  episodeStart(_ctx, job, lane) { lane.mode = episodeNoise(job.seed, lane); },
  tick(ctx: KernelCtx, job, lane, grad, stats) {
    const { net, runner } = ctx;
    if (z.length !== net.nNodes) { z = new Float64Array(net.nNodes); delta = new Float64Array(net.nNodes); }
    if (cur === null || cur.lane !== lane || cur.params !== job.params) cur = { params: job.params, lane };
    const c = lane.car!, t = ctx.tracks[lane.track], p0 = c.prog, w0 = c.wallTicks;
    runner.tick(net, t, c, undefined, act);
    const reward = c.prog > p0 && c.wallTicks === w0;
    const lam = job.params[1];
    for (let k = 0; k < 4; k++) err[k] = reward ? Y[k] - E[k] : lam * (-Y[k] - E[k]);
    // the node values the brain computed this tick (act rewrote only the wheels, which feed nothing)
    const vals = runner.lastValues();
      backward(net, vals, null, err, delta, grad, 1, true);
    fieldGrads(net, seen!, t, delta, grad);
    if (reward) stats[0] += 1;
    stats[1] += 1;
  },
};
