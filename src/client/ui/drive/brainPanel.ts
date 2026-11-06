// The live brain panel of the drive view (brain v2): the designer's columns drawn small on a canvas each frame, the
// sense cells on the left, a line per hidden layer, the four wheels on the right. Wires show their weights
// (weights.ts: red −1, black 0, green +1; thicker and brighter with |w|). Every cell flashes yellow at its firing rate
// (spikes.ts: 14 Hz × rate), or glows steadily with it under prefers-reduced-motion; wheels show their speed. Each
// input cell has its type's flat symbol just to its left (senseGlyph.ts; card icons plan 2026-11-06 §2).
import { SENSE_CODE } from '../../../common/sim/brain';
import { columns, SENSE_IDS, wireList, type SenseId } from '../../../common/sim/spec';
import { drawGlyph } from './senseGlyph';
import type { Net } from '../../../common/sim/brain';
import { weightStyle, type WireStyle } from '../weights';
import type { SpikeTrains } from './spikes';

interface P { x: number; y: number }

export class BrainPanel {
  private pos: P[] = [];
  private w = 0;
  private h = 0;
  private pr = 1;
  /** Wire styles in canonical order (weights do not change while driving), and each wire's ends as node indices. */
  private readonly wires: WireStyle[];
  private readonly ends: [number, number][];
  /** The symbol drawn beside each input cell in the last frame, in node order (checks read it). */
  glyphs: SenseId[] = [];

  constructor(private readonly cv: HTMLCanvasElement, private readonly net: Net) {
    const w = new Float64Array(net.w.length);
    for (let c = 0; c < net.w.length; c++) w[net.specIdx[c]] = net.w[c];
    this.wires = Array.from(w, weightStyle);
    const index = new Map(net.ids.map((id, i) => [id, i]));
    this.ends = wireList(net.spec).map(([a, b]) => [index.get(a) as number, index.get(b) as number]);
  }

  private layout(): void {
    const r = this.cv.getBoundingClientRect();
    this.pr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(r.width * this.pr)), h = Math.max(1, Math.round(r.height * this.pr));
    if (w === this.w && h === this.h && this.pos.length) return;
    this.w = this.cv.width = w; this.h = this.cv.height = h;
    const C = columns(this.net.spec), pr = this.pr;
    const x0 = 30 * pr, x1 = w - 52 * pr; // room left of the inputs for their symbols, right of the wheels for their labels
    const pos: P[] = [];
    C.forEach((col, c) => {
      const x = C.length === 1 ? x0 : x0 + ((x1 - x0) * c) / (C.length - 1);
      const step = Math.min(22 * pr, (h - 20 * pr) / Math.max(col.length - 1, 1));
      col.forEach((_, k) => pos.push({ x, y: h / 2 + (k - (col.length - 1) / 2) * step }));
    });
    this.pos = pos;
  }

  /** vals: every node's output this tick; spikes: every node's train at `now`; rates: each node's firing rate. */
  draw(vals: ArrayLike<number>, rates: ArrayLike<number>, spikes: SpikeTrains, now: number, reduceMotion: boolean): void {
    this.layout();
    const g = this.cv.getContext('2d');
    if (!g) return;
    const css = getComputedStyle(document.documentElement);
    const col = (v: string, d: string) => css.getPropertyValue(v).trim() || d;
    const muted = col('--muted', '#6a7385'), node = col('--node', '#fff'), text = col('--text', '#1d2330');
    const halo = col('--wire-halo', 'transparent'), spike = col('--spike', '#ffc21a');
    const { w, h, pr, pos } = this;
    g.clearRect(0, 0, w, h);
    const r = 5.5 * pr;
    this.ends.forEach(([a, b], k) => {
      const p = pos[a], q = pos[b], st = this.wires[k];
      const x0 = p.x + r, x1 = q.x - r, dx = x1 - x0;
      const path = () => { g.beginPath(); g.moveTo(x0, p.y); g.bezierCurveTo(x0 + dx * 0.45, p.y, x1 - dx * 0.45, q.y, x1, q.y); };
      g.globalAlpha = 1; g.strokeStyle = halo; g.lineWidth = (st.width + 1.5) * 0.6 * pr; path(); g.stroke();
      g.globalAlpha = st.alpha; g.strokeStyle = st.css; g.lineWidth = st.width * 0.6 * pr; path(); g.stroke();
    });
    g.globalAlpha = 1;
    for (let i = 0; i < pos.length; i++) {
      const p = pos[i], isOut = i >= this.net.outStart;
      g.fillStyle = node; g.strokeStyle = muted; g.lineWidth = pr;
      g.beginPath();
      if (isOut) g.rect(p.x - r, p.y - r, 2 * r, 2 * r); else g.arc(p.x, p.y, r, 0, Math.PI * 2);
      g.fill(); g.stroke();
      // rate coding: a short bright flash per spike (or, with reduced motion, a steady glow as bright as the rate)
      const f = reduceMotion ? Math.min(1, rates[i]) : spikes.flash(i, now);
      if (f > 0) {
        g.globalAlpha = f; g.fillStyle = spike;
        g.beginPath();
        if (isOut) g.rect(p.x - r + 1.5 * pr, p.y - r + 1.5 * pr, 2 * r - 3 * pr, 2 * r - 3 * pr); else g.arc(p.x, p.y, r - 1.5 * pr, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 1;
      }
    }
    // each input's type, as a flat symbol just left of its node
    const glyphs: SenseId[] = [];
    for (let i = 0; i < this.net.nIn; i++) {
      const id = SENSE_IDS[this.net.sense[i]], p = pos[i];
      drawGlyph(g, id, p.x - r - 9 * pr, p.y, 12 * pr, muted);
      glyphs.push(id);
    }
    this.glyphs = glyphs;
    // wheel labels with their speed
    g.font = `${10 * pr}px Arial, Helvetica, sans-serif`; g.textBaseline = 'middle'; g.textAlign = 'left';
    // a speed cell's signed value under it (its flashes show the rate, |value|; the sign says forwards or backwards)
    for (let i = 0; i < this.net.nIn; i++) {
      if (this.net.sense[i] !== SENSE_CODE.speed) continue;
      const p = pos[i], v = vals[i];
      g.fillStyle = muted; g.textAlign = 'center';
      g.fillText((v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2), p.x, p.y + r + 7 * pr);
      g.textAlign = 'left';
    }
    for (let k = 0; k < 4; k++) {
      const p = pos[this.net.outStart + k];
      g.fillStyle = text;
      g.fillText(['FL', 'FR', 'RL', 'RR'][k], p.x + r + 5 * pr, p.y - 6 * pr);
      g.fillStyle = muted;
      const v = vals[this.net.outStart + k];
      g.fillText((v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2), p.x + r + 5 * pr, p.y + 6 * pr);
    }
  }
}
