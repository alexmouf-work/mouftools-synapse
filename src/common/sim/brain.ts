// Spec → compiled net, evaluation with the four transfer functions and over-budget noise, presets, canonical genome
// JSON and its hash. Node order: 10 inputs, hidden neurons by (layer, spec order), 4 wheel outputs. Each node sums
// its incoming wires in spec order, so adding a wire with w = 0 adds an exact +0 and changes nothing.
import { CONFIG, type Act } from '../config';
import { sigmoid, tanh } from '../fmath';
import { Hasher } from '../hash';
import { hashU } from '../rng';
import { fireCost, staticCost, wiredInputs, wireFactors } from './energy';
import {
  INPUTS, OUTPUTS, inputIdx, outputIdx, validateGenome, type BrainSpec, type Genome,
} from './spec';

const ACT_CODE: Record<Act, number> = { step: 0, relu: 1, sigmoid: 2, tanh: 3 };
const OUT = 4; // wheel output: clamp(sum, −1, 1), no transfer function
const NOISE_KEY_HIDDEN = 100; // noise keys: pins by index, hidden neurons 100 + their id number

export interface Net {
  spec: BrainSpec;
  nIn: number;
  nHidden: number;
  nNodes: number;
  /** First output node index (outputs are nodes outStart .. outStart + 3). */
  outStart: number;
  /** Per node: transfer code (inputs −1). */
  act: Int8Array;
  /** Per node: noise stream key, stable across edits. */
  key: Int32Array;
  /** Incoming wires of node d: wire indices inStart[d] .. inStart[d + 1]. */
  inStart: Int32Array;
  from: Int32Array;
  w: Float64Array;
  /** Fire-cost factor per compiled wire. */
  factor: Float64Array;
  /** compiled wire → spec.conns index (for probes). */
  specIdx: Int32Array;
  inUsed: Uint8Array;
  staticCost: number;
}

export function compile(g: Genome): Net {
  validateGenome(g);
  const spec = g.spec;
  const nIn = INPUTS.length;
  const hidden = spec.nodes
    .map((n, k) => ({ n, k }))
    .sort((a, b) => (a.n.layer - b.n.layer) || (a.k - b.k))
    .map((x) => x.n);
  const nHidden = hidden.length;
  const outStart = nIn + nHidden;
  const nNodes = outStart + OUTPUTS.length;
  const index = new Map<string, number>();
  hidden.forEach((n, k) => index.set(n.id, nIn + k));
  const nodeOf = (id: string): number => {
    const i = inputIdx(id); if (i !== undefined) return i;
    const o = outputIdx(id); if (o !== undefined) return outStart + o;
    const h = index.get(id); if (h === undefined) throw new Error(`brain: unknown id ${id}`);
    return h;
  };
  const act = new Int8Array(nNodes).fill(-1);
  const key = new Int32Array(nNodes);
  for (let i = 0; i < nIn; i++) key[i] = i;
  hidden.forEach((n, k) => { act[nIn + k] = ACT_CODE[n.act]; key[nIn + k] = NOISE_KEY_HIDDEN + Number(n.id.slice(1)); });
  for (let o = 0; o < OUTPUTS.length; o++) { act[outStart + o] = OUT; key[outStart + o] = nIn + o; }

  const m = spec.conns.length;
  const toNode = spec.conns.map((c) => nodeOf(c.to));
  const order = spec.conns.map((_, k) => k).sort((a, b) => (toNode[a] - toNode[b]) || (a - b));
  const specFactor = wireFactors(spec);
  const from = new Int32Array(m), w = new Float64Array(m), factor = new Float64Array(m), specIdx = new Int32Array(m);
  const inStart = new Int32Array(nNodes + 1);
  order.forEach((k, c) => {
    from[c] = nodeOf(spec.conns[k].from); w[c] = g.w[k]; factor[c] = specFactor[k]; specIdx[c] = k;
    inStart[toNode[k] + 1]++;
  });
  for (let d = 0; d < nNodes; d++) inStart[d + 1] += inStart[d];
  return {
    spec, nIn, nHidden, nNodes, outStart, act, key, inStart, from, w, factor, specIdx,
    inUsed: wiredInputs(spec), staticCost: staticCost(spec).total,
  };
}

/** Replace the weights of a compiled net in place (same spec). */
export function setWeights(net: Net, wSpecOrder: ArrayLike<number>): void {
  for (let c = 0; c < net.w.length; c++) net.w[c] = wSpecOrder[net.specIdx[c]];
}

export function transfer(code: number, x: number): number {
  switch (code) {
    case 0: return x > 0 ? 1 : 0;
    case 1: return x < 0 ? 0 : x > CONFIG.brain.reluCap ? CONFIG.brain.reluCap : x;
    case 2: return sigmoid(x);
    case 3: return tanh(x);
    case OUT: return x < -1 ? -1 : x > 1 ? 1 : x;
    default: throw new Error(`brain: transfer code ${code}`);
  }
}

/**
 * One brain tick. `inputs` holds the 10 clean sensor values; `vals` receives every node's output (noise applied
 * after the transfer function when a > 0). Returns the energy used this tick.
 */
export function evalNet(net: Net, inputs: Float64Array, vals: Float64Array, a: number, noiseSeed: number, tick: number): number {
  const { nIn, nNodes, act, inStart, from, w, key } = net;
  const noisy = a > 0;
  for (let i = 0; i < nIn; i++) {
    const v = inputs[i];
    vals[i] = noisy ? (1 - a) * v + a * (2 * hashU(noiseSeed, key[i], tick) - 1) : v;
  }
  for (let d = nIn; d < nNodes; d++) {
    let s = 0;
    for (let c = inStart[d], e = inStart[d + 1]; c < e; c++) s += w[c] * vals[from[c]];
    const v = transfer(act[d], s);
    vals[d] = noisy ? (1 - a) * v + a * (2 * hashU(noiseSeed, key[d], tick) - 1) : v;
  }
  return net.staticCost + fireCost(net.factor, from, w, vals);
}

// ---- presets ----

/** The workbench's Starter: one line of three — a steering neuron per side and a cruise neuron on all four wheels. */
export function starterSpec(): BrainSpec {
  const wires: [string, string][] = [
    ['i:l', 'n3'], ['i:fl', 'n3'], ['i:f', 'n1'], ['i:r', 'n1'], ['i:fr', 'n1'], ['i:f', 'n3'],
    ['n1', 'o:fl'], ['n1', 'o:rl'], ['n3', 'o:fr'], ['n3', 'o:rr'],
    ['i:road', 'n2'], ['i:spd', 'n2'], ['i:energy', 'n2'], ['n2', 'o:fl'], ['n2', 'o:fr'], ['n2', 'o:rl'], ['n2', 'o:rr'],
  ];
  return {
    v: 1,
    layers: 1,
    nodes: [
      { id: 'n1', layer: 1, act: 'tanh', dropout: 0 },
      { id: 'n2', layer: 1, act: 'relu', dropout: 0 },
      { id: 'n3', layer: 1, act: 'tanh', dropout: 0 },
    ],
    conns: wires.map(([from, to]) => ({ from, to })),
  };
}

/** Minimal: front-left, front, front-right and road ahead wired straight to all four wheels. */
export function minimalSpec(): BrainSpec {
  const conns = [];
  for (const from of ['i:fl', 'i:f', 'i:fr', 'i:road']) for (const o of OUTPUTS) conns.push({ from, to: o.id });
  return { v: 1, layers: 1, nodes: [], conns };
}

export const zeroGenome = (spec: BrainSpec): Genome => ({ spec, w: spec.conns.map(() => 0) });

// ---- canonical JSON + hash ----

/** Canonical JSON: fixed key order; JS number formatting round-trips doubles exactly. */
export function genomeToJSON(g: Genome): string {
  const s = g.spec;
  return JSON.stringify({
    spec: {
      v: s.v,
      layers: s.layers,
      nodes: s.nodes.map((n) => ({ id: n.id, layer: n.layer, act: n.act, dropout: n.dropout })),
      conns: s.conns.map((c) => ({ from: c.from, to: c.to })),
    },
    w: g.w.map((x) => (Object.is(x, -0) ? 0 : x)),
  });
}

export function genomeFromJSON(json: string): Genome {
  const o = JSON.parse(json) as Genome;
  validateGenome(o);
  return o;
}

export function specHash(s: BrainSpec): string {
  const h = new Hasher().u32(s.v).u32(s.layers).u32(s.nodes.length);
  for (const n of s.nodes) h.str(n.id).u32(n.layer).str(n.act).f64(n.dropout);
  h.u32(s.conns.length);
  for (const c of s.conns) h.str(c.from).str(c.to);
  return h.hex();
}

/** Over the spec and the weights; −0 hashes as +0, as JSON writes it. */
export function genomeHash(g: Genome): string {
  const h = new Hasher().str(specHash(g.spec)).u32(g.w.length);
  for (const x of g.w) h.f64(x === 0 ? 0 : x);
  return h.hex();
}
