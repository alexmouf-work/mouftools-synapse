// Canvas textures, from the look mock-up (reference/look-mockup.html): road surface, start checker, boost pad, car glow.
import * as THREE from 'three';
import { Rng } from '../../common/rng';

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, aniso: number, repeat = false): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('render: no 2-D canvas context');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export interface Textures { road: THREE.CanvasTexture; checker: THREE.CanvasTexture; boost: THREE.CanvasTexture; glow: THREE.CanvasTexture; dispose(): void }

export function makeTextures(aniso: number): Textures {
  const r = new Rng(20261030);
  const rand = () => r.next();
  const road = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#3c4458'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 14000; i++) {
      const v = rand(); g.fillStyle = v > 0.5 ? `rgba(255,255,255,${0.03 + rand() * 0.07})` : `rgba(0,0,0,${0.05 + rand() * 0.1})`;
      g.fillRect(rand() * w, rand() * h, 1 + rand() * 1.5, 1 + rand() * 1.5);
    }
    for (const y of [0, 256]) { g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(0, y, w, 3); g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(0, y + 3, w, 2); }
    g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(w / 2 - 1, 0, 2, h);
    g.fillStyle = '#f4f7ff'; g.fillRect(14, 0, 12, h); g.fillRect(w - 26, 0, 12, h);
    g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(w / 2 - 4, 40, 8, 120); g.fillRect(w / 2 - 4, 296, 8, 120);
  }, aniso, true);
  const checker = canvasTex(512, 64, (g, w, h) => {
    const s = 32; for (let y = 0; y < h / s; y++) for (let x = 0; x < w / s; x++) { g.fillStyle = (x + y) % 2 ? '#0d1020' : '#f6f8ff'; g.fillRect(x * s, y * s, s, s); }
  }, aniso);
  const boost = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#1b0d02'; g.fillRect(0, 0, w, h);
    const grad = g.createLinearGradient(0, h, 0, 0); grad.addColorStop(0, '#ff6a1a'); grad.addColorStop(1, '#ffd21a');
    g.fillStyle = grad;
    for (let k = 0; k < 2; k++) {
      const y = k * 128 + 20; g.beginPath();
      g.moveTo(30, y + 90); g.lineTo(128, y); g.lineTo(226, y + 90); g.lineTo(226, y + 118); g.lineTo(128, y + 34); g.lineTo(30, y + 118); g.closePath(); g.fill();
    }
  }, aniso, true);
  const glow = canvasTex(128, 128, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.45, 'rgba(255,255,255,.35)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  }, aniso);
  return { road, checker, boost, glow, dispose: () => { road.dispose(); checker.dispose(); boost.dispose(); glow.dispose(); } };
}

/** Text and sign textures for the drive view's stadium (Arial bold, the site's one font). */
export interface StadiumTextures {
  banner(text: string, sub: string, a: string, b: string, fg?: string): THREE.Texture;
  gate(label: string): THREE.Texture;
  lamp: THREE.Texture;
  chevron: THREE.Texture;
  dispose(): void;
}

/** Arial is a system font, so there is nothing to wait for. */
export async function stadiumTextures(aniso: number): Promise<StadiumTextures> {
  const made: THREE.Texture[] = [];
  const keep = <T extends THREE.Texture>(t: T) => { made.push(t); return t; };
  const lamp = keep(canvasTex(256, 128, (g) => {
    g.fillStyle = '#20263a'; g.fillRect(0, 0, 256, 128);
    for (let y = 0; y < 3; y++) for (let x = 0; x < 6; x++) {
      const cx = 24 + x * 42, cy = 24 + y * 40;
      const r = g.createRadialGradient(cx, cy, 0, cx, cy, 18); r.addColorStop(0, '#ffffff'); r.addColorStop(0.6, '#fff4d6'); r.addColorStop(1, '#5a5a66');
      g.fillStyle = r; g.beginPath(); g.arc(cx, cy, 16, 0, Math.PI * 2); g.fill();
    }
  }, aniso));
  const chevron = keep(canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#ffcf1f'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#0d1020';
    for (let k = 0; k < 3; k++) { const x = 24 + k * 76; g.beginPath(); g.moveTo(x, 18); g.lineTo(x + 30, 18); g.lineTo(x + 70, 64); g.lineTo(x + 30, 110); g.lineTo(x, 110); g.lineTo(x + 40, 64); g.closePath(); g.fill(); }
    g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8);
  }, aniso));
  return {
    banner: (text, sub, a, b, fg = '#ffffff') => keep(canvasTex(1024, 320, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, a); gr.addColorStop(1, b);
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,.08)'; for (let x = -h; x < w; x += 48) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + h, 0); g.lineTo(x + h + 16, 0); g.lineTo(x + 16, h); g.fill(); }
      g.fillStyle = fg; g.font = '700 150px Arial, Helvetica, sans-serif'; g.textBaseline = 'middle';
      g.fillText(text, 48, sub ? 128 : 160);
      if (sub) { g.font = '700 52px Arial, Helvetica, sans-serif'; g.globalAlpha = 0.85; g.fillText(sub, 54, 248); g.globalAlpha = 1; }
    }, aniso)),
    gate: (label) => keep(canvasTex(1024, 128, (g, w, h) => {
      g.fillStyle = '#0d1020'; g.fillRect(0, 0, w, h);
      const s = 16; for (let y = 0; y < 2; y++) for (let x = 0; x < w / s; x++) { g.fillStyle = (x + y) % 2 ? '#0d1020' : '#f6f8ff'; g.fillRect(x * s, y * s, s, s); g.fillRect(x * s, h - (2 - y) * s, s, s); }
      g.fillStyle = '#ffc21a'; g.font = '700 64px Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(label, w / 2, h / 2 + 2);
    }, aniso)),
    lamp, chevron,
    dispose: () => made.forEach((t) => t.dispose()),
  };
}

