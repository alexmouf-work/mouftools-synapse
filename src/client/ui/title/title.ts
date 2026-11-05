// The title screen (B2c), ported from reference/title-screen-mockup.html: the card ("Synapse", one line, Multiplayer in
// blue, vs CPU in yellow, Sandbox plain), a quiet fully wired brain firing behind it (still under reduced motion), and
// a rail along the foot with the legal links and the music credits. The page opens here. vs CPU (B7) opens the designer
// in match mode; Multiplayer comes with B8 (until then it shows "soon" and does nothing). Sandbox opens the designer.
import './title.css';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`title: #${id} missing`);
  return e as T;
};

interface Cell { ci: number; x: number; y: number; hz: number; ph: number; fl: number }
let cells: Cell[] = [], wires: [Cell, Cell][] = [];
let W = 0, H = 0, raf = 0, last = 0, shown = false;
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647; // display only: a fixed pattern, not the sim

function build(): void {
  const c = $('titleNet') as HTMLCanvasElement, g = c.getContext('2d');
  if (!g) return;
  const dpr = Math.min(devicePixelRatio, 2);
  W = innerWidth; H = innerHeight;
  c.width = W * dpr; c.height = H * dpr;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  seed = 7; cells = []; wires = [];
  const cols = W < 700 ? [3, 4, 4, 2] : [4, 6, 6, 5, 2], gap = W / (cols.length + 1);
  cols.forEach((n, ci) => { for (let k = 0; k < n; k++) cells.push({ ci, x: gap * (ci + 1), y: H / 2 + (k - (n - 1) / 2) * Math.min(90, H / (n + 1)), hz: 0.2 + rnd() * 1.6, ph: rnd(), fl: 0 }); });
  for (const a of cells) for (const b of cells) if (b.ci === a.ci + 1) wires.push([a, b]);
}

function draw(dt: number): void {
  const c = $('titleNet') as HTMLCanvasElement, g = c.getContext('2d');
  if (!g) return;
  const css = getComputedStyle(document.documentElement), v = (k: string, d: string) => css.getPropertyValue(k).trim() || d;
  const wire = v('--wire', '#b8c0cf'), node = v('--node', '#ffffff'), spike = v('--spike', '#ffc21a');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  g.clearRect(0, 0, W, H);
  g.lineWidth = 1;
  for (const [a, b] of wires) {
    g.strokeStyle = wire; g.globalAlpha = 0.35 + 0.5 * a.fl;
    const dx = b.x - a.x;
    g.beginPath(); g.moveTo(a.x, a.y); g.bezierCurveTo(a.x + dx * 0.45, a.y, b.x - dx * 0.45, b.y, b.x, b.y); g.stroke();
  }
  g.globalAlpha = 1;
  for (const p of cells) {
    if (!reduce) { p.ph += p.hz * dt; if (p.ph >= 1) { p.ph -= 1; p.fl = 1; } p.fl = Math.max(0, p.fl - dt * 4); }
    g.fillStyle = node; g.strokeStyle = wire; g.lineWidth = 1.5;
    g.beginPath(); g.arc(p.x, p.y, 11, 0, 7); g.fill(); g.stroke();
    if (p.fl > 0) { g.globalAlpha = p.fl; g.fillStyle = spike; g.beginPath(); g.arc(p.x, p.y, 9, 0, 7); g.fill(); g.globalAlpha = 1; }
  }
}

function frame(now: number): void {
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0, now - last) / 1000);
  last = now;
  draw(dt);
}

/** Show or hide the title (its brain animates only while it shows). */
export function showTitle(on: boolean): void {
  shown = on;
  $('title').hidden = !on;
  cancelAnimationFrame(raf);
  if (on) { build(); last = performance.now(); raf = requestAnimationFrame(frame); }
}
export const titleShown = (): boolean => shown;

export function startTitle(o: { onSandbox(): void; onCpu(): void }): void {
  $('toSandbox').onclick = () => o.onSandbox();
  $('toCpu').onclick = () => o.onCpu();
  addEventListener('resize', () => { if (shown) build(); });
}
