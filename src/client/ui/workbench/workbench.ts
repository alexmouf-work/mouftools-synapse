// The workbench: a TypeScript port of the approved mock-up (reference/builder-mockup.html), same look and behaviour.
// The board reads left to right: the car is the input layer, hidden neurons sit in flat lines, the wheels are the
// output line. Every change to the brain is a pure op from src/common/sim/brain.ts; every energy figure comes from
// src/common/sim/energy.ts; the brain is saved after every change.
import { CONFIG, type Act } from '../../../common/config';
import {
  addLayer, addNeuron, addWire, clearWires, draftOf, PRESETS, removeNeuron, removeWire, setAct, unplug, zeroGenome,
  type Draft, type EditRefusal, type PresetName,
} from '../../../common/sim/brain';
import { estimate, noiseLevel, percentOfBudget, sensorCost, upkeepCost } from '../../../common/sim/energy';
import { depthOf, type BrainSpec } from '../../../common/sim/spec';
import { weightStyle } from '../weights';
import { ABOUT, FX, IN_UI, OUT_UI, pinOf, type InPinUi, type OutPinUi } from './pins';
import { DEFAULT_NAME, load, NO_TRAINING, save, type Saved } from './store';

const BUDGET = CONFIG.budget[0];
const MAX_LAYERS = CONFIG.brain.maxLayers;
const NS = 'http://www.w3.org/2000/svg';
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`workbench: #${id} missing`);
  return e as T;
};
type Attrs = Record<string, string | number | null | undefined>;
const el = (t: string, a: Attrs = {}, p?: Element): SVGElement => {
  const e = document.createElementNS(NS, t) as SVGElement;
  for (const k in a) { const v = a[k]; if (v != null) e.setAttribute(k, String(v)); }
  if (p) p.appendChild(e);
  return e;
};
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const pct = (v: number) => `${Math.round(percentOfBudget(v, BUDGET))}%`;

const REFUSED: Record<EditRefusal, string> = {
  'into-car': 'The car only sends signals.',
  backward: 'Signals run left to right, to a later layer.',
  'from-wheel': 'Signals run left to right, to a later layer.',
  same: 'Signals run left to right, to a later layer.',
  duplicate: 'Those two are already wired.',
  unknown: 'That isn’t on the board.',
  'layer-full': `${CONFIG.brain.maxPerLayer === 10 ? 'Ten' : CONFIG.brain.maxPerLayer} neurons per layer is the limit.`,
  'max-layers': `${MAX_LAYERS} hidden layers is the limit.`,
};

// ---- state ----
const loaded = load();
const W: { saved: Saved; sel: string | null; fresh: string | null } = { saved: loaded.saved, sel: null, fresh: null };
const spec = (): BrainSpec => W.saved.draft.genome.spec;
const used = (id: string) => spec().conns.some((c) => c.from === id || c.to === id);
const isPin = (id: string) => id.startsWith('i:') || id.startsWith('o:');
let saveWarned = false;
let active = true; // false while another view (training) is up: the board ignores keys and resizes
let onTrain: (s: Saved) => void = () => toast('Training isn’t available here.');
let onDrive: (s: Saved) => void = () => toast('Driving isn’t available here.');

function commit(draft: Draft, sel: string | null = W.sel, fresh: string | null = null) {
  W.saved = { ...W.saved, draft };
  W.sel = sel && (isPin(sel) || draft.genome.spec.nodes.some((n) => n.id === sel)) ? sel : null;
  W.fresh = fresh;
  persist();
  render();
}
function persist() {
  if (!save(W.saved) && !saveWarned) {
    saveWarned = true;
    toast('This browser won’t keep your brain, so changes last until you close the tab.');
  }
}

// ---- icons, drawn at 0,0 ----
function icon(k: InPinUi['k'], g: Element, deg = 0) {
  const s = { fill: 'none', style: 'stroke:currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  if (k === 'eye') { const a = el('g', { transform: `rotate(${deg})` }, g); el('path', { d: 'M0 6 V-6 M-4 -2 L0 -6 L4 -2', ...s }, a); }
  if (k === 'speed') { el('path', { d: 'M-6 3 A6.5 6.5 0 1 1 6 3', ...s }, g); el('path', { d: 'M0 1 L4 -3', ...s }, g); }
  if (k === 'road') el('path', { d: 'M-5 6 C-5 0 0 -2 5 -6 M1 -6 H5 V-2', ...s }, g);
  if (k === 'energy') el('path', { d: 'M1 -7 L-4 1 H0 L-1 7 L4 -1 H0 Z', ...s }, g);
  if (k === 'bias') el('text', { y: 4.5, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 700, style: 'fill:currentColor', 'font-family': 'IBM Plex Mono, monospace' }, g).textContent = '1';
}
function wheelIcon(g: Element, at: [number, number]) { // tiny car with this wheel lit
  el('rect', { x: -3.5, y: -7.5, width: 7, height: 15, rx: 2.5, style: 'fill:none;stroke:currentColor', 'stroke-width': 1.2, opacity: 0.5 }, g);
  for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const lit = x === at[0] && Math.sign(y) === Math.sign(at[1]);
    el('rect', { x: x * 5.5 - 1.5, y: y * 4.2 - 2.6, width: 3, height: 5.2, rx: 1, style: 'fill:currentColor;stroke:none', opacity: lit ? 1 : 0.25 }, g);
  }
}

// ---- board ----
type Pt = { x: number; y: number };
type Placed = Pt & ({ side: 'in'; pin: InPinUi } | { side: 'out'; pin: OutPinUi } | { side: 'mid'; n: BrainSpec['nodes'][number] });
interface Line { L: number; x: number; top: number; bottom: number; n: number; plus: boolean }
const svg = $('net') as unknown as SVGSVGElement;
let P = new Map<string, Placed>();
let box = { w: 800, h: 500 };
let car = { cx: 0, cy: 0, W: 0, H: 0, rx: 0, ry: 0 };
let lines: Line[] = [];
let drag: { id: string; moved: boolean; start: Pt } | null = null;
const RAD = { in: 15, out: 15 };
let NR = 17; // neuron radius: 17 as in the mock-up, smaller only when a full line would not fit
let compactHeads = false; // lines too close for "HIDDEN n" each: one "HIDDEN LAYERS" heading and a number per line

function layout() {
  const r = svg.getBoundingClientRect(); box = { w: Math.max(r.width, 320), h: Math.max(r.height, 280) };
  svg.setAttribute('viewBox', `0 0 ${box.w} ${box.h}`);
  const H = Math.min(box.h * 0.6, box.w * 0.28), Wd = H * 0.46;
  const rx = Wd / 2 + 56, ry = H / 2 + 30;
  car = { cx: Math.max(rx + 34, box.w * 0.17), cy: box.h / 2 + 4, W: Wd, H, rx, ry };
  P = new Map();
  const at = ([x, y]: [number, number]) => ({ x: car.cx + x * Wd / 2, y: car.cy + y * H / 2 });
  for (const p of IN_UI) {
    let q: Pt;
    if (p.ring !== undefined) { const t = p.ring * Math.PI / 180; q = { x: car.cx + Math.sin(t) * rx, y: car.cy - Math.cos(t) * ry }; }
    else if (p.corner) q = { x: car.cx - rx, y: car.cy + ry };
    else q = at(p.at as [number, number]);
    P.set(p.id, { ...q, pin: p, side: 'in' });
  }
  const s = spec();
  const outX = box.w - 130;
  let xa = car.cx + rx + 90, xb = Math.max(xa, outX - 170);
  // narrow boards (landscape phones) with several lines: spread the lines over all the room between car and wheels
  if (s.layers > 1 && (xb - xa) / (s.layers - 1) < 64) { xa = car.cx + rx + 56; xb = outX - 90; }
  compactHeads = s.layers > 1 && (xb - xa) / (s.layers - 1) < 76;
  const gap = Math.min(64, (box.h - 150) / 3);
  OUT_UI.forEach((o, k) => P.set(o.id, { x: outX, y: car.cy + (k - 1.5) * gap, pin: o, side: 'out' }));
  // The palette sits over the board's bottom-right corner: a line whose ⊕ would land under it is kept above it.
  const pr = $('addN').parentElement!.getBoundingClientRect();
  const palLeft = pr.left - r.left, palTop = pr.top - r.top;
  const firstY = car.cy - (box.h - 150) / 2, lastY = car.cy + (box.h - 150) / 2; // the mock-up's node band
  lines = [];
  const plan = Array.from({ length: s.layers }, (_, k) => {
    const L = k + 1, x = s.layers === 1 ? (xa + xb) / 2 : xa + (xb - xa) * k / (s.layers - 1);
    const list = s.nodes.filter((n) => n.layer === L);
    const plus = list.length < CONFIG.brain.maxPerLayer; // a full line has no ⊕
    const limit = plus && x + 11 > palLeft - 6 ? Math.min(lastY, palTop - 6 - 11 - 48) : lastY;
    const step = Math.min(56, Math.max(limit - firstY, 0) / Math.max(list.length - 1, 1));
    const half = step * (list.length - 1) / 2;
    return { L, x, list, plus, step, mid: Math.min(car.cy, limit - half) };
  });
  NR = clamp(Math.min(...plan.map((p) => p.step)) * 0.46, 6, 17);
  for (const { L, x, list, plus, step, mid } of plan) {
    const top = mid - step * (list.length - 1) / 2;
    list.forEach((n, k) => P.set(n.id, { x, y: top + k * step, side: 'mid', n }));
    lines.push({ L, x, top: top - 34, bottom: top + step * Math.max(list.length - 1, 0) + 34, n: list.length, plus });
  }
}
function drawCar(g: Element) {
  const { cx, cy, W: Wd, H } = car; const st = 'fill:var(--car);fill-opacity:.1;stroke:var(--car);stroke-opacity:.35';
  const w = Wd / 2, h = H / 2;
  el('path', { d: `M ${cx - w * 0.78} ${cy - h} Q ${cx} ${cy - h * 1.08} ${cx + w * 0.78} ${cy - h} L ${cx + w} ${cy - h * 0.55} L ${cx + w} ${cy + h * 0.86} Q ${cx + w} ${cy + h} ${cx + w * 0.8} ${cy + h} L ${cx - w * 0.8} ${cy + h} Q ${cx - w} ${cy + h} ${cx - w} ${cy + h * 0.86} L ${cx - w} ${cy - h * 0.55} Z`, style: st, 'stroke-width': 1.5 }, g);
  el('path', { d: `M ${cx - w * 0.6} ${cy - h * 0.32} Q ${cx} ${cy - h * 0.46} ${cx + w * 0.6} ${cy - h * 0.32} L ${cx + w * 0.52} ${cy + h * 0.2} L ${cx - w * 0.52} ${cy + h * 0.2} Z`, style: 'fill:var(--car);fill-opacity:.12;stroke:var(--car);stroke-opacity:.25' }, g);
  for (const [sx, sy] of [[-1, -0.56], [1, -0.56], [-1, 0.56], [1, 0.56]]) el('rect', { x: cx + sx * w - Wd * 0.13, y: cy + sy * h - H * 0.11, width: Wd * 0.26, height: H * 0.22, rx: Wd * 0.06, style: 'fill:var(--car);fill-opacity:.22;stroke:var(--car);stroke-opacity:.35' }, g);
}
function heading(g: Element, x: number, y: number, text: string) {
  el('text', { x, y, 'text-anchor': 'middle', 'font-size': 11, 'letter-spacing': '1.2', style: 'fill:var(--muted)', 'font-weight': 700, 'font-family': 'Atkinson Hyperlegible, sans-serif' }, g).textContent = text;
}
function drawFrame(g: Element) {
  const top = 20;
  heading(g, car.cx, top, 'INPUT LAYER · THE CAR');
  // the projection: the car's plane narrowing onto the first hidden line
  const first = lines[0];
  if (first) {
    const x0 = car.cx + car.rx + 18, y0 = car.cy - car.ry - 14, y1 = car.cy + car.ry + 14;
    el('path', { d: `M ${x0} ${y0} L ${first.x - 26} ${first.top} L ${first.x - 26} ${first.bottom} L ${x0} ${y1} Z`, style: 'fill:var(--accent);fill-opacity:.045;stroke:var(--accent);stroke-opacity:.12', 'stroke-dasharray': '4 4' }, g);
  }
  for (const ln of lines) {
    el('line', { x1: ln.x, x2: ln.x, y1: ln.top, y2: ln.bottom, style: 'stroke:var(--muted)', 'stroke-opacity': 0.35, 'stroke-width': 1.5, 'stroke-dasharray': '2 5', 'stroke-linecap': 'round' }, g);
    if (compactHeads) heading(g, ln.x, top + 16, String(ln.L));
    else heading(g, ln.x, top, spec().layers === 1 ? 'HIDDEN LAYER' : `HIDDEN ${ln.L}`);
  }
  if (compactHeads) heading(g, (lines[0].x + lines[lines.length - 1].x) / 2, top, 'HIDDEN LAYERS');
  heading(g, box.w - 130, top, 'OUTPUTS · WHEELS');
}
function edgePoint(p: Pt, toward: Pt, r: number): Pt {
  const dx = toward.x - p.x, dy = toward.y - p.y, d = Math.hypot(dx, dy) || 1;
  return { x: p.x + dx / d * r, y: p.y + dy / d * r };
}
const radOf = (q: Placed) => (q.side === 'mid' ? NR : RAD[q.side]);
function wirePath(p: Placed, q: Placed) {
  const a = p.side === 'mid' ? { x: p.x + NR, y: p.y } : edgePoint(p, { x: q.x - 60, y: q.y }, RAD.in);
  const b = { x: q.x - radOf(q) - 4, y: q.y };
  const dx = b.x - a.x;
  return `M ${a.x} ${a.y} C ${a.x + dx * 0.45} ${a.y}, ${b.x - dx * 0.45} ${b.y}, ${b.x} ${b.y}`;
}

function render() {
  layout(); svg.replaceChildren();
  const s = spec();
  const defs = el('defs', {}, svg);
  const bg = el('g', { 'pointer-events': 'none' }, svg); drawFrame(bg); drawCar(bg);
  // Wires show their weights (principal, 2026-10-31): red −1, black 0, green +1, thicker and brighter with |w|. A faint
  // neutral halo keeps a zero-weight wire visible on the dark canvas; a selected neuron's or pin's wires get an
  // accent halo (and the flow dashes), so the weight colour is never replaced.
  const wg = el('g', {}, svg);
  const arrows = new Map<string, string>();
  const arrowFor = (css: string) => {
    let id = arrows.get(css);
    if (!id) {
      id = `arw${arrows.size}`; arrows.set(css, id);
      const m = el('marker', { id, viewBox: '0 0 8 8', refX: 6, refY: 4, markerWidth: 9, markerHeight: 9, markerUnits: 'userSpaceOnUse', orient: 'auto' }, defs);
      el('path', { d: 'M0 0 L8 4 L0 8 Z', style: `fill:${css}` }, m);
    }
    return id;
  };
  s.conns.forEach((c, k) => {
    const p = P.get(c.from), q = P.get(c.to); if (!p || !q) return;
    const d = wirePath(p, q);
    const hot = W.sel !== null && (c.from === W.sel || c.to === W.sel);
    const st = weightStyle(W.saved.draft.genome.w[k]);
    const dim = W.sel && !hot ? 0.3 : 1;
    const hit = el('path', { d, 'stroke-width': 12, fill: 'none', style: 'cursor:pointer;stroke:transparent', 'data-hit': 1, 'data-from': c.from, 'data-to': c.to, 'data-w': W.saved.draft.genome.w[k] }, wg);
    if (hot) el('path', { d, fill: 'none', style: 'stroke:var(--accent)', 'stroke-width': st.width + 5, 'stroke-linecap': 'round', 'pointer-events': 'none', opacity: 0.35, class: 'sel-halo' }, wg);
    el('path', { d, fill: 'none', style: 'stroke:var(--wire-halo)', 'stroke-width': st.width + 2, 'stroke-linecap': 'round', 'pointer-events': 'none', opacity: dim }, wg);
    el('path', { d, fill: 'none', style: `stroke:${st.css}`, 'stroke-width': st.width, 'stroke-linecap': 'round', 'pointer-events': 'none', opacity: hot ? 1 : st.alpha * dim, 'marker-end': `url(#${arrowFor(st.css)})`, class: 'wire' }, wg);
    if (hot && !reduce) el('path', { d, fill: 'none', style: 'stroke:var(--canvas)', 'stroke-width': 1.3, class: 'flow', 'pointer-events': 'none' }, wg);
    hit.addEventListener('click', () => commit(removeWire(W.saved.draft, c.from, c.to)));
  });
  el('path', { id: 'ghost', d: '', fill: 'none', style: 'stroke:var(--accent)', 'stroke-width': 2.2, 'stroke-dasharray': '4 4', 'pointer-events': 'none' }, svg);
  // per-line controls
  for (const ln of lines) {
    if (!ln.plus) continue;
    const add = el('g', { style: 'cursor:pointer', role: 'button', tabindex: 0, 'aria-label': `Add a neuron to hidden layer ${ln.L}`, 'data-add': ln.L }, svg);
    el('circle', { cx: ln.x, cy: ln.bottom + 14, r: 11, style: 'fill:var(--panel);stroke:var(--line)', 'stroke-width': 1.5 }, add);
    el('path', { d: `M ${ln.x - 5} ${ln.bottom + 14} H ${ln.x + 5} M ${ln.x} ${ln.bottom + 9} V ${ln.bottom + 19}`, style: 'stroke:var(--accent)', 'stroke-width': 1.8, 'stroke-linecap': 'round' }, add);
    const go = () => doAddNeuron(ln.L);
    add.addEventListener('click', go); add.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') go(); });
  }
  const glyph = NR / 17;
  const labels = new Map<string, SVGTextElement>();
  for (const [id, p] of P) {
    const sel = W.sel === id;
    if (p.side === 'mid') {
      const g = el('g', { 'data-id': id, class: W.fresh === id ? 'pop' : null, tabindex: 0, role: 'button', 'aria-label': FX[p.n.act].n + ' neuron' }, svg);
      el('circle', { cx: p.x, cy: p.y + 2, r: NR, style: 'fill:rgba(20,30,50,.08)', 'pointer-events': 'none' }, g);
      el('circle', { cx: p.x, cy: p.y, r: NR, style: `fill:${sel ? 'var(--accent-soft)' : 'var(--node)'};stroke:${sel ? 'var(--accent)' : 'var(--muted)'};cursor:pointer`, 'stroke-width': sel ? 2.5 : 1.5, 'data-pick': id }, g);
      el('path', { d: FX[p.n.act].g, transform: `translate(${p.x} ${p.y})${glyph < 1 ? ` scale(${glyph.toFixed(3)})` : ''}`, fill: 'none', style: `stroke:${sel ? 'var(--accent)' : 'var(--text)'}`, 'stroke-width': 1.8, 'stroke-linecap': 'round', 'pointer-events': 'none' }, g);
      el('circle', { cx: p.x + NR, cy: p.y, r: 10, style: 'fill:transparent;cursor:crosshair', 'data-wire': id }, g);
      el('circle', { cx: p.x + NR, cy: p.y, r: 4.5, style: 'fill:var(--accent);stroke:var(--canvas)', 'stroke-width': 1.5, 'pointer-events': 'none' }, g);
      g.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') { W.sel = id; render(); } });
    } else {
      const on = used(id), isIn = p.side === 'in', r = RAD[p.side];
      const g = el('g', { 'data-id': id, tabindex: 0, role: 'button', 'aria-label': `${p.pin.label}, ${on ? 'used' : 'unused'}` }, svg);
      const shape = isIn ? el('circle', { cx: p.x, cy: p.y, r }, g) : el('rect', { x: p.x - r, y: p.y - r, width: r * 2, height: r * 2, rx: 6 }, g);
      shape.setAttribute('style', `fill:${on ? 'var(--node)' : 'var(--canvas)'};stroke:${sel || on ? 'var(--accent)' : 'var(--muted)'};cursor:${isIn ? 'crosshair' : 'pointer'}`);
      shape.setAttribute('stroke-width', String(sel ? 2.8 : on ? 1.8 : 1.3));
      if (!on && !sel) shape.setAttribute('stroke-dasharray', '3 3');
      shape.dataset[isIn ? 'wire' : 'pick'] = id;
      const ig = el('g', { transform: `translate(${p.x} ${p.y})`, style: `color:${on ? 'var(--accent)' : 'var(--muted)'}`, 'pointer-events': 'none' }, g);
      if (p.side === 'in') icon(p.pin.k, ig, p.pin.deg); else wheelIcon(ig, p.pin.at);
      let lx = p.x, ly = p.y + r + 13, anchor = 'middle';
      if (!isIn) { lx = p.x + r + 8; ly = p.y + 4.5; anchor = 'start'; }
      if (p.side === 'in' && p.pin.ring === 0) ly = p.y - r - 7;
      if (p.side === 'in' && p.pin.at) { lx = p.x + r + 6; ly = p.y + 4.5; anchor = 'start'; }
      const label = el('text', { x: lx, y: ly, 'text-anchor': anchor, class: 'lbl', style: `fill:${on ? 'var(--text)' : 'var(--muted)'}`, 'font-size': 11.5, 'font-family': 'Atkinson Hyperlegible, sans-serif', 'pointer-events': 'none' }, g);
      label.textContent = p.side === 'out' ? p.pin.short : p.pin.label;
      labels.set(id, label as SVGTextElement);
      g.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') { W.sel = id; render(); } });
    }
  }
  unclashLabels(labels);
  W.fresh = null;
  side(); meter();
  const usedIn = IN_UI.filter((i) => used(i.id)).length, usedOut = OUT_UI.filter((o) => used(o.id)).length;
  $('count').textContent = `${usedIn} / ${IN_UI.length} inputs · ${s.nodes.length} neurons in ${s.layers} layer${s.layers === 1 ? '' : 's'} · ${s.conns.length} wires · ${usedOut} / ${OUT_UI.length} wheels`;
  ($('addL') as HTMLButtonElement).disabled = s.layers >= MAX_LAYERS;
  $('drive').hidden = !trained(); // Drive appears once the brain has trained weights
  $('name').textContent = W.saved.name;
}

/** On a small car the front-diagonal eye labels (under their pins) can run into "Road ahead": put them above the pin, as "Front" is. */
function unclashLabels(labels: Map<string, SVGTextElement>) {
  const boxOf = (t: SVGTextElement) => { const b = t.getBBox(); return { l: b.x, r: b.x + b.width, t: b.y + 2, b: b.y + b.height - 2 }; };
  const hit = (a: ReturnType<typeof boxOf>, b: ReturnType<typeof boxOf>) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  for (const id of ['i:fr', 'i:fl']) {
    const t = labels.get(id), p = P.get(id);
    if (!t || !p) continue;
    const mine = boxOf(t);
    if ([...labels].some(([o, u]) => o !== id && hit(mine, boxOf(u)))) t.setAttribute('y', String(p.y - RAD.in - 7));
  }
}

// ---- pointer ----
const pt = (e: PointerEvent): Pt => { const r = svg.getBoundingClientRect(); return { x: (e.clientX - r.left) * box.w / r.width, y: (e.clientY - r.top) * box.h / r.height }; };
svg.addEventListener('pointerdown', (e) => {
  const t = e.target as SVGElement;
  if (t.dataset.wire) { drag = { id: t.dataset.wire, moved: false, start: pt(e) }; svg.setPointerCapture(e.pointerId); e.preventDefault(); }
  else if (t.dataset.pick) { W.sel = W.sel === t.dataset.pick ? null : t.dataset.pick; render(); }
  else if (!t.dataset.hit && t.closest('[role=button]') === null) { W.sel = null; render(); }
});
svg.addEventListener('pointermove', (e) => {
  if (!drag) return; const q = pt(e);
  if (Math.hypot(q.x - drag.start.x, q.y - drag.start.y) > 4) drag.moved = true;
  if (!drag.moved) return;
  const p = P.get(drag.id); if (!p) return;
  const a = p.side === 'mid' ? { x: p.x + NR, y: p.y } : edgePoint(p, q, RAD.in);
  svg.querySelector('#ghost')?.setAttribute('d', `M ${a.x} ${a.y} L ${q.x} ${q.y}`);
});
svg.addEventListener('pointerup', (e) => {
  if (!drag) return; const d = drag; drag = null;
  if (!d.moved) { W.sel = W.sel === d.id ? null : d.id; render(); return; }
  const target = (document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-id]') as SVGElement | null)?.dataset.id;
  if (target && target !== d.id) {
    const news = [d.id, target].filter((id) => isPin(id) && !used(id));
    const r = addWire(W.saved.draft, d.id, target);
    if (r.ok) {
      if (news.length) toast(`${news.map((id) => pinOf(id)?.label).join(' and ')} now in use.`);
      commit(r.draft);
      return;
    }
    toast(REFUSED[r.reason]);
  }
  render();
});

function doAddNeuron(L?: number) {
  const s = spec();
  if (L === undefined) { const n = s.nodes.find((m) => m.id === W.sel); L = n ? n.layer : s.layers; }
  const r = addNeuron(W.saved.draft, L);
  if (!r.ok) { toast(REFUSED[r.reason]); return; }
  commit(r.draft, r.id, r.id);
}
function doRemoveNeuron(id: string) { commit(removeNeuron(W.saved.draft, id), null); }

// ---- side panel ----
function side() {
  const box2 = $('sel'); const s = spec();
  const n = s.nodes.find((m) => m.id === W.sel); const pin = W.sel ? pinOf(W.sel) : undefined;
  if (pin) {
    const on = used(pin.id); const isIn = pin.id.startsWith('i:');
    const k = s.conns.filter((c) => c.from === pin.id || c.to === pin.id).length;
    const cost = isIn ? sensorCost((pin as InPinUi).k) : 0;
    box2.innerHTML = `<h2>${isIn ? 'Sensor' : 'Output'} · ${pin.label}</h2><p class="note">${ABOUT[pin.k]}</p>
      <dl class="kv" style="margin-top:8px"><dt>Status</dt><dd>${on ? `in use · ${k} wire${k === 1 ? '' : 's'}` : 'unused'}</dd>${isIn ? `<dt>Cost when used</dt><dd>${cost ? pct(cost) : 'free'}</dd>` : ''}</dl>
      ${on ? '<button class="link" id="unplug" type="button" style="margin-top:8px">Unplug all its wires</button>' : `<p class="note" style="margin-top:8px">${isIn ? 'Drag from it to a neuron to start using it.' : 'Wire a neuron into it to drive this wheel.'}</p>`}`;
    if (on) $('unplug').onclick = () => commit(unplug(W.saved.draft, pin.id));
    return;
  }
  if (!n) { box2.innerHTML = '<h2>Selected</h2><p class="note">Nothing. Click a neuron to change how it responds, or a sensor or wheel to see what it does.</p>'; return; }
  const ins = s.conns.filter((c) => c.to === n.id).length, outs = s.conns.filter((c) => c.from === n.id).length;
  const acts = Object.keys(FX) as Act[];
  box2.innerHTML = `<h2>Neuron · hidden layer ${n.layer}</h2>
    <div class="fx" role="group" aria-label="Transfer function">${acts.map((k) => `<button type="button" id="fx-${k}" data-fx="${k}" aria-pressed="${n.act === k}"><svg viewBox="-10 -7 20 14"><path d="${FX[k].g}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg><span>${FX[k].n}</span><small>${pct(upkeepCost(k))}</small></button>`).join('')}</div>
    <p class="note" style="margin-top:8px">${FX[n.act].d}</p>
    <dl class="kv" style="margin-top:8px"><dt>Wires in</dt><dd>${ins}</dd><dt>Wires out</dt><dd>${outs}</dd></dl>
    <button class="link" id="rm" type="button" style="margin-top:8px">Delete neuron</button>`;
  box2.querySelectorAll<HTMLButtonElement>('[data-fx]').forEach((b) => b.addEventListener('click', () => commit(setAct(W.saved.draft, n.id, b.dataset.fx as Act))));
  $('rm').onclick = () => doRemoveNeuron(n.id);
}
function meter() {
  const e = estimate(spec()); const p = e.total / BUDGET; const over = p > 1;
  $('eFill').style.width = `${clamp(p, 0, 1) * 100}%`;
  $('meter').classList.toggle('over', over);
  $('eVal').innerHTML = `<b>${pct(e.total)}</b> of energy budget${over ? ` · ${Math.round(noiseLevel(e.total, BUDGET) * 100)}% noise` : ''}`;
  $('ledger').innerHTML = `<dt>Sensors in use</dt><dd>${pct(e.sensors)}</dd><dt>Neurons</dt><dd>${pct(e.upkeep)}</dd><dt>Wires (est.)</dt><dd>${pct(e.wires)}</dd><dt class="t">Total</dt><dd class="t">${pct(e.total)}</dd>`;
}

let tt: ReturnType<typeof setTimeout> | undefined;
function toast(m: string) { const t = $('toast'); t.textContent = m; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => (t.hidden = true), 1800); }

// ---- controls ----
$('addN').onclick = () => doAddNeuron();
$('addL').onclick = () => {
  const r = addLayer(W.saved.draft);
  if (!r.ok) { toast(REFUSED[r.reason]); return; }
  commit(r.draft, r.id, r.id);
};
$('clear').onclick = () => commit(clearWires(W.saved.draft));
$('name').onclick = () => {
  const b = $('name'); const inp = document.createElement('input');
  inp.className = 'name'; inp.value = W.saved.name; inp.maxLength = 40; inp.setAttribute('aria-label', 'Brain name');
  b.replaceWith(inp); inp.focus(); inp.select();
  let done = false;
  const finish = (keep: boolean) => {
    if (done) return; done = true;
    const v = inp.value.trim();
    if (keep) { W.saved = { ...W.saved, name: v || DEFAULT_NAME }; persist(); }
    inp.replaceWith(b); b.textContent = W.saved.name; b.focus();
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
  inp.addEventListener('blur', () => finish(true));
};
$('train').onclick = () => onTrain(W.saved);
$('drive').onclick = () => onDrive(W.saved);
const trained = () => W.saved.draft.genome.w.some((w) => w !== 0);
$('stay').onclick = () => { document.body.classList.add('portrait-ok'); render(); };
// Presets replace the whole brain, so the first click asks and the second (within 3 s) does it.
let armed: { el: HTMLButtonElement; t: ReturnType<typeof setTimeout> } | null = null;
const disarm = () => { if (!armed) return; clearTimeout(armed.t); armed.el.classList.remove('confirm'); armed.el.textContent = armed.el.dataset.label ?? ''; armed = null; };
$('presets').querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) => {
  b.dataset.label = b.textContent ?? '';
  b.addEventListener('click', () => {
    if (armed?.el !== b) {
      disarm();
      b.classList.add('confirm'); b.textContent = 'Replace brain?';
      armed = { el: b, t: setTimeout(disarm, 3000) };
      return;
    }
    disarm();
    const name = b.dataset.preset as PresetName;
    const draft = draftOf(zeroGenome(PRESETS[name]()), W.saved.draft.nextId);
    W.saved = { ...W.saved, train: NO_TRAINING }; // a fresh brain trains from scratch on a new seed
    commit(draft, draft.genome.spec.nodes[0]?.id ?? null);
    toast(`Started from ${b.dataset.label}. Weights start at 0 until it trains.`);
  });
});
window.addEventListener('resize', () => { if (active) render(); });
window.addEventListener('keydown', (e) => {
  if (!active || (e.target as HTMLElement | null)?.closest('input, select, textarea')) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && W.sel?.startsWith('n')) doRemoveNeuron(W.sel);
});

/** The brain as saved now. */
export const currentSaved = (): Saved => W.saved;

/** Show or hide the workbench (the training view takes the screen while it is up). */
export function setActive(on: boolean) {
  active = on;
  if (on) render();
}

/** Replace the brain (after training: new weights and training history), save it and redraw. */
export function replaceSaved(s: Saved) {
  W.saved = s;
  persist();
  if (active) render();
}

export function start(o: { onTrain: (s: Saved) => void; onDrive: (s: Saved) => void }) {
  onTrain = o.onTrain;
  onDrive = o.onDrive;
  W.sel = spec().nodes[0]?.id ?? null;
  render();
  if (loaded.status === 'corrupt') {
    console.warn(`workbench: saved brain unreadable (${loaded.why}); starting from Starter`);
    toast('Your saved brain couldn’t be read, so this is a fresh Starter.');
    persist();
  } else if (loaded.status === 'unavailable') {
    saveWarned = true;
    toast('This browser won’t keep your brain, so changes last until you close the tab.');
  }
}

// for checks (Playwright): the brain as saved, and its estimate from energy.ts
declare global { interface Window { __workbench?: { spec: () => BrainSpec; depth: (id: string) => number } } }
window.__workbench = { spec, depth: (id) => depthOf(spec(), id) };
