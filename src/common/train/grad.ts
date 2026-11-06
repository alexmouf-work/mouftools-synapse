// The generalised delta rule on a compiled net, for one tick (the gradient trainers' one implementation):
//   output δ = e · f′(z)            (e: the error at the wheel, e.g. t − y when copying a teacher)
//   hidden δ = f′(z) · Σ w · δ      (over the neuron's outgoing wires: "the error of each neuron one layer back is the
//                                     weighted sum of the errors of the neurons above it")
//   Δw ∝ δ · x                      (x: the sending node's output this tick)
//   Δb ∝ δ                          (each neuron's built-in bias: a wire from a constant 1)
//   input δ = Σ w · δ               (B2e: the error at each sense cell, for its learned field; sim/fieldgrad.ts)
// A_RP's stochastic wheels give their error at z itself (y − E[y] is ∂log P(y)/∂z), so it can skip the wheels' slope.
// Brain v2: the wheels are tanh like any neuron, and there is no over-budget noise any more.
import { slopeOf, type Net } from '../sim/brain';

/** Pre-activations of every non-input node from one tick's node values (the very sums evalNet formed). */
export function preActivations(net: Net, vals: ArrayLike<number>, z: Float64Array): void {
  const { nIn, nNodes, inStart, from, w, bias } = net;
  for (let d = nIn; d < nNodes; d++) {
    let s = bias[d];
    for (let c = inStart[d], e = inStart[d + 1]; c < e; c++) s += w[c] * vals[from[c]];
    z[d] = s;
  }
}

/**
 * Backward pass for one tick. `err[k]` is the error at wheel k. Fills `delta` (per node, the sense cells included) and
 * adds δ_to · x_from for every wire and δ for every bias into `grad` (parameter order: wires, then biases), times
 * `scale`. The fields' terms need the car's state: fieldGrads adds them from the input δ. With `errAtZ`, err is
 * already the error at the wheels' pre-activation (their slope is not applied).
 */
export function backward(
  net: Net, vals: ArrayLike<number>, _z: Float64Array | null, err: ArrayLike<number>,
  delta: Float64Array, grad: Float64Array, scale = 1, errAtZ = false,
): void {
  const { nIn, nNodes, outStart, act, inStart, from, w, specIdx, wires } = net;
  for (let d = 0; d < outStart; d++) delta[d] = 0;
  for (let k = 0; k < nNodes - outStart; k++) delta[outStart + k] = err[k];
  // nodes in reverse order: every wire runs forward, so a node's δ is complete before its own wires are visited
  for (let d = nNodes - 1; d >= nIn; d--) {
    // delta held e (wheels) or Σ w·δ (hidden) until now; the slope from the node's output (bit for bit f′(z))
    if (!errAtZ || d < outStart) delta[d] *= slopeOf(act[d], vals[d]);
    const dd = delta[d];
    if (dd === 0) continue;
    grad[wires + d - nIn] += scale * dd; // the bias: Δb ∝ δ
    for (let c = inStart[d], e = inStart[d + 1]; c < e; c++) {
      const f = from[c];
      grad[specIdx[c]] += scale * dd * vals[f];
      delta[f] += w[c] * dd;
    }
  }
}
