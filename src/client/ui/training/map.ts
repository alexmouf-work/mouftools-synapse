// The training view's map (B6, mock-up reference/training-view-mockup.html): the whole of training track 0 in the
// camera's bottom-right corner, the chequered finish across the road, every shown car as a dot and the highlighted
// one ringed. A 2-D canvas, redrawn a few times a second. On the figure eight the bridge is drawn last (tracks plan §2):
// the road, the cars on the ground (those under the bridge hidden by it), the deck with a white edge and a soft
// shadow, then the cars on it.
import type { Track } from '../../../common/sim/track';
import type { Dot } from '../../render/ghosts';

export class TrackMap {
  private t: Track | null = null;
  private w = 0;
  private h = 0;
  private pr = 1;
  private sx = 1;
  private ox = 0;
  private oy = 0;
  constructor(private readonly cv: HTMLCanvasElement) {}

  setTrack(t: Track): void { this.t = t; this.w = 0; }

  private layout(): boolean {
    const r = this.cv.getBoundingClientRect(), t = this.t;
    if (!t || r.width < 4 || r.height < 4) return false;
    this.pr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(r.width * this.pr), h = Math.round(r.height * this.pr);
    if (w === this.w && h === this.h) return true;
    this.w = this.cv.width = w; this.h = this.cv.height = h;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < t.n; i++) { x0 = Math.min(x0, t.px[i]); x1 = Math.max(x1, t.px[i]); y0 = Math.min(y0, t.py[i]); y1 = Math.max(y1, t.py[i]); }
    const pad = 10 * this.pr;
    this.sx = Math.min((w - 2 * pad) / Math.max(x1 - x0, 1), (h - 2 * pad) / Math.max(y1 - y0, 1));
    this.ox = (w - (x1 - x0) * this.sx) / 2 - x0 * this.sx;
    this.oy = (h + (y1 - y0) * this.sx) / 2 + y0 * this.sx; // sim y up → canvas y down
    return true;
  }

  private X(x: number): number { return this.ox + x * this.sx; }
  private Y(y: number): number { return this.oy - y * this.sx; }

  draw(dots: readonly Dot[]): void {
    if (!this.layout()) return;
    const g = this.cv.getContext('2d'), t = this.t as Track;
    if (!g) return;
    const css = getComputedStyle(document.documentElement), col = (v: string, d: string) => css.getPropertyValue(v).trim() || d;
    const pr = this.pr;
    g.clearRect(0, 0, this.w, this.h);
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.strokeStyle = col('--road', '#c9d0dc');
    g.lineWidth = Math.max(3 * pr, 16 * this.sx);
    g.beginPath();
    for (let i = 0; i <= t.n; i++) { const k = i % t.n; if (i) g.lineTo(this.X(t.px[k]), this.Y(t.py[k])); else g.moveTo(this.X(t.px[k]), this.Y(t.py[k])); }
    g.stroke();
    const roadW = g.lineWidth;
    // the chequered finish: a short band across the road at the start line
    {
      const i = t.startIdx, cx = this.X(t.px[i]), cy = this.Y(t.py[i]);
      const ang = Math.atan2(-t.ty[i], t.tx[i]); // canvas angle of the track direction
      const half = Math.max(4 * pr, 9 * this.sx), sq = half / 2;
      g.save(); g.translate(cx, cy); g.rotate(ang);
      for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) {
        g.fillStyle = (r + c) % 2 ? '#0d1020' : '#f6f8ff';
        g.fillRect(-sq + r * sq, -half + c * sq, sq, sq);
      }
      g.restore();
    }
    this.cars(g, dots, 0, col);
    if (t.crossing) {
      // the deck: its samples in order from where it leaves the ground
      let i0 = -1;
      for (let i = 0; i < t.n; i++) if (t.deck[i] && !t.deck[(i - 1 + t.n) % t.n]) i0 = i;
      const deck = () => {
        g.beginPath();
        for (let k = 0, i = i0; k < t.n && t.deck[i]; k++, i = (i + 1) % t.n) { if (k) g.lineTo(this.X(t.px[i]), this.Y(t.py[i])); else g.moveTo(this.X(t.px[i]), this.Y(t.py[i])); }
      };
      g.lineCap = 'butt';
      g.save(); g.shadowColor = 'rgba(0,0,0,.4)'; g.shadowBlur = 6 * pr; g.strokeStyle = col('--deck', '#8f9aae'); g.lineWidth = roadW + 3 * pr; deck(); g.stroke(); g.restore();
      g.strokeStyle = '#ffffff'; g.lineWidth = roadW + 3 * pr; deck(); g.stroke();
      g.strokeStyle = col('--deck', '#8f9aae'); g.lineWidth = roadW; deck(); g.stroke();
      g.lineCap = 'round';
      this.cars(g, dots, 1, col);
    }
  }

  /** The cars on one deck (0: the ground, 1: the bridge), the highlighted one ringed and on top. */
  private cars(g: CanvasRenderingContext2D, dots: readonly Dot[], deck: number, col: (v: string, d: string) => string): void {
    const pr = this.pr, hl = col('--spike', '#ffc21a');
    for (const d of dots) {
      if (d.hl || (d.deck ?? 0) !== deck) continue;
      g.globalAlpha = Math.max(0.25, d.alpha);
      g.fillStyle = col('--accent', '#2f6fde');
      g.beginPath(); g.arc(this.X(d.x), this.Y(d.y), 2.6 * pr, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    for (const d of dots) {
      if (!d.hl || (d.deck ?? 0) !== deck) continue;
      g.fillStyle = hl;
      g.beginPath(); g.arc(this.X(d.x), this.Y(d.y), 3.2 * pr, 0, Math.PI * 2); g.fill();
      g.strokeStyle = hl; g.lineWidth = 1.6 * pr;
      g.beginPath(); g.arc(this.X(d.x), this.Y(d.y), 7 * pr, 0, Math.PI * 2); g.stroke();
    }
  }
}
