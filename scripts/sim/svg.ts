// SVG of a track with car paths, for the bench review (written to the ignored out/ folder).
import type { Track } from '../../src/common/sim/track';

export interface PathLine { label: string; color: string; x: Float64Array; y: Float64Array; ticks: number; note: string }

export function trackSvg(t: Track, lines: PathLine[], title: string): string {
  const off = t.wallOff;
  const L: string[] = [], R: string[] = [], Cn: string[] = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < t.n; i++) {
    const nx = -t.ty[i], ny = t.tx[i];
    const lx = t.px[i] + nx * off, ly = t.py[i] + ny * off, rx = t.px[i] - nx * off, ry = t.py[i] - ny * off;
    L.push(`${lx.toFixed(1)},${(-ly).toFixed(1)}`); R.push(`${rx.toFixed(1)},${(-ry).toFixed(1)}`);
    Cn.push(`${t.px[i].toFixed(1)},${(-t.py[i]).toFixed(1)}`);
    x0 = Math.min(x0, lx, rx); x1 = Math.max(x1, lx, rx); y0 = Math.min(y0, -ly, -ry); y1 = Math.max(y1, -ly, -ry);
  }
  const pad = 30, legendH = 22 * lines.length + 34;
  const vb = `${(x0 - pad).toFixed(0)} ${(y0 - pad - legendH).toFixed(0)} ${(x1 - x0 + 2 * pad).toFixed(0)} ${(y1 - y0 + 2 * pad + legendH).toFixed(0)}`;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" font-family="Arial, Helvetica, sans-serif" font-size="14">`);
  out.push(`<rect x="${x0 - pad}" y="${y0 - pad - legendH}" width="${x1 - x0 + 2 * pad}" height="${y1 - y0 + 2 * pad + legendH}" fill="#f7f8fa"/>`);
  out.push(`<polygon points="${L.join(' ')}" fill="#e3e7ee" stroke="#5b6b88" stroke-width="1.2"/>`);
  out.push(`<polygon points="${R.join(' ')}" fill="#f7f8fa" stroke="#5b6b88" stroke-width="1.2"/>`);
  out.push(`<polygon points="${Cn.join(' ')}" fill="none" stroke="#b9c0cc" stroke-width="0.8" stroke-dasharray="4 6"/>`);
  for (const p of t.pads) {
    const pts: string[] = [];
    for (let j = 0; j <= p.n; j++) { const i = (p.i0 + j) % t.n; pts.push(`${t.px[i].toFixed(1)},${(-t.py[i]).toFixed(1)}`); }
    out.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="#2fb67c" stroke-width="7" stroke-opacity=".45"/>`);
  }
  const s = t.startIdx, nx = -t.ty[s], ny = t.tx[s];
  out.push(`<line x1="${t.px[s] + nx * off}" y1="${-(t.py[s] + ny * off)}" x2="${t.px[s] - nx * off}" y2="${-(t.py[s] - ny * off)}" stroke="#1d2330" stroke-width="3"/>`);
  for (const ln of lines) {
    const pts: string[] = [];
    for (let k = 0; k < ln.ticks; k += 2) pts.push(`${ln.x[k].toFixed(1)},${(-ln.y[k]).toFixed(1)}`);
    out.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${ln.color}" stroke-width="2.2" stroke-opacity=".85" stroke-linejoin="round"/>`);
    const e = ln.ticks - 1;
    if (e >= 0) out.push(`<circle cx="${ln.x[e].toFixed(1)}" cy="${(-ln.y[e]).toFixed(1)}" r="5" fill="${ln.color}"/>`);
  }
  let ly = y0 - pad - legendH + 22;
  out.push(`<text x="${x0 - pad + 12}" y="${ly}" font-weight="700" fill="#1d2330">${title}</text>`);
  for (const ln of lines) {
    ly += 22;
    out.push(`<rect x="${x0 - pad + 12}" y="${ly - 11}" width="18" height="6" fill="${ln.color}"/>`);
    out.push(`<text x="${x0 - pad + 38}" y="${ly - 4}" fill="#1d2330">${ln.label}: ${ln.note}</text>`);
  }
  out.push('</svg>');
  return out.join('\n');
}
