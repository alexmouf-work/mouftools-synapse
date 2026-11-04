// The generalised delta rule on a compiled net, for one tick (the gradient trainers' one implementation):
//   output δ = e · f′(z)            (e: the error at the wheel, e.g. t − y when copying a teacher)
//   hidden δ = f′(z) · Σ w · δ      (over the neuron's outgoing wires: "the error of each neuron one layer back is the
//                                     weighted sum of the errors of the neurons above it")
//   Δw ∝ δ · x                      (x: the sending node's output this tick)
//   Δb ∝ δ                          (each neuron's built-in bias: a wire from a constant 1)
// Brain v2: the wheels are tanh like any neuron, and there is no over-budget noise any more.
import { transferSlope, type Net } from '../sim/brain';

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
 * Backward pass for one tick. `err[k]` is the error at wheel k. Fills `delta` (per node) and adds δ_to · x_from for
 * every wire and δ for every bias into `grad` (parameter order: wires, then biases), times `scale`.
 */
export function backward(
  net: Net, vals: ArrayLike<number>, z: Float64Array, err: ArrayLike<number>,
  delta: Float64Array, grad: Float64Array, scale = 1,
): void {
  const { nIn, nNodes, outStart, act, inStart, from, w, specIdx, wires } = net;
  for (let d = nIn; d < outStart; d++) delta[d] = 0;
  for (let k = 0; k < nNodes - outStart; k++) delta[outStart + k] = err[k];
  // nodes in reverse order: every wire runs forward, so a node's δ is complete before its own wires are visited
  for (let d = nNodes - 1; d >= nIn; d--) {
    delta[d] *= transferSlope(act[d], z[d]); // delta held e (wheels) or Σ w·δ (hidden) until now
    const dd = delta[d];
    if (dd === 0) continue;
    grad[wires + d - nIn] += scale * dd; // the bias: Δb ∝ δ
    for (let c = inStart[d], e = inStart[d + 1]; c < e; c++) {
      const f = from[c];
      grad[specIdx[c]] += scale * dd * vals[f];
      if (f >= nIn) delta[f] += w[c] * dd;
    }
  }
}
