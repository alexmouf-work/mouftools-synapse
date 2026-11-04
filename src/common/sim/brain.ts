// Brain v2: spec → compiled net, evaluation, the energy load of a tick, edit ops, canonical genome JSON and its hash.
// Node order: the sense cells (by sense, then cell), hidden neurons layer by layer, the four wheels (tanh). Each node
// sums its incoming wires in canonical wire order. Every node has a firing rate 0..1 (rateOf), which the energy rule
// charges and the views flash.
import { CONFIG, type Act } from '../config';
import { sigmoid, tanh } from '../fmath';
import { Hasher } from '../hash';
import { energyRefusal, nodeCoefs, type Mode } from './energy';
import { columns, inputIds, OUTPUTS, SENSE_IDS, validateGenome, validateSpec, wireCount, wireList, defaultSpec, type BrainSpec, type Genome, type SenseId } from './spec';

export const ACT_CODE: Record<Act, number> = { relu: 1, sigmoid: 2, tanh: 3, linear: 5 };
const TANH = ACT_CODE.tanh;
export const SENSE_CODE: Record<SenseId, number> = { boundary: 0, landmark: 1, hd: 2, grid: 3, speed: 4 };

export interface Net {
  spec: BrainSpec;
  nIn: number;
  nHidden: number;
  nNodes: number;
  /** First wheel node (wheels are outStart .. outStart + 3). */
  outStart: number;
  /** Per node: transfer code (inputs −1). */
  act: Int8Array;
  /** Per input node: which sense (SENSE_CODE), and the cell's k and n. */
  sense: Uint8Array;
  cellK: Int32Array;
  cellN: Int32Array;
  /** Incoming wires of node d: compiled wires inStart[d] .. inStart[d + 1]. */
  inStart: Int32Array;
  from: Int32Array;
  w: Float64Array;
  /** compiled wire → canonical wire index. */
  specIdx: Int32Array;
  /** Per node: energy (% of the supply) per unit of firing rate, its own cost plus the wires it drives. */
  coef: Float64Array;
  /** Node ids, in node order. */
  ids: string[];
}

export function compile(g: Genome): Net {
  validateGenome(g);
  const s = g.spec, C = columns(s), ids = C.flat();
  const nIn = C[0].length, nNodes = ids.length, outStart = nNodes - OUTPUTS.length;
  const index = new Map(ids.map((id, i) => [id, i]));
  const act = new Int8Array(nNodes).fill(-1);
  let d = nIn;
  s.layers.forEach((l) => { for (let k = 0; k < l.n; k++) act[d++] = ACT_CODE[l.fn]; });
  for (let o = 0; o < OUTPUTS.length; o++) act[outStart + o] = TANH;
  const sense = new Uint8Array(nIn), cellK = new Int32Array(nIn), cellN = new Int32Array(nIn);
  inputIds(s).forEach((id, i) => { const [, sid, k] = id.split(':'); sense[i] = SENSE_CODE[sid as SenseId]; cellK[i] = Number(k); cellN[i] = s.senses[sid as SenseId]; });
  const wl = wireList(s), m = wl.length;
  const toNode = wl.map(([, b]) => index.get(b) as number);
  const order = wl.map((_, k) => k).sort((a, b) => (toNode[a] - toNode[b]) || (a - b));
  const from = new Int32Array(m), w = new Float64Array(m), specIdx = new Int32Array(m), inStart = new Int32Array(nNodes + 1);
  order.forEach((k, c) => { from[c] = index.get(wl[k][0]) as number; w[c] = g.w[k]; specIdx[c] = k; inStart[toNode[k] + 1]++; });
  for (let n = 0; n < nNodes; n++) inStart[n + 1] += inStart[n];
  return {
    spec: s, nIn, nHidden: outStart - nIn, nNodes, outStart, act, sense, cellK, cellN, inStart, from, w, specIdx,
    coef: Float64Array.from(nodeCoefs(s)), ids,
  };
}

/** Replace the weights of a compiled net in place (same spec). */
export function setWeights(net: Net, wCanon: ArrayLike<number>): void {
  for (let c = 0; c < net.w.length; c++) net.w[c] = wCanon[net.specIdx[c]];
}

export function transfer(code: number, x: number): number {
  switch (code) {
    case 1: return x < 0 ? 0 : x > CONFIG.brain.reluCap ? CONFIG.brain.reluCap : x;
    case 2: return sigmoid(x);
    case 3: return tanh(x);
    case 5: return x < -1 ? -1 : x > 1 ? 1 : x; // linear: z itself, kept to −1..1
    default: throw new Error(`brain: transfer code ${code}`);
  }
}

/** f′(z), for the gradient trainers. */
export function transferSlope(code: number, z: number): number {
  switch (code) {
    case 1: return z > 0 && z < CONFIG.brain.reluCap ? 1 : 0;
    case 2: { const y = sigmoid(z); return y * (1 - y); }
    case 3: { const y = tanh(z); return 1 - y * y; }
    case 5: return z > -1 && z < 1 ? 1 : 0;
    default: throw new Error(`brain: no slope for transfer code ${code}`);
  }
}

/** A node's firing rate 0..1 from its output: tanh and linear map −1..1, ReLU saturates at 1, sigmoid is its own. */
export function rateOf(code: number, y: number): number {
  const r = code === 2 ? y : code === 1 ? y : (y + 1) / 2;
  return r < 0 ? 0 : r > 1 ? 1 : r;
}
/** A function's resting rate (no input). */
export const restRate = (fn: Act): number => rateOf(ACT_CODE[fn], transfer(ACT_CODE[fn], 0));

/**
 * One brain tick. `inputs` holds the sense values (nIn); `vals` receives every node's output. Returns the tick's
 * energy load (% of the supply): Σ coef × rate over every node.
 */
export function evalNet(net: Net, inputs: ArrayLike<number>, vals: Float64Array): number {
  const { nIn, nNodes, act, inStart, from, w, coef, sense } = net;
  let load = 0;
  for (let i = 0; i < nIn; i++) {
    const v = inputs[i];
    vals[i] = v;
    load += coef[i] * (sense[i] === SENSE_CODE.hd ? (v + 1) / 2 : v);
  }
  for (let d = nIn; d < nNodes; d++) {
    let s = 0;
    for (let c = inStart[d], e = inStart[d + 1]; c < e; c++) s += w[c] * vals[from[c]];
    const y = transfer(act[d], s);
    vals[d] = y;
    load += coef[d] * rateOf(act[d], y);
  }
  return load;
}

/** Firing rate of node d from its value (inputs by their sense). */
export const nodeRate = (net: Net, d: number, v: number): number =>
  d < net.nIn ? (net.sense[d] === SENSE_CODE.hd ? (v + 1) / 2 : v) : rateOf(net.act[d], v);

/** The `signal` probe channel: per canonical wire, sender output × weight. */
export function signalOf(net: Net, vals: ArrayLike<number>, out = new Float64Array(net.w.length)): Float64Array {
  for (let k = 0; k < net.w.length; k++) out[net.specIdx[k]] = vals[net.from[k]] * net.w[k];
  return out;
}

export const zeroGenome = (spec: BrainSpec): Genome => ({ spec, w: new Array(wireCount(spec)).fill(0) });
export const defaultGenome = (): Genome => zeroGenome(defaultSpec());

// ---- edit ops (pure; the designer calls nothing else to change a brain). Any edit leaves an untrained brain: its
// weights go back to 0 (ruling 2026-11-04: wires are grey until trained, and any edit returns them to grey). ----

export type EditRefusal = 'full' | 'empty' | 'last-layer' | 'energy';
export type EditResult = { ok: true; genome: Genome } | { ok: false; reason: EditRefusal; why?: string };

const clone = (s: BrainSpec): BrainSpec => ({ v: 2, senses: { ...s.senses }, layers: s.layers.map((l) => ({ ...l })) });
function done(s: BrainSpec, mode: Mode): EditResult {
  validateSpec(s);
  const why = energyRefusal(s, mode);
  return why ? { ok: false, reason: 'energy', why } : { ok: true, genome: zeroGenome(s) };
}

export function addSense(g: Genome, id: SenseId, mode: Mode = 'sandbox'): EditResult {
  if (g.spec.senses[id] >= CONFIG.senses[id].max) return { ok: false, reason: 'full' };
  const s = clone(g.spec); s.senses[id]++;
  return done(s, mode);
}
export function removeSense(g: Genome, id: SenseId): EditResult {
  if (g.spec.senses[id] < 1) return { ok: false, reason: 'empty' };
  const s = clone(g.spec); s.senses[id]--;
  return done(s, 'sandbox');
}
/** A new hidden layer at position `at` (0 = right after the senses), with CONFIG.brain.newLayerNeurons tanh neurons. */
export function insertLayer(g: Genome, at: number, mode: Mode = 'sandbox'): EditResult {
  if (g.spec.layers.length >= CONFIG.brain.maxLayers) return { ok: false, reason: 'full' };
  const s = clone(g.spec); s.layers.splice(Math.max(0, Math.min(at, s.layers.length)), 0, { n: CONFIG.brain.newLayerNeurons, fn: 'tanh' });
  return done(s, mode);
}
export function removeLayer(g: Genome, L: number): EditResult {
  if (g.spec.layers.length <= 1) return { ok: false, reason: 'last-layer' };
  const s = clone(g.spec); s.layers.splice(L, 1);
  return done(s, 'sandbox');
}
export function setLayerSize(g: Genome, L: number, n: number, mode: Mode = 'sandbox'): EditResult {
  if (n < 1) return { ok: false, reason: 'empty' };
  if (n > CONFIG.brain.maxPerLayer) return { ok: false, reason: 'full' };
  const s = clone(g.spec); s.layers[L].n = n;
  return done(s, mode);
}
export function setLayerFn(g: Genome, L: number, fn: Act, mode: Mode = 'sandbox'): EditResult {
  const s = clone(g.spec); s.layers[L].fn = fn;
  return done(s, mode);
}

// ---- canonical JSON + hash ----

/** Canonical JSON: fixed key order; JS number formatting round-trips doubles exactly. */
export function genomeToJSON(g: Genome): string {
  const s = g.spec;
  return JSON.stringify({
    spec: { v: 2, senses: Object.fromEntries(SENSE_IDS.map((id) => [id, s.senses[id]])), layers: s.layers.map((l) => ({ n: l.n, fn: l.fn })) },
    w: g.w.map((x) => (Object.is(x, -0) ? 0 : x)),
  });
}

export function genomeFromJSON(json: string): Genome {
  const o = JSON.parse(json) as Genome;
  validateGenome(o);
  return o;
}

export function specHash(s: BrainSpec): string {
  const h = new Hasher().u32(s.v);
  for (const id of SENSE_IDS) h.u32(s.senses[id]);
  h.u32(s.layers.length);
  for (const l of s.layers) h.u32(l.n).str(l.fn);
  return h.hex();
}

/** Over the spec and the weights; −0 hashes as +0, as JSON writes it. */
export function genomeHash(g: Genome): string {
  const h = new Hasher().str(specHash(g.spec)).u32(g.w.length);
  for (const x of g.w) h.f64(x === 0 ? 0 : x);
  return h.hex();
}
