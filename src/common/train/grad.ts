// The generalised delta rule on a compiled net, for one tick (the gradient trainers' one implementation):
//   output δ = e · f′(z)            (e: the error at the wheel, e.g. t − y when copying a teacher)
//   hidden δ = f′(z) · Σ w · δ      (over the neuron's outgoing wires: "the error of each neuron one layer back is the
//                                     weighted sum of the errors of the neurons above it")
//   Δw ∝ δ · x                      (x: the sending node's output this tick)
// Over budget a signal is (1 − a)·f(z) + a·noise, so every f′ is scaled by (1 − a). The wheels are clamp(z, −1, 1):
// f′ = 1 inside; outside it passes the error only when the error points back into range, otherwise a wheel pinned
// at ±1 could never learn to let go (a clamp's true slope there is 0).
import { OUT_CODE, transferSlope, type Net } from '../sim/brain';

/** Pre-activations of every non-input node from one tick's node values (the very sums evalNet formed). */
export function preActivations(net: Net, vals: ArrayLike<number>, z: Float64Array): void {
  const { nIn, nNodes, inStart, from, w } = net;
  for (let d = nIn; d < nNodes; d++) {
    let s = 0;
    for (let c = inStart[d], e = inStart[d + 1]; c < e; c++) s += w[c] * vals[from[c]];
    z[d] = s;
  }
}

/** f′ of a wheel output (clamp) for an error e at that wheel. */
export function wheelSlope(z: number, e: number): number {
  if (z > -1 && z < 1) return 1;
  return (z >= 1 && e < 0) || (z <= -1 && e > 0) ? 1 : 0;
}

/**
 * Backward pass for one tick. `err[k]` is the error at wheel k; a is the tick's noise level. Fills `delta` (per node)
 * and adds δ_to · x_from for every wire into `grad` (spec wire order), times `scale`.
 */
export function backward(
  net: Net, vals: ArrayLike<number>, z: Float64Array, err: ArrayLike<number>, a: number,
  delta: Float64Array, grad: Float64Array, scale = 1,
): void {
  const { nIn, nNodes, outStart, act, inStart, from, w, specIdx } = net;
  const clean = 1 - a;
  for (let d = nIn; d < outStart; d++) delta[d] = 0;
  for (let k = 0; k < nNodes - outStart; k++) {
    const d = outStart + k;
    if (act[d] !== OUT_CODE) throw new Error('grad: node order changed (wheels must come last)');
    delta[d] = err[k] * wheelSlope(z[d], err[k]) * clean;
  }
  // nodes in reverse order: every wire runs forward, so a node's δ is complete before its own wires are visited
  for (let d = nNodes - 1; d >= nIn; d--) {
    if (d < outStart) delta[d] *= transferSlope(act[d], z[d]) * clean; // delta held Σ w·δ until now
    const dd = delta[d];
    if (dd === 0) continue;
    for (let c = inStart[d], e = inStart[d + 1]; c < e; c++) {
      const f = from[c];
      grad[specIdx[c]] += scale * dd * vals[f];
      if (f >= nIn) delta[f] += w[c] * dd;
    }
  }
}
