// The brain designer (B3), ported from reference/brain-v2-mockup.html (the UI spec) onto the real engine: a tray of
// senses (tap to add a cell), the field (sense cells as 3-D symbol circles, lines of identical neurons, the car whose
// wheels are motor neurons), and a narrow panel for whatever you tapped, with its activation graph. Every column is
// fully wired to the next; taps only inspect. Build mode is still: nothing fires here (brains fire while training and
// driving). The whole 860 × 400 layout is scaled to fit the screen. Every change goes through the pure edit ops in
// common/sim/brain.ts and is saved; energy figures come from common/sim/energy.ts.
import { ACTS, CONFIG, type Act } from '../../../common/config';
import {
  addSense, ACT_CODE, zeroGenome, insertLayer, removeLayer, removeSense, restRate, setLayerFn, setLayerSize, transfer, weightCount,
  type EditResult,
} from '../../../common/sim/brain';
import { cellMax, energyRefusal, layerMax, maxLoad, restLoad, senseMax, speedCap, type Mode, type Rule } from '../../../common/sim/energy';
import { fieldAct, fieldOf, gridAct, gridOf, hdAct, hdOf, SENSE_INFO, speedGainOf } from '../../../common/sim/senses';
import { biasIndex, columns, defaultSpec, FIELD_PARAMS, fieldIndex, inputIds, layerIds, OUTPUTS, SENSE_IDS, wireList, type BrainSpec, type Genome, type SenseId } from '../../../common/sim/spec';
import { TEMP_MAX, TEMP_MIN, TEMP_STEP, tempScale, trainerInfo } from '../../../common/train/trainer';
import { weightStyle } from '../weights';
import { load, NO_TRAINING, save, starterGenome, type Saved, type TrainerId } from './store';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`designer: #${id} missing`);
  return e as T;
};
const NS = 'http://www.w3.org/2000/svg';
type Attrs = Record<string, string | number | null | undefined>;
const el = (t: string, a: Attrs = {}, p?: Element): SVGElement => {
  const e = document.createElementNS(NS, t);
  for (const k in a) if (a[k] != null) e.setAttribute(k, String(a[k]));
  if (p) p.appendChild(e);
  return e;
};
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** sandbox: no energy limit, Train asks how many generations · match (vs CPU, Multiplayer): a design past the limit is
 * refused, and Train spends the fixed budget T straight away (no popup), so every racer trains on the same budget. */
let MODE: Mode = 'sandbox';
/** The limit edits are held to: the sandbox's none, a room's 100%, or a vs CPU round's budget (edits then carry the
 * weights over: rounds plan 2026-11-05). */
let RULE: Rule = 'sandbox';
/** A vs CPU match's brain is its own: shown and edited here but never saved over the sandbox brain. */
let matchBrain = false;

/** Functions as the designer shows them (one per hidden layer; wheels fixed to tanh). */
export const FX: Record<Act, { n: string; g: string }> = {
  linear: { n: 'Linear', g: 'M-8 6 L8 -6' },
  relu: { n: 'ReLU', g: 'M-8 3 H0 L8 -5' },
  sigmoid: { n: 'Sigmoid', g: 'M-8 4 C-2 4 2 -4 8 -4' },
  tanh: { n: 'Tanh', g: 'M-8 5 C-2 5 2 -5 8 -5' },
};
const SYM: Record<SenseId, string> = { boundary: 'wall', landmark: 'flag', hd: 'arrow', grid: 'hex', speed: 'gauge' };
const DESC = { neuron: 'Sums its inputs, then fires.', wheel: 'Sets this wheel\'s speed.' };
/** The trainers in the picker, with the rule the strip shows (principal 2026-11-04: "Learning Rule : [equation]"). */
export const TRAINERS: { id: TrainerId; n: string; eq: string }[] = [
  { id: 'evolution', n: 'Evolution', eq: 'w′ = w + σ·ε' },
  { id: 'backprop', n: 'Backprop', eq: 'Δw = η·δ·x' },
  { id: 'ac', n: 'Actor-critic', eq: 'Δw = α·δ·∂log π/∂w' },
  { id: 'arp', n: 'A<sub>RP</sub>', eq: 'Δw = ρ·(±y − p)·x' },
];
const GENS = [10, 25, 50, 100, 250, 500, 1000];

// ---- state ----
const loaded = load();
interface State { saved: Saved; sel: string | null; gens: number; temp: number }
const W: State = { saved: loaded.saved, sel: null, gens: 100, temp: 0 };
const spec = (): BrainSpec => W.saved.genome.spec;
const trained = (): boolean => W.saved.genome.w.slice(0, weightCount(W.saved.genome.spec)).some((x) => x !== 0);
let onTrain: (s: Saved, generations: number, temperature: number) => void = () => toast('Training isn’t available here.');
let active = true;
let saveWarned = false;
/** The vs CPU build timer ran out while the design was past the limit: train as soon as it is within. */
let trainWhenValid = false;

function persist(): void {
  if (matchBrain) return;
  if (!save(W.saved) && !saveWarned) { saveWarned = true; toast('This browser won’t keep your brain, so changes last until you close the tab.'); }
}
function commit(r: EditResult, what?: string): boolean {
  if (!r.ok) { if (r.reason === 'energy' && r.why) toast(`${what ?? 'That'}: ${r.why}`); return false; }
  W.saved = { ...W.saved, genome: r.genome, train: { seed: W.saved.train.seed, phases: 0, temps: [] } };
  persist();
  return true;
}

// ---- layout (as the mock-up: equal regions per column unless the inputs or the car need more) ----
interface Pos { x: number; y: number; kind: 'in' | 'mid' | 'out'; L?: number; step?: number }
let P = new Map<string, Pos>(), box = { w: 1000, h: 600 }, trayW = 54, R = 16;
let regions: { x0: number; x1: number; cx: number }[] = [];
let car = { cx: 0, cy: 0, W: 0, H: 0 };
const svg = () => $('net') as unknown as SVGSVGElement;
const board = () => $('board');

function layout(): void {
  const s = spec(), b = board();
  box = { w: b.clientWidth, h: b.clientHeight };
  svg().setAttribute('viewBox', `0 0 ${box.w} ${box.h}`);
  const tray = $('tray');
  trayW = tray.offsetLeft + tray.offsetWidth;
  P = new Map();
  const C = s.layers.length + 2, Wb = box.w - trayW;
  R = 16; // input cells large enough to read their symbols (B2d, mock-up v26)
  const ins = inputIds(s), top = 34, avail = box.h - top - 40, pitch = 2 * R + 6; // the bottom row stays clear for the layer buttons
  const perCol = Math.max(1, Math.floor(avail / pitch)), inCols = Math.max(1, Math.ceil(ins.length / perCol));
  const needIn = inCols * pitch + 10, needCar = 112;
  let widths = Array(C).fill(Wb / C) as number[];
  if (Wb / C < needIn || Wb / C < needCar) {
    const rest = (Wb - needIn - needCar) / s.layers.length;
    widths = [needIn, ...Array(s.layers.length).fill(rest), needCar];
  }
  let acc = trayW;
  regions = widths.map((w) => { const r = { x0: acc, x1: acc + w, cx: acc + w / 2 }; acc += w; return r; });
  const cols = Math.ceil(ins.length / perCol), colGap = Math.min(pitch, (regions[0].x1 - regions[0].x0 - 10) / Math.max(cols, 1));
  ins.forEach((id, i) => {
    const col = Math.floor(i / perCol), row = i % perCol, inCol = Math.min(perCol, ins.length - col * perCol);
    P.set(id, { x: regions[0].cx + (col - (cols - 1) / 2) * colGap, y: top + avail / 2 + (row - (inCol - 1) / 2) * Math.max(pitch, Math.min(34, avail / inCol)), kind: 'in' });
  });
  s.layers.forEach((l, L) => {
    const x = regions[L + 1].cx, step = Math.min(34, (box.h - 85) / (l.n + 1));
    layerIds(s, L).forEach((id, k) => P.set(id, { x, y: (box.h - 5) / 2 + (k - (l.n - 1) / 2) * step, step, kind: 'mid', L }));
  });
  const last = regions[C - 1], carW = Math.min(widths[C - 1] * 0.86, 160), carH = carW * 0.52;
  car = { cx: last.cx, cy: box.h / 2 + 8, W: carW, H: carH };
  OUTPUTS.forEach((o, i) => P.set(o.id, { x: car.cx + (i < 2 ? 0.27 : -0.27) * car.W, y: car.cy + (i % 2 === 0 ? -0.5 : 0.5) * car.H, kind: 'out' }));
}
/** Bottom-row buttons shrink so a "+" on a boundary and the "−" mid-column never touch. */
const rowR = () => { const hw = Math.min(...regions.slice(1, -1).map((r) => r.x1 - r.x0), 999); return Math.max(9.5, Math.min(11, hw / 4 - 1)); };

// ---- drawing ----
function render(): void {
  if (!active || !board().clientWidth) return; // hidden (the title shows): nothing to lay out
  layout();
  const g0 = svg(), s = spec();
  const focused = (document.activeElement as Element | null)?.closest?.('#net [data-id]')?.getAttribute('data-id');
  g0.innerHTML = '';
  const isTrained = trained();
  const bg = el('rect', { x: trayW, y: 0, width: box.w - trayW, height: box.h, fill: 'transparent', class: 'hit' }, g0);
  regions.forEach((r, i) => { if (i % 2 === 0) el('rect', { x: r.x0, y: 0, width: r.x1 - r.x0, height: box.h, style: 'fill:var(--band)', 'pointer-events': 'none' }, g0); });
  bg.addEventListener('click', () => { W.sel = null; render(); });
  const t = (x: number, y: number, str: string, a: Attrs = {}, parent: Element = g0) => {
    const e = el('text', { x, y, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700, 'letter-spacing': '1.2', style: 'fill:var(--muted)', 'font-family': 'Arial, Helvetica, sans-serif', ...a }, parent);
    e.textContent = str;
    return e;
  };
  if (!inputIds(s).length) t(trayW + 60, box.h / 2, '+ a sense', { 'font-weight': 400, 'letter-spacing': '0' });
  // layer headers: the function for that line, tappable
  s.layers.forEach((l, L) => {
    const p = P.get(layerIds(s, L)[0]);
    if (!p) return;
    const g = el('g', { class: 'hit', role: 'button', tabindex: 0, 'data-layer': L, 'aria-label': `Layer ${L + 1}: ${FX[l.fn].n}. Tap to change.` }, g0);
    const cw = Math.min(64, regions[L + 1].x1 - regions[L + 1].x0 - 8), narrow = cw < 60;
    el('rect', { x: p.x - cw / 2, y: 6, width: cw, height: 22, style: 'fill:var(--panel);stroke:var(--line)', 'stroke-width': 1.2 }, g);
    el('path', { d: FX[l.fn].g, transform: `translate(${narrow ? p.x : p.x - 18} 17) scale(.7)`, fill: 'none', style: 'stroke:var(--accent)', 'stroke-width': 1.8, 'stroke-linecap': 'round' }, g);
    if (!narrow) t(p.x + 7, 21, FX[l.fn].n, { 'font-size': 10.5, 'letter-spacing': '0', style: 'fill:var(--text)', 'pointer-events': 'none' }, g);
    g.addEventListener('click', (ev) => { ev.stopPropagation(); W.sel = `layer:${L}`; render(); });
  });
  // car, front to the right
  const { cx, cy, W: cw, H: ch } = car, w = cw / 2, h = ch / 2;
  el('path', { d: `M ${cx - w} ${cy - h * .8} Q ${cx - w} ${cy - h} ${cx - w * .86} ${cy - h} L ${cx + w * .55} ${cy - h} L ${cx + w} ${cy - h * .78} Q ${cx + w * 1.08} ${cy} ${cx + w} ${cy + h * .78} L ${cx + w * .55} ${cy + h} L ${cx - w * .86} ${cy + h} Q ${cx - w} ${cy + h} ${cx - w} ${cy + h * .8} Z`, style: 'fill:var(--car);fill-opacity:.1;stroke:var(--car);stroke-opacity:.35', 'stroke-width': 1.5 }, g0);
  el('path', { d: `M ${cx - w * .32} ${cy - h * .6} Q ${cx + w * .46} ${cy - h * .66} ${cx + w * .32} ${cy} Q ${cx + w * .46} ${cy + h * .66} ${cx - w * .32} ${cy + h * .6} Z`, style: 'fill:var(--car);fill-opacity:.12;stroke:var(--car);stroke-opacity:.25' }, g0);
  // wires: grey until trained, then their weights (red −1, black 0, green +1)
  const wg = el('g', { 'data-wires': '' }, g0);
  const wl = wireList(s), ws = W.saved.genome.w;
  wl.forEach(([a, b], k) => {
    const p = P.get(a), q = P.get(b);
    if (!p || !q) return;
    const hot = W.sel && (a === W.sel || b === W.sel);
    const x1 = p.x + (p.kind === 'in' ? R : 11), x2 = q.x - (q.kind === 'out' ? 9 : 11), dx = x2 - x1;
    const st = weightStyle(ws[k]);
    const dim = W.sel && !W.sel.startsWith('layer') && !hot;
    el('path', {
      d: `M ${x1} ${p.y} C ${x1 + dx * .45} ${p.y}, ${x2 - dx * .45} ${q.y}, ${x2} ${q.y}`, fill: 'none', 'data-w': k,
      style: `stroke:${isTrained ? st.css : 'var(--muted)'}`, 'stroke-width': isTrained ? 0.6 + st.width * 0.5 : 1,
      opacity: dim ? 0.1 : isTrained ? 0.25 + st.alpha * 0.6 : 0.45, 'stroke-linecap': 'round',
    }, wg);
  });
  // cells (tap to inspect)
  for (const [id, p] of P) {
    const g = el('g', { class: 'hit cell', 'data-id': id, role: 'button', tabindex: 0, 'aria-label': cellLabel(id) }, g0);
    const sel = W.sel === id;
    if (p.kind === 'in') {
      el('circle', { cx: p.x, cy: p.y, r: R, style: `fill:transparent;stroke:${sel ? 'var(--accent)' : 'var(--line)'}`, 'stroke-width': sel ? 3 : 1.5 }, g);
      el('circle', { cx: p.x, cy: p.y, r: R + 1.5, fill: 'transparent' }, g); // touch target, never reaching a neighbour (pitch 2R + 6)
    } else if (p.kind === 'mid') {
      el('circle', { cx: p.x, cy: p.y, r: 11, style: `fill:${sel ? 'var(--accent-soft)' : 'var(--node)'};stroke:${sel ? 'var(--accent)' : 'var(--muted)'}`, 'stroke-width': sel ? 3 : 1.5 }, g);
      el('path', { d: FX[s.layers[p.L as number].fn].g, transform: `translate(${p.x} ${p.y}) scale(.55)`, fill: 'none', style: 'stroke:var(--text)', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'pointer-events': 'none' }, g);
    } else {
      el('rect', { x: p.x - 9, y: p.y - 6, width: 18, height: 12, style: `fill:var(--node);stroke:${sel ? 'var(--accent)' : 'var(--car)'}`, 'stroke-width': sel ? 3 : 1.5 }, g);
    }
    el('circle', { cx: p.x, cy: p.y, r: p.kind === 'mid' ? 12 : 13, fill: 'transparent', class: 'target' }, g); // touch target
    g.addEventListener('click', (ev) => { ev.stopPropagation(); W.sel = W.sel === id ? null : id; render(); });
    // the selected cell's own "−" (plan 2026-11-05 §1): top right on its edge, the board's "−" style, ~0.45× the cell;
    // only where the inspector has a bin; right after the cell, so it is the next thing focused
    const rm = sel ? removal(id) : null;
    if (rm) {
      const cr = p.kind === 'in' ? R : 11, d = cr * Math.SQRT1_2, bx = p.x + d, by = p.y - d, br = Math.max(5.5, cr * 0.45), a = br * 0.5;
      const b = el('g', { class: 'hit cell-rm', role: 'button', tabindex: 0, 'data-rm-cell': id, 'aria-label': `Remove ${cellLabel(id)}` }, g0);
      el('circle', { cx: bx, cy: by, r: br, style: 'fill:var(--panel);stroke:var(--accent)', 'stroke-width': 1.4 }, b);
      el('path', { d: `M ${bx - a} ${by} H ${bx + a}`, style: 'stroke:var(--accent)', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'pointer-events': 'none' }, b);
      el('circle', { cx: bx, cy: by, r: 16.5 / Math.min(1, SCALE), fill: 'transparent', class: 'target' }, b); // touch target: 33 px on screen at least
      b.addEventListener('click', (ev) => { ev.stopPropagation(); rm(); W.sel = null; render(); });
    }
  }
  // a "+" under each layer's neurons adds one (gone at the limit); a "−" above them removes one
  s.layers.forEach((l, L) => {
    const ids = layerIds(s, L), last = P.get(ids[ids.length - 1]);
    if (!last || l.n >= CONFIG.brain.maxPerLayer || !setLayerSize(W.saved.genome, L, l.n + 1, RULE).ok) return; // gone at the limit or past the budget
    const add = el('g', { class: 'hit btnc', role: 'button', tabindex: 0, 'data-add-n': L, 'aria-label': `Add a neuron to layer ${L + 1}` }, g0);
    const y = last.y + (last.step as number);
    el('circle', { cx: last.x, cy: y, r: 8, style: 'fill:var(--panel);stroke:var(--line)', 'stroke-width': 1.5 }, add);
    el('path', { d: `M ${last.x - 4} ${y} H ${last.x + 4} M ${last.x} ${y - 4} V ${y + 4}`, style: 'stroke:var(--accent)', 'stroke-width': 2.2, 'stroke-linecap': 'round' }, add);
    add.addEventListener('click', (ev) => { ev.stopPropagation(); commit(setLayerSize(W.saved.genome, L, l.n + 1, RULE), 'Another neuron'); render(); });
  });
  const minus = (x: number, y: number, r: number, label: string, data: Attrs, fn: () => void) => {
    const g = el('g', { class: 'hit btnc', role: 'button', tabindex: 0, 'aria-label': label, ...data }, g0);
    const big = r > 9, a = big ? r * 0.45 : 4;
    el('circle', { cx: x, cy: y, r, style: `fill:var(--panel);stroke:${big ? 'var(--accent)' : 'var(--line)'}`, 'stroke-width': big ? 1.4 : 1.5 }, g);
    el('path', { d: `M ${x - a} ${y} H ${x + a}`, style: 'stroke:var(--accent)', 'stroke-width': big ? 2 : 2.2, 'stroke-linecap': 'round' }, g);
    g.addEventListener('click', (ev) => { ev.stopPropagation(); fn(); W.sel = null; render(); });
  };
  s.layers.forEach((l, L) => {
    const first = P.get(layerIds(s, L)[0]);
    if (!first) return;
    if (l.n > 1) minus(first.x, first.y - (first.step as number), 8, `Remove a neuron from layer ${L + 1}`, { 'data-rm-n': L }, () => commit(setLayerSize(W.saved.genome, L, l.n - 1, RULE)));
    if (s.layers.length > 1) minus(regions[L + 1].cx, box.h - 22, rowR(), `Remove layer ${L + 1}`, { 'data-rm-l': L }, () => commit(removeLayer(W.saved.genome, L, RULE)));
  });
  // a "+" at the bottom of each boundary between columns inserts a hidden layer there (gone at the limit)
  if (s.layers.length < CONFIG.brain.maxLayers) for (let i = 0; i < regions.length - 1; i++) {
    if (!insertLayer(W.saved.genome, i, RULE).ok) continue; // past the round's budget here
    const x = regions[i].x1, y = box.h - 22, r = rowR(), a = r * 0.45;
    const add = el('g', { class: 'hit btnc', role: 'button', tabindex: 0, 'data-add-l': i, 'aria-label': 'Add a layer here' }, g0);
    el('circle', { cx: x, cy: y, r, style: 'fill:var(--panel);stroke:var(--accent)', 'stroke-width': 1.4 }, add);
    el('path', { d: `M ${x - a} ${y} H ${x + a} M ${x} ${y - a} V ${y + a}`, style: 'stroke:var(--accent)', 'stroke-width': 2, 'stroke-linecap': 'round' }, add);
    add.addEventListener('click', (ev) => { ev.stopPropagation(); commit(insertLayer(W.saved.genome, i, RULE), 'A new layer'); W.sel = null; render(); });
  }
  showAlloc();
  if (!holdPanel) inspect();
  symbolsDirty = true;
  if (focused) (g0.querySelector(`g.cell[data-id="${focused}"]`) as SVGGElement | null)?.focus();
  // time ran out on a design past the limit: training starts as soon as an edit brings it within
  if (trainWhenValid && MODE === 'match' && !energyRefusal(s, RULE)) { trainWhenValid = false; setTimeout(trainMatch, 0); }
}

/** What the inspector's bin does for this cell (the selected-cell "−" and Delete do the same), or null where there is
 * no bin: a wheel, a layer, the last neuron of its layer. Sense cells of a kind are alike: the last one goes. */
function removal(id: string): (() => void) | null {
  const s = spec();
  if (id.startsWith('i:')) {
    const sid = id.split(':')[1] as SenseId;
    return s.senses[sid] > 0 ? () => { commit(removeSense(W.saved.genome, sid, RULE)); buildTray(); } : null;
  }
  if (id.startsWith('h')) {
    const L = Number(id.slice(1, id.indexOf(':')));
    return s.layers[L] && s.layers[L].n > 1 ? () => { commit(setLayerSize(W.saved.genome, L, s.layers[L].n - 1, RULE)); } : null;
  }
  return null;
}

function cellLabel(id: string): string {
  const s = spec();
  if (id.startsWith('i:')) { const [, sid, k] = id.split(':'); return `${SENSE_INFO[sid as SenseId].name.replace(/s$/, '')} ${Number(k) + 1}`; }
  if (id.startsWith('o:')) return `${OUTPUTS.find((o) => o.id === id)?.label} wheel`;
  const [L, k] = id.slice(1).split(':').map(Number);
  return `Layer ${L + 1} neuron ${k + 1} (${FX[s.layers[L].fn].n})`;
}

// ---- the energy split: brain power against speed (resting to flat out while building) ----
function showAlloc(): void {
  const s = spec(), top = maxLoad(s), lo = restLoad(s, restRate), f = (v: number) => Math.round(Math.max(0, v));
  // a vs CPU round's budget is the bar's full scale (rounds plan §2); otherwise the whole supply
  const lim = typeof RULE === 'number' ? RULE : 100, bar = (v: number) => clamp((v / lim) * 100, 0, 100);
  const sp = (load: number) => Math.round(speedCap(load) * 100);
  $('aFill').style.width = `${bar(lo)}%`;
  $('aRange').style.width = `${bar(top)}%`;
  document.querySelector('.alloc')?.classList.toggle('budget', lim !== 100);
  $('aBrain').textContent = (f(lo) === f(top) ? `${f(lo)}%` : `${f(lo)}–${f(top)}%`) + (lim !== 100 ? ` of ${lim}%` : '');
  $('aSpeed').textContent = sp(top) === sp(lo) ? `${sp(lo)}%` : `${sp(top)}–${sp(lo)}%`;
}

// ---- side panel ----
const BIN = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const binBtn = (id: string, label: string) => `<button class="bin" id="${id}" type="button" aria-label="${label}">${BIN}</button>`;
const fmtE = (v: number) => `${Math.round(v * 10) / 10}%`;
const useLine = (v: number) => `<p class="use">At maximum firing rate, uses <b>${fmtE(v)}</b> energy</p>`;
/** A neuron's or wheel's built-in bias (shown once the brain is trained; 0 before, so omitted). */
const biasOf = (id: string): number => (trained() ? W.saved.genome.w[biasIndex(spec(), id)] : 0);
const biasLine = (b: number) => (trained() ? `<p class="use" data-bias>Bias <b>${b >= 0 ? '+' : '−'}${Math.abs(b).toFixed(2)}</b></p>` : '');
/** The cell's learned field in words, once training has moved it from the even spread (B2e). */
function fieldLine(id: SenseId, k: number, n: number): string {
  const p = fieldParams(id, k);
  if (p.every((x) => x === 0)) return '';
  const deg = (d: number) => `${d >= 0 ? '' : '−'}${Math.abs(Math.round(d))}°`;
  let t: string;
  if (id === 'boundary' || id === 'landmark') { const f = fieldOf(id, k, n, p[0], p[1], p[2]); t = `${deg(f.dirDeg)} · ${Math.round(f.widthDeg)}° wide · ${f.rangeM.toFixed(1)} m`; }
  else if (id === 'hd') { let a = (hdOf(k, n, p[0]) * 180) / Math.PI; a -= 360 * Math.floor(a / 360); t = `prefers ${Math.round(a)}°`; }
  else if (id === 'grid') { const f = gridOf(k, p[0], p[1], p[2], p[3]); t = `${f.scale.toFixed(1)} m · shifted ${Math.hypot(f.ox, f.oy).toFixed(1)} m · turned ${deg((f.rot * 180) / Math.PI)}`; }
  else t = `gain ×${speedGainOf(p[0]).toFixed(2)}`;
  return `<p class="use" data-field>Learned field <b>${t}</b></p>`;
}
let holdPanel = false; // while the neurons slider is dragged, the board redraws but the panel stays put

function inspect(): void {
  const box2 = $('insp'), id = W.sel, s = spec();
  if (!id) { box2.innerHTML = '<p class="empty">Tap a neuron<br>to inspect it</p>'; return; }
  if (id.startsWith('layer:')) {
    const L = Number(id.slice(6)), l = s.layers[L];
    if (!l) { W.sel = null; inspect(); return; }
    box2.innerHTML = `<h2>Layer ${L + 1}</h2><div class="fx">${ACTS.map((k) => `<button type="button" data-fx="${k}" aria-pressed="${l.fn === k}"><svg viewBox="-10 -7 20 14"><path d="${FX[k].g}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>${FX[k].n}</button>`).join('')}</div>`
      + `<label class="count"><span>Neurons</span><b id="nVal">${l.n}</b><input id="nSlide" type="range" min="1" max="${CONFIG.brain.maxPerLayer}" step="1" value="${l.n}" aria-label="Neurons in layer ${L + 1}"></label>`
      + `<div id="lUse" style="margin-top:12px">${useLine(layerMax(s, L))}</div>${s.layers.length > 1 ? binBtn('rmL', 'Remove this layer') : ''}`;
    box2.querySelectorAll<HTMLButtonElement>('[data-fx]').forEach((b) => b.addEventListener('click', () => { commit(setLayerFn(W.saved.genome, L, b.dataset.fx as Act, RULE), 'That function'); render(); }));
    // the slider sets the layer's size live; a size the energy rule refuses (vs CPU, Multiplayer) snaps back
    ($('nSlide') as HTMLInputElement).addEventListener('input', (e) => {
      const inp = e.target as HTMLInputElement, want = Number(inp.value), old = spec().layers[L].n;
      if (want !== old && !commit(setLayerSize(W.saved.genome, L, want, RULE), 'That many neurons')) inp.value = String(old);
      $('nVal').textContent = String(spec().layers[L].n);
      $('lUse').innerHTML = useLine(layerMax(spec(), L));
      holdPanel = true; render(); holdPanel = false;
    });
    if (document.getElementById('rmL')) $('rmL').onclick = () => { commit(removeLayer(W.saved.genome, L, RULE)); W.sel = null; render(); };
    return;
  }
  if (id.startsWith('i:')) {
    const [, sid, ks] = id.split(':'), k = Number(ks), n = s.senses[sid as SenseId];
    if (k >= n) { W.sel = null; inspect(); return; }
    box2.innerHTML = `<h2>${SENSE_INFO[sid as SenseId].name.replace(/s$/, '')}</h2><canvas id="graph" aria-label="Activation pattern"></canvas><p class="desc">${SENSE_INFO[sid as SenseId].desc}</p>${fieldLine(sid as SenseId, k, n)}${useLine(senseMax(s, sid as SenseId))}${binBtn('rm', 'Remove this cell')}`;
    graphSense(sid as SenseId, k, n);
    $('rm').onclick = () => { removal(id)?.(); W.sel = null; render(); };
    return;
  }
  if (id.startsWith('h')) {
    const L = Number(id.slice(1, id.indexOf(':')));
    if (!s.layers[L]) { W.sel = null; inspect(); return; }
    const b = biasOf(id);
    box2.innerHTML = `<h2>Neuron · layer ${L + 1}</h2><canvas id="graph" aria-label="Activation pattern"></canvas><p class="desc">${DESC.neuron}</p>${biasLine(b)}${useLine(cellMax(s, L + 1))}${s.layers[L].n > 1 ? binBtn('rmN', 'Remove this neuron') : ''}`;
    graphCurve(s.layers[L].fn, 'Σ w·x', 'output', b);
    if (document.getElementById('rmN')) $('rmN').onclick = () => { removal(id)?.(); W.sel = null; render(); };
    return;
  }
  const b = biasOf(id);
  box2.innerHTML = `<h2>${OUTPUTS.find((q) => q.id === id)?.label} wheel</h2><canvas id="graph" aria-label="Activation pattern"></canvas><p class="desc">${DESC.wheel}</p>${biasLine(b)}${useLine(cellMax(s, columns(s).length - 1))}`;
  graphCurve('tanh', 'Σ w·x', 'wheel speed', b);
}

// ---- activation-pattern graphs (the panel), from the engine's own sense rules ----
const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const FONT = 'Arial, Helvetica, sans-serif';
function gctx(): { g: CanvasRenderingContext2D; w: number } {
  const c = $('graph') as HTMLCanvasElement, w = c.clientWidth || 140, dpr = Math.min(devicePixelRatio, 2) * SCALE;
  c.width = Math.round(w * dpr); c.height = Math.round(w * dpr);
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.scale(dpr, dpr);
  return { g, w };
}
// cold to hot: blue → green → yellow → red
const STOPS: [number, number[]][] = [[0, [44, 107, 217]], [1 / 3, [63, 179, 90]], [2 / 3, [255, 210, 26]], [1, [232, 68, 58]]];
export const heat = (a: number, alpha = 0.9) => {
  a = clamp(a, 0, 1);
  let i = 0;
  while (i < STOPS.length - 2 && a > STOPS[i + 1][0]) i++;
  const [a0, c0] = STOPS[i], [a1, c1] = STOPS[i + 1], t = (a - a0) / (a1 - a0);
  return `rgba(${c0.map((v, k) => Math.round(v + (c1[k] - v) * t)).join(',')},${alpha})`;
};
/** A circular map around the car (front up): the cell's activation for a target at each distance and bearing. */
function polar(fieldDeg: number, range: number, width: number, ringStep: number): void {
  const { g, w } = gctx(), c = w / 2, Rr = w / 2 - 12;
  g.fillStyle = css('--canvas'); g.beginPath(); g.arc(c, c, Rr, 0, 7); g.fill();
  for (let y = -Rr; y <= Rr; y += 1) for (let x = -Rr; x <= Rr; x += 1) {
    const r = Math.hypot(x, y);
    if (r > Rr) continue;
    let off = Math.atan2(x, -y) * 180 / Math.PI - fieldDeg;
    off -= 360 * Math.round(off / 360);
    g.fillStyle = heat(fieldAct(off, (r / Rr) * range, range, width), 0.9);
    g.fillRect(c + x - 0.5, c + y - 0.5, 1.2, 1.2);
  }
  g.lineWidth = 0.75; g.font = `9px ${FONT}`; g.strokeStyle = '#ffffff'; g.fillStyle = '#ffffff';
  for (let d = ringStep; d <= range + 0.01; d += ringStep) {
    const rr = (d / range) * Rr;
    g.globalAlpha = 0.5; g.beginPath(); g.arc(c, c, rr, 0, 7); g.stroke();
    g.globalAlpha = 1; g.fillText(`${d} m`, c + 3, c - rr + 10);
  }
  g.globalAlpha = 1;
  g.beginPath(); g.moveTo(c, c - 7); g.lineTo(c + 4.5, c + 5); g.lineTo(c - 4.5, c + 5); g.closePath(); g.fill();
}
interface PlotOpts { x: number[]; y: number[]; xt: number[]; yt: number[]; xl: string; yl: string }
/** An x/y frame: faint grid, solid axes through 0, tick labels, axis titles. */
function plot(o: PlotOpts) {
  const { g, w } = gctx(), l = 30, r = w - 8, t = 8, b = w - 30;
  const X = (v: number) => l + ((r - l) * (v - o.x[0])) / (o.x[1] - o.x[0]), Y = (v: number) => b - ((b - t) * (v - o.y[0])) / (o.y[1] - o.y[0]);
  g.font = `9px ${FONT}`; g.lineWidth = 1; g.strokeStyle = css('--line');
  for (const v of o.xt) { g.beginPath(); g.moveTo(X(v), t); g.lineTo(X(v), b); g.stroke(); }
  for (const v of o.yt) { g.beginPath(); g.moveTo(l, Y(v)); g.lineTo(r, Y(v)); g.stroke(); }
  const x0 = X(clamp(0, o.x[0], o.x[1])), y0 = Y(clamp(0, o.y[0], o.y[1]));
  g.strokeStyle = css('--text'); g.lineWidth = 1.2; g.beginPath(); g.moveTo(l, y0); g.lineTo(r, y0); g.moveTo(x0, t); g.lineTo(x0, b); g.stroke();
  g.fillStyle = css('--muted'); g.textAlign = 'center'; for (const v of o.xt) g.fillText(String(v), X(v), b + 11);
  g.textAlign = 'right'; for (const v of o.yt) g.fillText(String(v), l - 4, Y(v) + 3);
  g.fillStyle = css('--text'); g.textAlign = 'center'; g.fillText(o.xl, (l + r) / 2, b + 24);
  g.save(); g.translate(9, (t + b) / 2); g.rotate(-Math.PI / 2); g.fillText(o.yl, 0, 0); g.restore(); g.textAlign = 'start';
  return { g, X, Y };
}
const line = (g: CanvasRenderingContext2D, n: number, xy: (u: number) => [number, number]) => {
  g.strokeStyle = css('--spike'); g.lineWidth = 2.2; g.beginPath();
  for (let i = 0; i <= n; i++) { const [x, y] = xy(i / n); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
  g.stroke();
};
/** Cell k's field parameters in the saved brain (all 0 until training moves them: the even spread). */
const fieldParams = (id: SenseId, k: number): number[] => {
  const g = W.saved.genome, a = fieldIndex(g.spec, `i:${id}:${k}`);
  return g.w.slice(a, a + FIELD_PARAMS[id]);
};
function wave(pref: number): void {
  const { g, X, Y } = plot({ x: [0, 360], y: [-1, 1], xt: [0, 90, 180, 270, 360], yt: [-1, 0, 1], xl: 'heading (°)', yl: 'activation' });
  line(g, 180, (u) => [X(u * 360), Y(hdAct((u * 2 * Math.PI), pref))]);
}
/** A track-like map with the grid cell's firing over it (the track on top so it stays visible), with a 50 m bar. */
function gridMap(k: number): void {
  const { g, w } = gctx(), metres = 220, m2p = w / metres;
  g.fillStyle = css('--canvas'); g.fillRect(0, 0, w, w);
  const p = fieldParams('grid', k), f = gridOf(k, p[0], p[1], p[2], p[3]);
  for (let y = 0; y < w; y += 1) for (let x = 0; x < w; x += 1) { g.fillStyle = heat(gridAct(x / m2p, y / m2p, f.scale, f.phase, f.ox, f.oy, f.rot), 0.75); g.fillRect(x, y, 1.2, 1.2); }
  const pts: [number, number][] = [];
  for (let i = 0; i < 64; i++) { const a = (i / 64) * Math.PI * 2, rr = 0.36 + 0.07 * Math.sin(a * 3) + 0.04 * Math.cos(a * 2); pts.push([w / 2 + Math.cos(a) * rr * w, w / 2 + Math.sin(a) * rr * w * 0.82]); }
  const road = (col: string, width: number, alpha: number) => { g.globalAlpha = alpha; g.strokeStyle = col; g.lineWidth = width; g.lineJoin = 'round'; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.stroke(); g.globalAlpha = 1; };
  road('#f4f6fa', (14 * w) / 160, 0.55); road('#1d2330', 1.2, 0.8);
  g.fillStyle = '#ffffff'; g.font = `bold 9px ${FONT}`;
  const bar = 50 * m2p; g.fillRect(6, w - 8, bar, 2); g.fillText('50 m', 8 + bar, w - 4);
}
/** A transfer curve, from the engine's own function, against the weighted input Σ w·x: shifted by the bias b. */
function graphCurve(fn: Act, xl: string, yl = 'output', b = 0): void {
  const code = ACT_CODE[fn], ymin = fn === 'relu' || fn === 'sigmoid' ? 0 : -1, ymax = fn === 'relu' ? 4 : 1;
  const { g, X, Y } = plot({ x: [-4, 4], y: [ymin, ymax], xt: [-4, 0, 4], yt: [...new Set([ymin, 0, ymax])], xl, yl });
  line(g, 160, (u) => { const xv = -4 + 8 * u; return [X(xv), Y(clamp(transfer(code, xv + b), ymin, ymax))]; });
}
function speedLine(gain: number): void {
  const top = CONFIG.car.wheelSpeed;
  const { g, X, Y } = plot({ x: [0, top], y: [0, 1], xt: [0, top / 2, top], yt: [0, 1], xl: 'speed (m/s)', yl: 'activation' });
  line(g, 60, (u) => [X(u * top), Y(Math.min(1, u * gain))]);
}
/** The cell's graph from its learned field (B2e): the inspector shows how training moved it. */
function graphSense(id: SenseId, k: number, n: number): void {
  const p = fieldParams(id, k);
  if (id === 'boundary' || id === 'landmark') {
    const f = fieldOf(id, k, n, p[0], p[1], p[2]);
    polar(f.dirDeg, f.rangeM, f.widthDeg, id === 'boundary' ? 5 : 10);
  } else if (id === 'hd') wave(hdOf(k, n, p[0]));
  else if (id === 'grid') gridMap(k);
  else speedLine(speedGainOf(p[0]));
}

// ---- tray of senses ----
function buildTray(): void {
  const tr = $('tray');
  tr.querySelectorAll('.sense').forEach((n) => n.remove());
  for (const id of SENSE_IDS) {
    const b = document.createElement('button'), info = SENSE_INFO[id];
    b.type = 'button'; b.className = 'sense'; b.dataset.s = id;
    b.setAttribute('aria-label', `Add a ${info.name.replace(/ cells$/, '').toLowerCase()} cell`);
    const full = spec().senses[id] >= CONFIG.senses[id].max || !addSense(W.saved.genome, id, RULE).ok; // or past the round's budget
    b.innerHTML = full ? '' : '<span class="plus" aria-hidden="true">+</span>';
    if (full) { b.disabled = true; b.classList.add('full'); }
    b.addEventListener('click', () => {
      if (spec().senses[id] >= CONFIG.senses[id].max) return;
      if (commit(addSense(W.saved.genome, id, RULE), `A ${info.name.toLowerCase().replace(/s$/, '')}`)) W.sel = `i:${id}:${spec().senses[id] - 1}`;
      buildTray(); render();
    });
    tr.appendChild(b);
  }
  symbolsDirty = true;
}

// ---- the 3-D symbols (one WebGL layer under the diagram; loaded after first paint) ----
let symbols: { draw(list: { sym: string; x: number; y: number; size: number }[], t: number, pixelScale: number): void } | null = null;
let symbolsDirty = true;
function symbolList() {
  const out: { sym: string; x: number; y: number; size: number }[] = [];
  const tr = $('tray');
  document.querySelectorAll<HTMLButtonElement>('#tray .sense').forEach((b) => out.push({ sym: SYM[b.dataset.s as SenseId], x: tr.offsetLeft + b.offsetLeft + b.offsetWidth / 2, y: tr.offsetTop + b.offsetTop + b.offsetHeight / 2, size: b.offsetHeight - 6 }));
  for (const [id, p] of P) if (p.kind === 'in') out.push({ sym: SYM[id.split(':')[1] as SenseId], x: p.x, y: p.y, size: R * 1.7 });
  return out;
}
let raf = 0;
function frame(now: number): void {
  raf = requestAnimationFrame(frame);
  if (!active || !symbols) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce && !symbolsDirty) return;
  symbolsDirty = false;
  symbols.draw(symbolList(), reduce ? 8 : now / 1000, SCALE);
}

// ---- the learning rule strip and the trainer picker ----
function buildTrainers(): void {
  const cur = W.saved.trainer;
  $('trainers').innerHTML = TRAINERS.map((t) => {
    let ready = true;
    try { trainerInfo(t.id); } catch { ready = false; }
    return `<button type="button" data-tr="${t.id}" aria-pressed="${cur === t.id}"${ready ? '' : ' disabled title="Coming next"'}>${t.n}</button>`;
  }).join('');
  $('trainers').querySelectorAll<HTMLButtonElement>('[data-tr]').forEach((b) => { b.onclick = () => { W.saved = { ...W.saved, trainer: b.dataset.tr as TrainerId }; persist(); buildTrainers(); }; });
  $('eq').innerHTML = `Learning Rule : <span>${(TRAINERS.find((t) => t.id === cur) ?? TRAINERS[0]).eq}</span>`;
}

// ---- train (asks how many generations: sandbox has no fixed budget) and reset ----
function buildGens(): void {
  $('gens').innerHTML = GENS.map((g) => `<button type="button" data-g="${g}" aria-pressed="${g === W.gens}">${g}</button>`).join('');
  $('gens').querySelectorAll<HTMLButtonElement>('[data-g]').forEach((b) => { b.onclick = () => { W.gens = Number(b.dataset.g); buildGens(); }; });
}

// temperature (brain v2 plan §3ac, mock-up v26): how boldly training explores, a multiplier on the trainer's own
// exploration on a log scale (×0.25 to ×4); backprop copies a teacher, so it is off there
const TEMP_HINT: Record<TrainerId, string> = {
  evolution: 'Scales σ, the size of each mutation.', ac: 'Scales how much the actor explores.',
  arp: 'Scales how randomly the units fire while learning.', backprop: 'Backprop copies a teacher, so it has nothing to explore.',
};
/** "×0.25", "×0.59", "×1.0", "×2.0", "×4.0", as the mock-up writes them. */
export const tempLabel = (t: number): string => { const v = tempScale(t); return `×${v < 1 ? v.toFixed(2).replace(/0$/, '') : v.toFixed(1)}`; };
function showTemp(): void {
  const off = W.saved.trainer === 'backprop', sl = $('tSlide') as HTMLInputElement;
  sl.value = String(W.temp); sl.disabled = off;
  $('tVal').textContent = off ? '—' : tempLabel(W.temp);
  $('tHint').textContent = TEMP_HINT[W.saved.trainer];
  $('tempRow').classList.toggle('off', off);
}

let tt: ReturnType<typeof setTimeout> | undefined;
function toast(m: string, ms = 2000): void { const t = $('toast'); t.textContent = m; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => (t.hidden = true), ms); }

// ---- scale the 860 × 400 layout to the screen (above the storage notice while it shows) ----
let SCALE = 1;
function fit(): void {
  const a = document.querySelector<HTMLElement>('.app');
  if (!a) return;
  const notice = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--notice-h')) || 0;
  const H = innerHeight - notice;
  SCALE = Math.min(innerWidth / 860, H / 400);
  a.style.transform = `translate(${(innerWidth - 860 * SCALE) / 2}px, ${(H - 400 * SCALE) / 2}px) scale(${SCALE})`;
  symbolsDirty = true;
}

// ---- public ----
export const currentSaved = (): Saved => W.saved;
export function setActive(on: boolean): void {
  active = on;
  trainWhenValid = false;
  if (on) { fit(); buildTray(); buildTrainers(); render(); }
}
/** vs CPU opens the designer in match mode, Sandbox in sandbox mode. A brain past the limit says so on entering. */
export function setDesignerMode(m: Mode, limit?: number): void {
  MODE = m;
  RULE = m === 'match' && limit !== undefined ? limit : m;
  document.body.classList.toggle('match', m === 'match');
  const why = energyRefusal(spec(), RULE);
  if (why) toast(`${why} Remove cells to race.`, 4000);
}
export const designerMode = (): Mode => MODE;
/** vs CPU: edit this brain (never saved over the sandbox brain); null: back to the saved sandbox brain. */
export function useMatchBrain(g: Genome | null): void {
  if (g) { W.saved = { ...W.saved, name: 'vs CPU', genome: g, train: NO_TRAINING }; matchBrain = true; }
  else if (matchBrain) { matchBrain = false; W.saved = load().saved; }
  W.sel = null;
  if (active) { buildTray(); render(); }
}
/** Match mode's Train: the fixed budget straight away, unless the design is past the limit (then it says why). */
function trainMatch(): boolean {
  const why = energyRefusal(spec(), RULE);
  if (why) { toast(`${why} Remove cells to race.`, 4000); return false; }
  trainWhenValid = false;
  onTrain(W.saved, 0, 0);
  return true;
}
/** The vs CPU build timer reached 0: Train with the design as it stands (or, past the limit, once it is within). */
export function timeUp(): void {
  if (MODE !== 'match' || !active) return;
  if (!trainMatch()) trainWhenValid = true;
}
export function replaceSaved(s: Saved): void { W.saved = s; persist(); if (active) render(); }

export function start(o: { onTrain: (s: Saved, generations: number, temperature: number) => void }): void {
  onTrain = o.onTrain;
  const sl = $('tSlide') as HTMLInputElement;
  sl.min = String(TEMP_MIN); sl.max = String(TEMP_MAX); sl.step = String(TEMP_STEP);
  sl.addEventListener('input', () => { W.temp = Number(sl.value); showTemp(); });
  $('train').onclick = () => {
    if (MODE === 'match') { trainMatch(); return; } // the fixed budget, no popup (temperature ×1)
    buildGens(); showTemp(); ($('trainDlg') as HTMLDialogElement).showModal();
  };
  $('tdNo').onclick = () => ($('trainDlg') as HTMLDialogElement).close();
  $('tdGo').onclick = () => { ($('trainDlg') as HTMLDialogElement).close(); onTrain(W.saved, W.gens, W.saved.trainer === 'backprop' ? 0 : W.temp); };
  $('reset').onclick = () => ($('confirm') as HTMLDialogElement).showModal();
  $('cfNo').onclick = () => ($('confirm') as HTMLDialogElement).close();
  $('cfYes').onclick = () => {
    // a new random starter (plan §3c); in a vs CPU match the starting brain, which fits round 1's budget
    W.saved = { ...W.saved, genome: matchBrain ? zeroGenome(defaultSpec()) : starterGenome(), train: NO_TRAINING };
    W.sel = null; persist(); ($('confirm') as HTMLDialogElement).close(); buildTray(); render();
  };
  addEventListener('resize', () => { fit(); render(); });
  // keyboard: Enter or Space presses a focused board button; Delete or Backspace removes the selected cell (as its "−")
  svg().addEventListener('keydown', (ev) => {
    const e = ev as KeyboardEvent;
    const t = (e.target as Element).closest('#net [role="button"]');
    if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); t.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  });
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (!active || (e.key !== 'Delete' && e.key !== 'Backspace') || !W.sel || document.querySelector('dialog[open]')) return;
    if ((e.target as Element).closest?.('input, textarea, select, [contenteditable]')) return;
    const rm = removal(W.sel);
    if (!rm) return;
    e.preventDefault(); rm(); W.sel = null; render();
  });
  fit(); buildTray(); buildTrainers(); render();
  if (loaded.status === 'corrupt') { console.warn(`designer: saved brain unreadable (${loaded.why}); starting from a new brain`); toast('Your saved brain couldn’t be read, so this is the starting brain.'); persist(); }
  else if (loaded.status === 'reset') { toast('Synapse has changed how brains work, so your brain was reset to the starting brain.', 6000); persist(); }
  else if (loaded.status === 'unavailable') { saveWarned = true; toast('This browser won’t keep your brain, so changes last until you close the tab.'); }
  raf = requestAnimationFrame(frame);
  // the symbols' 3-D layer (three.js) loads after first paint, so it never holds up the designer
  requestAnimationFrame(() => setTimeout(() => {
    import('./symbols').then((m) => { symbols = m.createSymbols($('gl') as HTMLCanvasElement); symbolsDirty = true; })
      .catch((e) => console.warn('designer: no 3-D symbols', e));
  }, 0));
}

// for checks (Playwright): the brain as saved, the layout, and a way to render any brain
declare global {
  interface Window {
    __designer?: { spec: () => BrainSpec; genome: () => Genome; scale: () => number; load: (g: Genome) => void; select: (id: string | null) => void; cells: () => string[] };
  }
}
window.__designer = {
  spec: () => spec(),
  genome: () => W.saved.genome,
  scale: () => SCALE,
  load: (g) => { W.saved = { ...W.saved, genome: g, train: NO_TRAINING }; W.sel = null; buildTray(); render(); },
  select: (id) => { W.sel = id; render(); },
  cells: () => [...P.keys()],
};
void raf;
