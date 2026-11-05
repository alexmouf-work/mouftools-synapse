// Brain v2: spec → compiled net, evaluation, the energy load of a tick, edit ops, canonical genome JSON and its hash.
// Node order: the sense cells (by sense, then cell), hidden neurons layer by layer, the four wheels (tanh). Each node
// sums its bias and its incoming wires in canonical wire order: z = b + Σ w·x (built-in biases, 2026-11-04). Every node has a firing rate 0..1 (rateOf), which the energy rule
// charges and the views flash.
import { CONFIG, type Act } from '../config';
import { log, PI, sigmoid, tanh, wrapAngle } from '../fmath';
import { Hasher } from '../hash';
import { energyRefusal, nodeCoefs, type Rule } from './energy';
import { biasIndex, columns, FIELD_PARAMS, fieldCount, fieldIndex, inputIds, OUTPUTS, paramCount, SENSE_IDS, validateGenome, validateSpec, wireList, defaultSpec, type BrainSpec, type Genome, type SenseId } from './spec';
import { FIELD_DIR_DEG, FIELD_LOG2, fieldOf, fieldWidthDeg, gridOf, GRID_ROT, GRID_SHIFT_M, gridScale, HD_STEP, hdOf, hdPreferred, SPEED_LOG2, speedGainOf, spreadDeg } from './senses';

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
  /** Per node: its bias (inputs 0); node d's bias is parameter wires + (d − nIn). */
  bias: Float64Array;
  /** Number of wires (the parameter vector's biases start here). */
  wires: number;
  /** Number of field parameters (they follow the biases); per input cell, where its own start. */
  fields: number;
  fieldAt: Int32Array;
  /**
   * Per input cell, its learned tuning (4 slots; senses.ts): boundary and landmark [direction °, width °, range m],
   * head direction [preferred angle], grid [scale m, offset x m, offset y m, orientation], speed [gain]; tuneD holds
   * d(tuning)/d(parameter) for each slot (0 where a bound clamps it), for backprop; gridPhase the grid cell's phase.
   */
  tune: Float64Array;
  tuneD: Float64Array;
  gridPhase: Float64Array;
  /** Scratch: per input, the last reading's strongest boundary ray (distance, angular weight); sensors writes it. */
  ray: Float64Array;
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
  const bias = new Float64Array(nNodes);
  for (let d = nIn; d < nNodes; d++) bias[d] = g.w[m + d - nIn];
  const fieldAt = Int32Array.from(inputIds(s), (id) => fieldIndex(s, id));
  const net: Net = {
    spec: s, nIn, nHidden: outStart - nIn, nNodes, outStart, act, sense, cellK, cellN, inStart, from, w, specIdx, bias, wires: m,
    fields: fieldCount(s), fieldAt, tune: new Float64Array(4 * nIn), tuneD: new Float64Array(4 * nIn), gridPhase: new Float64Array(nIn), ray: new Float64Array(2 * nIn),
    coef: Float64Array.from(nodeCoefs(s)), ids,
  };
  retune(net, g.w);
  return net;
}

const SENSE_OF = SENSE_IDS; // SENSE_CODE order
/** Decode every input cell's tuning from its field parameters (senses.ts is the one definition). */
function retune(net: Net, params: ArrayLike<number>): void {
  const { tune, tuneD } = net;
  for (let i = 0; i < net.nIn; i++) {
    const id = SENSE_OF[net.sense[i]], k = net.cellK[i], n = net.cellN[i], a = net.fieldAt[i], q = 4 * i;
    if (id === 'boundary' || id === 'landmark') {
      const f = fieldOf(id, k, n, params[a], params[a + 1], params[a + 2]);
      tune[q] = f.dirDeg; tune[q + 1] = f.widthDeg; tune[q + 2] = f.rangeM;
      tuneD[q] = FIELD_DIR_DEG; tuneD[q + 1] = f.dWidth; tuneD[q + 2] = f.dRange;
    } else if (id === 'hd') {
      tune[q] = hdOf(k, n, params[a]); tuneD[q] = HD_STEP;
    } else if (id === 'grid') {
      const gr = gridOf(k, params[a], params[a + 1], params[a + 2], params[a + 3]);
      tune[q] = gr.scale; tune[q + 1] = gr.ox; tune[q + 2] = gr.oy; tune[q + 3] = gr.rot; net.gridPhase[i] = gr.phase;
      tuneD[q] = gr.dScale; tuneD[q + 1] = GRID_SHIFT_M; tuneD[q + 2] = GRID_SHIFT_M; tuneD[q + 3] = GRID_ROT;
    } else {
      const gain = speedGainOf(params[a]);
      tune[q] = gain; tuneD[q] = gain * LN2 * SPEED_LOG2;
    }
  }
}
const LN2 = 0.6931471805599453;

/** Replace the parameters of a compiled net in place (same spec): wire weights, biases, then the fields. */
export function setWeights(net: Net, params: ArrayLike<number>): void {
  for (let c = 0; c < net.w.length; c++) net.w[c] = params[net.specIdx[c]];
  for (let d = net.nIn; d < net.nNodes; d++) net.bias[d] = params[net.wires + d - net.nIn];
  retune(net, params);
}

/** Wires and biases: the parameters every edit resets (the fields after them are kept, see carryFields). */
export const weightCount = (s: BrainSpec): number => paramCount(s) - fieldCount(s);

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
  const { nIn, nNodes, act, inStart, from, w, coef, sense, bias } = net;
  let load = 0;
  for (let i = 0; i < nIn; i++) {
    const v = inputs[i];
    vals[i] = v;
    load += coef[i] * inRate(sense[i], v);
  }
  for (let d = nIn; d < nNodes; d++) {
    let s = bias[d];
    for (let c = inStart[d], e = inStart[d + 1]; c < e; c++) s += w[c] * vals[from[c]];
    const y = transfer(act[d], s);
    vals[d] = y;
    load += coef[d] * rateOf(act[d], y);
  }
  return load;
}

/** An input cell's firing rate from its value: head direction maps −1..1 to 0..1; the signed speed cell fires at its
 * size either way (ruling 2026-11-05: negative going backwards, and it costs the same); the rest are 0..1 already. */
const inRate = (code: number, v: number): number => (code === SENSE_CODE.hd ? (v + 1) / 2 : code === SENSE_CODE.speed && v < 0 ? -v : v);
/** Firing rate of node d from its value (inputs by their sense). */
export const nodeRate = (net: Net, d: number, v: number): number =>
  d < net.nIn ? inRate(net.sense[d], v) : rateOf(net.act[d], v);

/** The `signal` probe channel, per parameter: each wire's sender output × weight, then each bias (its constant push). */
export function signalOf(net: Net, vals: ArrayLike<number>, out = new Float64Array(net.wires + net.nNodes - net.nIn + net.fields)): Float64Array {
  for (let k = 0; k < net.w.length; k++) out[net.specIdx[k]] = vals[net.from[k]] * net.w[k];
  for (let d = net.nIn; d < net.nNodes; d++) out[net.wires + d - net.nIn] = net.bias[d];
  return out;
}

export const zeroGenome = (spec: BrainSpec): Genome => ({ spec, w: new Array(paramCount(spec)).fill(0) });
export const defaultGenome = (): Genome => zeroGenome(defaultSpec());

// ---- edit ops (pure; the designer calls nothing else to change a brain). In the sandbox any edit leaves an untrained
// brain: its weights go back to 0 (ruling 2026-11-04: wires are grey until trained, and any edit returns them to grey).
// Under a match rule (vs CPU's rounds, rounds plan 2026-11-05 §1) the weights carry over: every wire and bias whose
// cells are still there keeps its value, an added cell's start at 0, a removed cell's go. The input cells' learned
// fields stay either way (plan §3ad): each keeps its field where it is; a new cell of a sense that has learned fields
// goes in the widest gap between them; a sense that never learned keeps the even spread. ----

export type EditRefusal = 'full' | 'empty' | 'last-layer' | 'energy';
export type EditResult = { ok: true; genome: Genome } | { ok: false; reason: EditRefusal; why?: string };

const clone = (s: BrainSpec): BrainSpec => ({ v: 2, senses: { ...s.senses }, layers: s.layers.map((l) => ({ ...l })) });
/** Old hidden layer index → its index after the edit (−1: removed). */
type LayerMap = (L: number) => number;
const SAME: LayerMap = (L) => L;
/** `check` false for removals: taking cells away is never refused. */
function done(s: BrainSpec, rule: Rule, from: Genome, lm: LayerMap = SAME, check = true): EditResult {
  validateSpec(s);
  const why = check ? energyRefusal(s, rule) : null;
  if (why) return { ok: false, reason: 'energy', why };
  const g = zeroGenome(s);
  carryFields(from, g);
  if (rule !== 'sandbox') carryWeights(from, g, lm);
  return { ok: true, genome: g };
}

/** Copy old's wire weights and biases into g (a fresh genome of the edited spec) wherever both ends are still there. */
export function carryWeights(old: Genome, g: Genome, lm: LayerMap = SAME): void {
  const ren = (id: string): string | null => {
    if (id[0] !== 'h') return id;
    const c = id.indexOf(':'), L = lm(Number(id.slice(1, c)));
    return L < 0 ? null : `h${L}${id.slice(c)}`;
  };
  const at = new Map<string, number>();
  wireList(g.spec).forEach(([a, b], k) => at.set(`${a}>${b}`, k));
  wireList(old.spec).forEach(([a, b], k) => {
    const A = ren(a), B = ren(b), j = A !== null && B !== null ? at.get(`${A}>${B}`) : undefined;
    if (j !== undefined) g.w[j] = old.w[k];
  });
  const nodes = new Set(columns(g.spec).slice(1).flat());
  for (const id of columns(old.spec).slice(1).flat()) {
    const n = ren(id);
    if (n !== null && nodes.has(n)) g.w[biasIndex(g.spec, n)] = old.w[biasIndex(old.spec, id)];
  }
}

const CAP = (): number => CONFIG.brain.weightCap;
const clampP = (p: number): number => Math.max(-CAP(), Math.min(CAP(), p));
const log2 = (x: number): number => log(x) / LN2;
const wrapDeg = (d: number): number => d - 360 * Math.round(d / 360);

/** Absolute tunings of one sense's cells in `g` (direction °, width °, range m for fields; angle for hd; …). */
function absFields(g: Genome, id: SenseId): number[][] {
  const n = g.spec.senses[id], out: number[][] = [];
  for (let k = 0; k < n; k++) {
    const a = fieldIndex(g.spec, `i:${id}:${k}`), p = g.w.slice(a, a + FIELD_PARAMS[id]);
    if (id === 'boundary' || id === 'landmark') { const f = fieldOf(id, k, n, p[0], p[1], p[2]); out.push([f.dirDeg, f.widthDeg, f.rangeM]); }
    else if (id === 'hd') out.push([hdOf(k, n, p[0])]);
    else if (id === 'grid') { const gr = gridOf(k, p[0], p[1], p[2], p[3]); out.push([gr.scale, p[1], p[2], p[3]]); }
    else out.push([p[0]]);
  }
  return out;
}

/** The middle of the widest gap between angles (degrees, on the circle). */
function widestGap(angles: number[]): number {
  if (!angles.length) return 0;
  const a = angles.map(wrapDeg).sort((x, y) => x - y);
  let best = -1, at = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = a[i], hi = i + 1 < a.length ? a[i + 1] : a[0] + 360;
    if (hi - lo > best) { best = hi - lo; at = lo + (hi - lo) / 2; }
  }
  return wrapDeg(at);
}

/** Put old's learned fields into g (a fresh genome of the new spec), re-expressed against the new spec's defaults. */
export function carryFields(old: Genome, g: Genome): void {
  const s = g.spec;
  for (const id of SENSE_IDS) {
    const n = s.senses[id];
    if (!n || !old.spec.senses[id]) continue;
    const o0 = fieldIndex(old.spec, `i:${id}:0`), np = FIELD_PARAMS[id];
    const learned = old.w.slice(o0, o0 + old.spec.senses[id] * np).some((x) => x !== 0);
    if (!learned) continue; // never learned: the even spread, re-tuned for the new count
    const abs = absFields(old, id);
    for (let k = 0; k < n; k++) {
      const a = fieldIndex(s, `i:${id}:${k}`), f = k < abs.length ? abs[k] : null;
      if (id === 'boundary' || id === 'landmark') {
        const dir = f ? f[0] : widestGap(abs.map((x) => x[0]));
        g.w[a] = clampP(wrapDeg(dir - spreadDeg(k, n)) / FIELD_DIR_DEG);
        if (f) {
          g.w[a + 1] = clampP(log2(f[1] / fieldWidthDeg(id, n)) / FIELD_LOG2);
          g.w[a + 2] = clampP(log2(f[2] / (id === 'boundary' ? CONFIG.senses.boundary.rangeM : CONFIG.senses.landmark.rangeM)) / FIELD_LOG2);
        }
      } else if (id === 'hd') {
        const ang = f ? f[0] : (widestGap(abs.map((x) => (x[0] * 180) / PI)) * PI) / 180;
        g.w[a] = clampP(wrapAngle(ang - hdPreferred(k, n)) / HD_STEP);
      } else if (id === 'grid') {
        if (f) { g.w[a] = clampP(log2(f[0] / gridScale(k)) / FIELD_LOG2); g.w[a + 1] = f[1]; g.w[a + 2] = f[2]; g.w[a + 3] = f[3]; }
      } else if (f) g.w[a] = f[0];
    }
  }
}

export function addSense(g: Genome, id: SenseId, rule: Rule = 'sandbox'): EditResult {
  if (g.spec.senses[id] >= CONFIG.senses[id].max) return { ok: false, reason: 'full' };
  const s = clone(g.spec); s.senses[id]++;
  return done(s, rule, g);
}
/** Removes the sense's last cell. */
export function removeSense(g: Genome, id: SenseId, rule: Rule = 'sandbox'): EditResult {
  if (g.spec.senses[id] < 1) return { ok: false, reason: 'empty' };
  const s = clone(g.spec); s.senses[id]--;
  return done(s, rule, g, SAME, false);
}
/** A new hidden layer at position `at` (0 = right after the senses), with CONFIG.brain.newLayerNeurons tanh neurons. */
export function insertLayer(g: Genome, at: number, rule: Rule = 'sandbox'): EditResult {
  if (g.spec.layers.length >= CONFIG.brain.maxLayers) return { ok: false, reason: 'full' };
  const i = Math.max(0, Math.min(at, g.spec.layers.length));
  const s = clone(g.spec); s.layers.splice(i, 0, { n: CONFIG.brain.newLayerNeurons, fn: 'tanh' });
  return done(s, rule, g, (L) => (L >= i ? L + 1 : L));
}
export function removeLayer(g: Genome, L: number, rule: Rule = 'sandbox'): EditResult {
  if (g.spec.layers.length <= 1) return { ok: false, reason: 'last-layer' };
  const s = clone(g.spec); s.layers.splice(L, 1);
  return done(s, rule, g, (k) => (k === L ? -1 : k > L ? k - 1 : k), false);
}
/** Grows or shrinks layer L at its end (shrinking drops its last neurons). */
export function setLayerSize(g: Genome, L: number, n: number, rule: Rule = 'sandbox'): EditResult {
  if (n < 1) return { ok: false, reason: 'empty' };
  if (n > CONFIG.brain.maxPerLayer) return { ok: false, reason: 'full' };
  const s = clone(g.spec); s.layers[L].n = n;
  return done(s, rule, g, SAME, n > g.spec.layers[L].n);
}
export function setLayerFn(g: Genome, L: number, fn: Act, rule: Rule = 'sandbox'): EditResult {
  const s = clone(g.spec); s.layers[L].fn = fn;
  return done(s, rule, g);
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
