// Canvas textures, from the look mock-up (reference/look-mockup.html): road surface, start checker, boost pad.
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

export interface Textures { road: THREE.CanvasTexture; checker: THREE.CanvasTexture; boost: THREE.CanvasTexture; dispose(): void }

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
  return { road, checker, boost, dispose: () => { road.dispose(); checker.dispose(); boost.dispose(); } };
}
