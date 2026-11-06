// Flat 2-D symbols of the five input types for the corner brain card (CPU designs and card icons plan 2026-11-06 §2),
// the same pictures as the designer's tray icons: a brick wall (boundary), a distant wall with a sight line (long
// range), a curved arrow (head direction), the hexagon of discs (grid), a gauge (speed). Drawn in a box of side `s`
// centred on (x, y), in one colour.
import type { SenseId } from '../../../common/sim/spec';

export function drawGlyph(g: CanvasRenderingContext2D, id: SenseId, x: number, y: number, s: number, color: string): void {
  const h = s / 2, lw = Math.max(1, s / 9);
  g.save();
  g.strokeStyle = color; g.fillStyle = color; g.lineWidth = lw; g.lineCap = 'round'; g.lineJoin = 'round';
  g.globalAlpha = 1;
  if (id === 'boundary') {
    // a brick wall: three courses, the middle one offset
    const t = y - h * 0.75, b = y + h * 0.75, l = x - h, r = x + h, row = (b - t) / 3;
    g.strokeRect(l, t, r - l, b - t);
    g.beginPath();
    for (let k = 1; k < 3; k++) { g.moveTo(l, t + k * row); g.lineTo(r, t + k * row); }
    for (let k = 0; k < 3; k++) {
      const yt = t + k * row, yb = yt + row, xs = k % 2 ? [x - h * 0.5, x + h * 0.5] : [x];
      for (const xx of xs) { g.moveTo(xx, yt); g.lineTo(xx, yb); }
    }
    g.stroke();
  } else if (id === 'far') {
    // a distant wall (a short tall bar on the right) and a dashed sight line to it from the eye on the left
    g.fillRect(x + h * 0.55, y - h * 0.8, h * 0.4, h * 1.6);
    g.beginPath(); g.arc(x - h * 0.8, y, lw * 1.1, 0, Math.PI * 2); g.fill();
    g.setLineDash([lw * 1.4, lw * 1.2]);
    g.beginPath(); g.moveTo(x - h * 0.55, y); g.lineTo(x + h * 0.45, y); g.stroke();
    g.setLineDash([]);
  } else if (id === 'hd') {
    // a curved arrow: three quarters of a circle with a head at its end
    const R = h * 0.7, a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    g.beginPath(); g.arc(x, y, R, a0, a1); g.stroke();
    const ex = x + R * Math.cos(a1), ey = y + R * Math.sin(a1), tx = -Math.sin(a1), ty = Math.cos(a1), nx = Math.cos(a1), ny = Math.sin(a1), k = h * 0.45;
    g.beginPath();
    g.moveTo(ex + tx * k, ey + ty * k);
    g.lineTo(ex + nx * k * 0.6, ey + ny * k * 0.6);
    g.lineTo(ex - nx * k * 0.6, ey - ny * k * 0.6);
    g.closePath(); g.fill();
  } else if (id === 'grid') {
    // the hexagon of discs: six round a centre one
    const R = h * 0.62, d = h * 0.2;
    g.beginPath(); g.arc(x, y, d, 0, Math.PI * 2); g.fill();
    for (let k = 0; k < 6; k++) { const a = (k * Math.PI) / 3; g.beginPath(); g.arc(x + R * Math.cos(a), y + R * Math.sin(a), d, 0, Math.PI * 2); g.fill(); }
  } else {
    // a gauge: the upper half of a dial and a needle
    const R = h * 0.85, cy = y + h * 0.35;
    g.beginPath(); g.arc(x, cy, R, Math.PI, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(x, cy); g.lineTo(x + R * 0.55, cy - R * 0.6); g.stroke();
    g.beginPath(); g.arc(x, cy, lw * 1.1, 0, Math.PI * 2); g.fill();
  }
  g.restore();
}
