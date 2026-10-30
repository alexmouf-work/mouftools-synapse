// Spec → compiled net, evaluation with the four transfer functions and over-budget noise, presets, canonical genome
// JSON and its hash. Node order: 10 inputs, hidden neurons by (layer, spec order), 4 wheel outputs. Each node sums
// its incoming wires in spec order, so adding a wire with w = 0 adds an exact +0 and changes nothing.
import { CONFIG, type Act } from '../config';
import { sigmoid, tanh } from '../fmath';
import { Hasher } from '../hash';
import { hashU } from '../rng';
import { fireCost, staticCost, wiredInputs, wireFactors } from './energy';
import {
  depthOf, INPUTS, OUTPUTS, inputIdx, outputIdx, validateGenome, type BrainSpec, type ConnSpec, type Genome, type NodeSpec,
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
  /** Pin or neuron id of each node, in node order. */
  ids: string[];
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
    ids: [...INPUTS.map((p) => p.id), ...hidden.map((n) => n.id), ...OUTPUTS.map((o) => o.id)],
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

/**
 * The `signal` probe channel: per spec wire, sender output × weight for the node values of one tick. The trainer's
 * probe and the drive view's brain panel both use this.
 */
export function signalOf(net: Net, vals: ArrayLike<number>, out = new Float64Array(net.spec.conns.length)): Float64Array {
  for (let k = 0; k < net.w.length; k++) out[net.specIdx[k]] = vals[net.from[k]] * net.w[k];
  return out;
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

/** Deep: the five front eyes, road and speed → 4 ReLU → 3 tanh → wheels (two hidden lines, about 90% est.). */
export function deepSpec(): BrainSpec {
  const l1 = ['n1', 'n2', 'n3', 'n4'], l2 = ['n5', 'n6', 'n7'];
  const conns: ConnSpec[] = [];
  for (const from of ['i:l', 'i:fl', 'i:f', 'i:fr', 'i:r', 'i:road', 'i:spd']) for (const to of l1) conns.push({ from, to });
  for (const from of l1) for (const to of l2) conns.push({ from, to });
  for (const from of l2) for (const o of OUTPUTS) conns.push({ from, to: o.id });
  return {
    v: 1,
    layers: 2,
    nodes: [
      ...l1.map((id): NodeSpec => ({ id, layer: 1, act: 'relu', dropout: 0 })),
      ...l2.map((id): NodeSpec => ({ id, layer: 2, act: 'tanh', dropout: 0 })),
    ],
    conns,
  };
}

export const PRESETS = { starter: starterSpec, minimal: minimalSpec, deep: deepSpec } as const;
export type PresetName = keyof typeof PRESETS;

export const zeroGenome = (spec: BrainSpec): Genome => ({ spec, w: spec.conns.map(() => 0) });

// ---- edit ops (pure: each returns a new draft; the workbench calls nothing else to change a brain) ----

/** A brain being edited: the genome plus the next neuron id, so ids are never reused after a delete. */
export interface Draft { genome: Genome; nextId: number }

export type EditRefusal =
  | 'same' // a wire from a node to itself
  | 'into-car' // a wire ending on an input pin
  | 'from-wheel' // a wire starting at a wheel
  | 'unknown' // an id that is not on the board
  | 'backward' // not to a later layer
  | 'duplicate'
  | 'layer-full' // CONFIG.brain.maxPerLayer
  | 'max-layers'; // CONFIG.brain.maxLayers

export type EditResult = { ok: true; draft: Draft; id?: string } | { ok: false; reason: EditRefusal };

const idNum = (id: string): number => Number(id.slice(1));

export function draftOf(g: Genome, nextId = 1): Draft {
  validateGenome(g);
  let next = nextId;
  for (const n of g.spec.nodes) next = Math.max(next, idNum(n.id) + 1);
  return { genome: g, nextId: next };
}

/** Build a draft from a spec and per-wire weights, dropping wires whose ends are gone or no longer forward. */
function rebuild(spec: BrainSpec, w: number[], nextId: number): Draft {
  const ids = new Set(spec.nodes.map((n) => n.id));
  const known = (id: string) => inputIdx(id) !== undefined || outputIdx(id) !== undefined || ids.has(id);
  const conns: ConnSpec[] = [], ws: number[] = [];
  spec.conns.forEach((c, k) => {
    if (known(c.from) && known(c.to) && depthOf(spec, c.from) < depthOf(spec, c.to)) { conns.push(c); ws.push(w[k]); }
  });
  const genome = { spec: { ...spec, conns }, w: ws };
  validateGenome(genome);
  return { genome, nextId };
}

/** Why a wire from → to would be refused, or null if it is allowed. */
export function wireCheck(spec: BrainSpec, from: string, to: string): EditRefusal | null {
  if (from === to) return 'same';
  if (inputIdx(to) !== undefined) return 'into-car';
  if (outputIdx(from) !== undefined) return 'from-wheel';
  const has = (id: string) => inputIdx(id) !== undefined || outputIdx(id) !== undefined || spec.nodes.some((n) => n.id === id);
  if (!has(from) || !has(to)) return 'unknown';
  if (depthOf(spec, from) >= depthOf(spec, to)) return 'backward';
  if (spec.conns.some((c) => c.from === from && c.to === to)) return 'duplicate';
  return null;
}

/** New wires start at weight 0 (ruling 2026-10-30), so the trained behaviour is unchanged until retraining. */
export function addWire(d: Draft, from: string, to: string): EditResult {
  const g = d.genome, why = wireCheck(g.spec, from, to);
  if (why) return { ok: false, reason: why };
  return { ok: true, draft: rebuild({ ...g.spec, conns: [...g.spec.conns, { from, to }] }, [...g.w, 0], d.nextId) };
}

export function removeWire(d: Draft, from: string, to: string): Draft {
  const g = d.genome, keep = g.spec.conns.map((c) => !(c.from === from && c.to === to));
  return rebuild({ ...g.spec, conns: g.spec.conns.filter((_, k) => keep[k]) }, g.w.filter((_, k) => keep[k]), d.nextId);
}

/** Remove every wire touching a pin or neuron. */
export function unplug(d: Draft, id: string): Draft {
  const g = d.genome, keep = g.spec.conns.map((c) => c.from !== id && c.to !== id);
  return rebuild({ ...g.spec, conns: g.spec.conns.filter((_, k) => keep[k]) }, g.w.filter((_, k) => keep[k]), d.nextId);
}

export function clearWires(d: Draft): Draft {
  return rebuild({ ...d.genome.spec, conns: [] }, [], d.nextId);
}

export function addNeuron(d: Draft, layer: number, act: Act = 'tanh'): EditResult {
  const s = d.genome.spec;
  if (!Number.isInteger(layer) || layer < 1 || layer > s.layers) return { ok: false, reason: 'unknown' };
  if (s.nodes.filter((n) => n.layer === layer).length >= CONFIG.brain.maxPerLayer) return { ok: false, reason: 'layer-full' };
  const id = `n${d.nextId}`;
  const draft = rebuild({ ...s, nodes: [...s.nodes, { id, layer, act, dropout: 0 }] }, d.genome.w, d.nextId + 1);
  return { ok: true, draft, id };
}

/** Add a hidden line after the last one, with one neuron in it. Wires into the wheels now span one more layer. */
export function addLayer(d: Draft, act: Act = 'tanh'): EditResult {
  const s = d.genome.spec;
  if (s.layers >= CONFIG.brain.maxLayers) return { ok: false, reason: 'max-layers' };
  const grown = rebuild({ ...s, layers: s.layers + 1 }, d.genome.w, d.nextId);
  return addNeuron(grown, s.layers + 1, act);
}

/**
 * Delete a neuron and its wires. If that empties its line and there is more than one line, the line goes too and
 * later lines move down one (every wire still runs forward, so none is lost to the renumbering).
 */
export function removeNeuron(d: Draft, id: string): Draft {
  const s = d.genome.spec, n = s.nodes.find((m) => m.id === id);
  if (!n) return d;
  let nodes = s.nodes.filter((m) => m.id !== id), layers = s.layers;
  if (layers > 1 && !nodes.some((m) => m.layer === n.layer)) {
    nodes = nodes.map((m) => (m.layer > n.layer ? { ...m, layer: m.layer - 1 } : m));
    layers--;
  }
  return rebuild({ ...s, layers, nodes }, d.genome.w, d.nextId);
}

export function setAct(d: Draft, id: string, act: Act): Draft {
  const s = d.genome.spec;
  return rebuild({ ...s, nodes: s.nodes.map((m) => (m.id === id ? { ...m, act } : m)) }, d.genome.w, d.nextId);
}

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
