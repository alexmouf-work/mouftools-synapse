// Track ribbon geometry from a sim Track, ported from the look mock-up: road, kerbs (red/white in corners, blue on
// straights), run-off, walls (inner face, top, outer skirt) with a light strip, boost pads and the start line. Flat:
// elevation is render-only and not part of S3. Pure geometry (no textures or GL), so Node tests can build it.
// World mapping: sim (x, y) → three (x, height, −y); sim left normal (−ty, tx) → three (−ty, 0, −tx).
import * as THREE from 'three';
import type { Track } from '../../common/sim/track';
import { assertFiniteGeometry } from './guard';

export const ROAD = 8, KERB = 9.8, WALL_IN = 12.5, WALL_OUT = 13.3, WALL_H = 1.4;
export const CORNER_CURV = 0.0065; // 1/m: kerbs turn red/white above this

export type PartKey = 'road' | 'kerb' | 'runoff' | 'wall' | 'wallTop' | 'skirt' | 'strip' | 'pad' | 'start';
export interface Part { key: PartKey; geometry: THREE.BufferGeometry }

/** World position of the point `o` metres left of the centreline at sample i, `h` up. */
export function at(t: Track, i: number, o: number, h: number, out = new THREE.Vector3()): THREE.Vector3 {
  i = ((i % t.n) + t.n) % t.n;
  return out.set(t.px[i] - t.ty[i] * o, h, -(t.py[i] + t.tx[i] * o));
}

/** Sim position to world. */
export const toWorld = (x: number, y: number, h = 0, out = new THREE.Vector3()) => out.set(x, h, -y);
/** Yaw (rotation about +Y) that turns a model facing +Z to the sim heading. */
export const yawOf = (hdg: number) => hdg + Math.PI / 2;

function strip(
  t: Track, i0: number, count: number, A: (i: number) => THREE.Vector3, B: (i: number) => THREE.Vector3,
  colorOf: ((i: number) => string) | null, uvOf: ((i: number, side: number, k: number) => [number, number]) | null, what: string,
): THREE.BufferGeometry {
  const pos: number[] = [], colr: number[] = [], uv: number[] = [];
  const c = new THREE.Color();
  for (let k = 0; k < count; k++) {
    const i = i0 + k, j = i + 1;
    const a0 = A(i).clone(), b0 = B(i).clone(), a1 = A(j).clone(), b1 = B(j).clone();
    pos.push(a0.x, a0.y, a0.z, b0.x, b0.y, b0.z, a1.x, a1.y, a1.z, b0.x, b0.y, b0.z, b1.x, b1.y, b1.z, a1.x, a1.y, a1.z);
    if (colorOf) { c.set(colorOf(((i % t.n) + t.n) % t.n)); for (let q = 0; q < 6; q++) colr.push(c.r, c.g, c.b); }
    if (uvOf) { const ua0 = uvOf(i, 0, k), ub0 = uvOf(i, 1, k), ua1 = uvOf(j, 0, k + 1), ub1 = uvOf(j, 1, k + 1); uv.push(...ua0, ...ub0, ...ua1, ...ub0, ...ub1, ...ua1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (colorOf) g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  if (uvOf) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return assertFiniteGeometry(g, what);
}

export function trackParts(t: Track): Part[] {
  const N = t.n, ds = t.ds;
  const P = (o: number, h: number) => (i: number) => at(t, i, o, h);
  const parts: Part[] = [];
  parts.push({ key: 'road', geometry: strip(t, 0, N, P(-ROAD, 0.02), P(ROAD, 0.02), null, (i, side) => [side, i * ds / 16], 'road') });
  const corner = (i: number) => Math.abs(t.curv[i]) > CORNER_CURV;
  for (const s of [-1, 1]) {
    parts.push({ key: 'kerb', geometry: strip(t, 0, N, P(s * ROAD, 0.03), P(s * KERB, 0.13), (i) => (corner(i) ? (Math.floor(i / 3) % 2 ? '#e8263f' : '#f6f8fc') : '#1f5eff'), null, 'kerb') });
    parts.push({ key: 'runoff', geometry: strip(t, 0, N, P(s * KERB, 0.02), P(s * WALL_IN, 0.02), (i) => (Math.floor(i / 6) % 2 ? '#bcc6da' : '#adb8cf'), null, 'runoff') });
    parts.push({ key: 'wall', geometry: strip(t, 0, N, P(s * WALL_IN, 0), P(s * WALL_IN, WALL_H), (i) => (Math.floor(i / 9) % 2 ? '#e4e9f3' : '#1f5eff'), null, 'wall') });
    parts.push({ key: 'wallTop', geometry: strip(t, 0, N, P(s * WALL_IN, WALL_H), P(s * WALL_OUT, WALL_H), () => '#cfd6e4', null, 'wallTop') });
    parts.push({ key: 'skirt', geometry: strip(t, 0, N, P(s * WALL_OUT, WALL_H), P(s * WALL_OUT, -1.2), () => '#1a2444', null, 'skirt') });
    parts.push({ key: 'strip', geometry: strip(t, 0, N, P(s * 12.62, WALL_H + 0.015), P(s * 12.98, WALL_H + 0.015), null, null, 'strip') });
  }
  for (const pad of t.pads) {
    parts.push({ key: 'pad', geometry: strip(t, pad.i0, pad.n, P(-4.2, 0.05), P(4.2, 0.05), null, (_i, side, k) => [side, k / 4], 'pad') });
  }
  // the start/finish line: a chequered band two samples long (about 4 m: four rows of 1 m squares)
  parts.push({ key: 'start', geometry: strip(t, t.startIdx, 2, P(-ROAD, 0.04), P(ROAD, 0.04), null, (_i, side, k) => [side, k * (t.ds / 2)], 'start') });
  return parts;
}

/** Centre of the track's bounding box, in world space (y = 0). */
export function trackCentre(t: Track): THREE.Vector3 {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < t.n; i++) { x0 = Math.min(x0, t.px[i]); x1 = Math.max(x1, t.px[i]); y0 = Math.min(y0, t.py[i]); y1 = Math.max(y1, t.py[i]); }
  return toWorld((x0 + x1) / 2, (y0 + y1) / 2);
}
