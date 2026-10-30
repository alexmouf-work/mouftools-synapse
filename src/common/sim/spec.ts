// Brain specification: fixed pins, layered hidden neurons, wires. Pins are always on the board (ruling 2026-10-30);
// an input costs energy only while it has a wire. The car is the input layer (depth 0), hidden lines are depths
// 1..layers, the wheels are depth layers + 1. A wire runs to a later depth; its span is the depth gap.
import { ACTS, CONFIG, type Act } from '../config';

export type InputKind = 'eye' | 'road' | 'energy' | 'speed' | 'bias';

export interface InputPin { id: string; label: string; kind: InputKind; /** eyes: degrees clockwise from the nose */ deg?: number }
export interface OutputPin { id: string; label: string }

/** Input order is fixed; it is the order of the compiled net's first nodes. */
export const INPUTS: readonly InputPin[] = [
  { id: 'i:l', label: 'Left', kind: 'eye', deg: -90 },
  { id: 'i:fl', label: 'Front-left', kind: 'eye', deg: -45 },
  { id: 'i:f', label: 'Front', kind: 'eye', deg: 0 },
  { id: 'i:fr', label: 'Front-right', kind: 'eye', deg: 45 },
  { id: 'i:r', label: 'Right', kind: 'eye', deg: 90 },
  { id: 'i:b', label: 'Back', kind: 'eye', deg: 180 },
  { id: 'i:road', label: 'Road ahead', kind: 'road' },
  { id: 'i:energy', label: 'Energy left', kind: 'energy' },
  { id: 'i:spd', label: 'Speed', kind: 'speed' },
  { id: 'i:bias', label: 'Bias', kind: 'bias' },
];
export const EYE_COUNT = 6;
export const IN = { road: 6, energy: 7, speed: 8, bias: 9 } as const;

/** Wheel outputs, −1..+1 each. */
export const OUTPUTS: readonly OutputPin[] = [
  { id: 'o:fl', label: 'Front-left wheel' },
  { id: 'o:fr', label: 'Front-right wheel' },
  { id: 'o:rl', label: 'Rear-left wheel' },
  { id: 'o:rr', label: 'Rear-right wheel' },
];

export interface NodeSpec { id: string; layer: number; act: Act; /** reserved; must be 0 this milestone */ dropout: number }
export interface ConnSpec { from: string; to: string }
export interface BrainSpec { v: 1; layers: number; nodes: NodeSpec[]; conns: ConnSpec[] }
/** Weights aligned to spec.conns. */
export interface Genome { spec: BrainSpec; w: number[] }

const inputIndex = new Map(INPUTS.map((p, i) => [p.id, i]));
const outputIndex = new Map(OUTPUTS.map((p, i) => [p.id, i]));
export const inputIdx = (id: string): number | undefined => inputIndex.get(id);
export const outputIdx = (id: string): number | undefined => outputIndex.get(id);

/** Depth of a pin or neuron in the spec; throws on an unknown id. */
export function depthOf(spec: BrainSpec, id: string): number {
  if (inputIndex.has(id)) return 0;
  if (outputIndex.has(id)) return spec.layers + 1;
  const n = spec.nodes.find((m) => m.id === id);
  if (!n) throw new Error(`spec: unknown id ${id}`);
  return n.layer;
}

/** Throws with the first problem found. */
export function validateSpec(spec: BrainSpec): void {
  const fail = (m: string): never => { throw new Error(`spec: ${m}`); };
  if (spec.v !== 1) fail(`version ${spec.v}`);
  if (!Number.isInteger(spec.layers) || spec.layers < 1 || spec.layers > CONFIG.brain.maxLayers) fail(`layers ${spec.layers}`);
  const ids = new Set<string>();
  const perLayer = new Array(spec.layers + 1).fill(0);
  for (const n of spec.nodes) {
    if (!/^n[1-9]\d*$/.test(n.id)) fail(`bad neuron id ${n.id}`);
    if (ids.has(n.id)) fail(`duplicate neuron ${n.id}`);
    ids.add(n.id);
    if (!Number.isInteger(n.layer) || n.layer < 1 || n.layer > spec.layers) fail(`${n.id} on layer ${n.layer}`);
    if (!ACTS.includes(n.act)) fail(`${n.id} transfer function ${n.act}`);
    if (n.dropout !== 0) fail(`${n.id} dropout ${n.dropout} (reserved, must be 0)`);
    if (++perLayer[n.layer] > CONFIG.brain.maxPerLayer) fail(`layer ${n.layer} has more than ${CONFIG.brain.maxPerLayer} neurons`);
  }
  const wires = new Set<string>();
  for (const c of spec.conns) {
    const fromOk = inputIndex.has(c.from) || ids.has(c.from);
    const toOk = outputIndex.has(c.to) || ids.has(c.to);
    if (!fromOk) fail(`wire from ${c.from}`);
    if (!toOk) fail(`wire to ${c.to}`);
    if (depthOf(spec, c.from) >= depthOf(spec, c.to)) fail(`wire ${c.from} → ${c.to} does not run to a later layer`);
    const k = c.from + '|' + c.to;
    if (wires.has(k)) fail(`duplicate wire ${k}`);
    wires.add(k);
  }
}

export function validateGenome(g: Genome): void {
  validateSpec(g.spec);
  if (g.w.length !== g.spec.conns.length) throw new Error(`genome: ${g.w.length} weights for ${g.spec.conns.length} wires`);
  for (const w of g.w) {
    if (!Number.isFinite(w) || Math.abs(w) > CONFIG.brain.weightCap) throw new Error(`genome: weight ${w}`);
  }
}
