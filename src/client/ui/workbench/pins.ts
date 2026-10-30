// Board-only data for the fixed pins: where each sits on the car, its icon kind, and the words the side panel shows.
// The pins themselves (ids, order, labels, kinds) come from src/common/sim/spec.ts; costs from energy.ts.
import { CONFIG } from '../../../common/config';
import { INPUTS, OUTPUTS, type InputKind } from '../../../common/sim/spec';

export interface InPinUi { id: string; label: string; k: InputKind; deg: number; ring?: number; at?: [number, number]; corner?: boolean }
export interface OutPinUi { id: string; label: string; short: string; k: 'wheel'; at: [number, number] }

// Positions in car units: x across (−1 left side … +1 right side), y along (−1 nose … +1 tail).
const PLACE: Record<string, Partial<InPinUi>> = {
  'i:road': { at: [0, -0.62] },
  'i:energy': { at: [0, -0.08] },
  'i:spd': { at: [0, 0.36] },
  'i:bias': { corner: true },
};
export const IN_UI: InPinUi[] = INPUTS.map((p) => ({
  id: p.id, label: p.label, k: p.kind, deg: p.deg ?? 0,
  ...(p.kind === 'eye' ? { ring: p.deg } : PLACE[p.id]),
}));

const WHEEL_AT: Record<string, [number, number]> = { 'o:fl': [-1, -0.56], 'o:fr': [1, -0.56], 'o:rl': [-1, 0.56], 'o:rr': [1, 0.56] };
export const OUT_UI: OutPinUi[] = OUTPUTS.map((o) => ({ id: o.id, label: o.label, short: o.label.replace(' wheel', ''), k: 'wheel', at: WHEEL_AT[o.id] }));

export const pinOf = (id: string): InPinUi | OutPinUi | undefined => IN_UI.find((p) => p.id === id) ?? OUT_UI.find((p) => p.id === id);

const S = CONFIG.sensors;
export const ABOUT: Record<InputKind | 'wheel', string> = {
  eye: `Distance to the nearest wall in this direction. 1 = touching, 0 = nothing within ${S.eyeRange} m.`,
  road: `Which way the road bends ${S.roadAhead} m ahead, −1 left to +1 right.`,
  energy: 'How much of the energy budget is left this tick, 0 to 1. Lets the brain notice it is close to static.',
  speed: 'How fast the car is going, 0 to 1.',
  bias: 'Always 1. Lets a neuron fire with no other input.',
  wheel: 'This wheel’s speed, from −1 (full reverse) to +1 (full forward). Same speed on both sides drives straight; a difference turns.',
};

export const FX = {
  step: { n: 'Step', g: 'M-8 4 H0 V-4 H8', d: 'On or off. Cheapest, but it has no slope, so backprop can’t learn through it.' },
  relu: { n: 'ReLU', g: 'M-8 3 H0 L8 -5', d: 'Zero below 0, a straight line above. Cheap. It can’t go negative, so it can’t reverse a wheel alone.' },
  sigmoid: { n: 'Sigmoid', g: 'M-8 4 C-2 4 2 -4 8 -4', d: 'Smooth from 0 to 1. Dearer to compute.' },
  tanh: { n: 'Tanh', g: 'M-8 5 C-2 5 2 -5 8 -5', d: 'Smooth from −1 to 1, so it can drive a wheel forwards or backwards. Dearer to compute.' },
} as const;
