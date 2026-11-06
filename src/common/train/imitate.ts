// Backprop's rollout kernel: copy the teacher, DAgger-style. The brain drives (or, in an episode drawn with
// probability β, the teacher drives: classic DAgger's mixing, so early lanes see good driving too); every tick the
// teacher labels the state the brain just saw, and the lane adds the delta-rule terms δ·x for error e = t − y at the
// four wheels (train/grad.ts). Because the brain mostly drives, it is labelled on its own mistakes and learns to
// recover from them. The teacher reads the same car the brain does; every tick it drives is metered like any car.
//   params: [β]   stats: [Σ e² over the four wheels, samples, ticks the teacher drove]
import { fieldGrads } from '../sim/fieldgrad';
import { teacherWheels } from '../sim/teacher';
import { backward } from './grad';
import { episodeDraw, type Kernel, type KernelCtx, type Lane } from './rollout';

let z = new Float64Array(0), delta = new Float64Array(0);
const target = new Float64Array(4), err = new Float64Array(4);
// the tick's context for `act` (one closure for every tick, so the hot loop allocates nothing)
let cur: { ctx: KernelCtx; lane: Lane; grad: Float64Array; stats: Float64Array } | null = null;

function act(vals: Float64Array, o: number): void {
  const { ctx, lane, grad, stats } = cur!;
  const c = lane.car!, t = ctx.tracks[lane.track];
  teacherWheels(c, t, target, c.cap); // the state before this tick's physics: what the brain just saw, at its speed cap
  let sse = 0;
  for (let k = 0; k < 4; k++) { err[k] = target[k] - vals[o + k]; sse += err[k] * err[k]; }
  backward(ctx.net, vals, null, err, delta, grad);
  fieldGrads(ctx.net, c, t, delta, grad); // the cells' learned fields, from the error at each cell (B2e)
  stats[0] += sse; stats[1] += 1;
  if (lane.mode === 1) { for (let k = 0; k < 4; k++) vals[o + k] = target[k]; stats[2] += 1; }
}

export const imitate: Kernel = {
  gradSize: (net) => net.wires + net.nNodes - net.nIn + net.fields,
  statSize: 3,
  episodeStart(_ctx, job, lane) {
    lane.mode = episodeDraw(job.seed, lane) < job.params[0] ? 1 : 0;
  },
  tick(ctx, _job, lane, grad, stats) {
    const { net, runner } = ctx;
    if (z.length < net.nNodes) { z = new Float64Array(net.nNodes); delta = new Float64Array(net.nNodes); }
    if (cur === null || cur.lane !== lane || cur.grad !== grad) cur = { ctx, lane, grad, stats };
    runner.tick(net, ctx.tracks[lane.track], lane.car!, undefined, act);
  },
};
