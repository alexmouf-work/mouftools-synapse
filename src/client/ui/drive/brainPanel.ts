// The live brain panel of the drive view: the workbench's board, scaled down and drawn on a canvas each frame from
// the recorded node outputs and the probe `signal` channel (sender output × weight, brain.signalOf). Car-shaped input
// layer on the left (pins where they sit on the car), hidden lines, the four wheels on the right. Plain workbench
// colours; over budget it shows static, as in the look mock-up.
import type { Net } from '../../../common/sim/brain';
import { IN_UI, OUT_UI } from '../workbench/pins';

interface P { x: number; y: number }

export class BrainPanel {
  private pos = new Map<string, P>();
  private w = 0;
  private h = 0;
  private pr = 1;
  private car = { cx: 0, cy: 0, W: 0, H: 0 };

  constructor(private readonly cv: HTMLCanvasElement, private readonly net: Net) {}

  private layout(): void {
    const r = this.cv.getBoundingClientRect();
    this.pr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(r.width * this.pr)), h = Math.max(1, Math.round(r.height * this.pr));
    if (w === this.w && h === this.h && this.pos.size) return;
    this.w = this.cv.width = w; this.h = this.cv.height = h;
    const s = this.net.spec, pos = new Map<string, P>();
    const H = h * 0.62, W = H * 0.46, cx = w * 0.17, cy = h * 0.5;
    this.car = { cx, cy, W, H };
    const rx = W / 2 + h * 0.13, ry = H / 2 + h * 0.08;
    for (const p of IN_UI) {
      if (p.ring !== undefined) { const t = p.ring * Math.PI / 180; pos.set(p.id, { x: cx + Math.sin(t) * rx, y: cy - Math.cos(t) * ry }); }
      else if (p.corner) pos.set(p.id, { x: cx - rx, y: cy + ry });
      else if (p.at) pos.set(p.id, { x: cx + p.at[0] * W / 2, y: cy + p.at[1] * H / 2 });
    }
    const outX = w - 52 * this.pr, xa = cx + rx + 34 * this.pr, xb = outX - 40 * this.pr; // room right of the wheels for their labels
    OUT_UI.forEach((o, k) => pos.set(o.id, { x: outX, y: cy + (k - 1.5) * Math.min(h * 0.2, 34 * this.pr) }));
    for (let L = 1; L <= s.layers; L++) {
      const x = s.layers === 1 ? (xa + xb) / 2 : xa + (xb - xa) * (L - 1) / (s.layers - 1);
      const list = s.nodes.filter((n) => n.layer === L);
      const step = Math.min(24 * this.pr, (h - 24 * this.pr) / Math.max(list.length - 1, 1));
      list.forEach((n, k) => pos.set(n.id, { x, y: cy + (k - (list.length - 1) / 2) * step }));
    }
    this.pos = pos;
  }

  /** vals: every node's output this tick; signal: per spec wire; noise: 0..1 over-budget level. */
  draw(vals: ArrayLike<number>, signal: ArrayLike<number>, noise: number): void {
    this.layout();
    const g = this.cv.getContext('2d');
    if (!g) return;
    const css = getComputedStyle(document.documentElement);
    const col = (v: string, d: string) => css.getPropertyValue(v).trim() || d;
    const plus = col('--accent', '#2f6fde'), minus = col('--minus', '#d9465b'), muted = col('--muted', '#6a7385'), node = col('--node', '#fff'), carCol = col('--car', '#5b6b88'), text = col('--text', '#1d2330');
    const { w, h, pr } = this;
    g.clearRect(0, 0, w, h);
    // the car, faint
    const { cx, cy, W, H } = this.car;
    g.globalAlpha = 0.12; g.fillStyle = carCol; g.beginPath(); g.roundRect(cx - W / 2, cy - H / 2, W, H, W * 0.18); g.fill();
    g.globalAlpha = 0.35; g.strokeStyle = carCol; g.lineWidth = pr; g.stroke(); g.globalAlpha = 1;
    const jit = () => (noise > 0 ? (Math.random() - 0.5) * noise * 6 * pr : 0);
    const r = 5.5 * pr;
    // wires: colour by sign of the signal, width by its size
    const s = this.net.spec;
    s.conns.forEach((c, k) => {
      const a = this.pos.get(c.from), b = this.pos.get(c.to);
      if (!a || !b) return;
      const sig = signal[k];
      const m = Math.min(1, Math.abs(sig));
      g.strokeStyle = sig >= 0 ? plus : minus;
      g.globalAlpha = 0.18 + 0.75 * m;
      g.lineWidth = (0.6 + 2.4 * m) * pr;
      const x0 = a.x + r, y0 = a.y + jit(), x1 = b.x - r, y1 = b.y + jit(), dx = x1 - x0;
      g.beginPath(); g.moveTo(x0, y0); g.bezierCurveTo(x0 + dx * 0.45, y0, x1 - dx * 0.45, y1, x1, y1); g.stroke();
    });
    g.globalAlpha = 1;
    // nodes: fill by value (sign colour, strength alpha)
    const ids = this.net.ids;
    for (let i = 0; i < ids.length; i++) {
      const p = this.pos.get(ids[i]);
      if (!p) continue;
      const v = vals[i];
      const isIn = i < this.net.nIn, isOut = i >= this.net.outStart;
      const used = !isIn || this.net.inUsed[i] === 1;
      g.fillStyle = node; g.strokeStyle = used ? muted : muted;
      g.globalAlpha = used ? 1 : 0.45;
      g.beginPath();
      if (isOut) g.rect(p.x - r, p.y - r, 2 * r, 2 * r); else g.arc(p.x, p.y, r, 0, Math.PI * 2);
      g.fill(); g.lineWidth = pr; g.setLineDash(used ? [] : [2 * pr, 2 * pr]); g.stroke(); g.setLineDash([]);
      if (used) {
        g.fillStyle = v >= 0 ? plus : minus;
        g.globalAlpha = Math.min(1, 0.15 + 0.85 * Math.abs(v));
        g.beginPath();
        if (isOut) g.rect(p.x - r + 1.5 * pr, p.y - r + 1.5 * pr, 2 * r - 3 * pr, 2 * r - 3 * pr); else g.arc(p.x, p.y, r - 1.5 * pr, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
    }
    // wheel labels with their speed
    g.font = `${10 * pr}px "IBM Plex Mono", ui-monospace, monospace`; g.textBaseline = 'middle'; g.textAlign = 'left';
    OUT_UI.forEach((o, k) => {
      const p = this.pos.get(o.id); if (!p) return;
      g.fillStyle = text;
      g.fillText(['FL', 'FR', 'RL', 'RR'][k], p.x + r + 5 * pr, p.y - 6 * pr);
      g.fillStyle = muted;
      const v = vals[this.net.outStart + k];
      g.fillText((v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2), p.x + r + 5 * pr, p.y + 6 * pr);
    });
    // static over budget
    if (noise > 0) { // speckles in the panel's own ink, so they show on a light or a dark panel
      g.fillStyle = text;
      for (let k = 0; k < 1400 * noise + 80; k++) {
        g.globalAlpha = Math.random() * (0.25 + 0.6 * noise);
        g.fillRect(Math.random() * w, Math.random() * h, 1.6 * pr, 1.6 * pr);
      }
      g.globalAlpha = 1;
    }
  }
}
