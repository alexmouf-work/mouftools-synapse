// Track ribbon geometry from a sim Track, ported from the look mock-up: road, kerbs (red/white in corners, blue on
// straights), run-off, walls (inner face, top, outer skirt) with a light strip, boost pads and the start line. The sim
// is flat; height is render-only: the figure eight's bridge (tracks plan §2) rises on cosine ramps to BRIDGE_H over
// the crossing, its walls are the parapets, with an underside and pillars that stand clear of the road below. Pure
// geometry (no textures or GL), so Node tests can build it.
// World mapping: sim (x, y) → three (x, height, −y); sim left normal (−ty, tx) → three (−ty, 0, −tx).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from '../../common/config';
import type { Track } from '../../common/sim/track';
import { assertFiniteGeometry } from './guard';

export const ROAD = 8, KERB = 9.8, WALL_IN = 12.5, WALL_OUT = 13.3, WALL_H = 1.4;
export const CORNER_CURV = 0.0065; // 1/m: kerbs turn red/white above this
/** Height of the figure eight's bridge deck (m): a car and the walls below clear its underside (BRIDGE_H − 1.2). */
export const BRIDGE_H = 7;
const SKIRT = -1.2; // the skirt's foot, below the road (on the bridge: its underside)
const PILLAR_EVERY = 14; // m along the bridge between pillar pairs

export type PartKey = 'road' | 'kerb' | 'runoff' | 'wall' | 'wallTop' | 'skirt' | 'strip' | 'pad' | 'start' | 'soffit' | 'pillar';
export interface Part { key: PartKey; geometry: THREE.BufferGeometry }

const lifts = new WeakMap<Track, Float64Array>();
/** Per sample: how far the road is lifted (m): 0 off the bridge, cosine ramps to BRIDGE_H over the crossing. */
export function liftOf(t: Track): Float64Array {
  let h = lifts.get(t);
  if (!h) {
    h = new Float64Array(t.n);
    const C = CONFIG.track, up = t.crossing?.upper ?? -1;
    for (let i = 0; i < t.n; i++) {
      if (!t.deck[i]) continue;
      let d = Math.abs(i - up); d = Math.min(d, t.n - d) * t.ds;
      h[i] = d <= C.crossFlat ? BRIDGE_H : BRIDGE_H * (0.5 + 0.5 * Math.cos(Math.PI * Math.min(1, (d - C.crossFlat) / C.crossRamp)));
    }
    lifts.set(t, h);
  }
  return h;
}

/** Fractional sample of a car `prog` metres along from the start (sim progress is unwrapped arc length). */
export function sampleOf(t: Track, prog: number): number {
  const f = (t.startIdx * t.ds + prog) / t.ds;
  return ((f % t.n) + t.n) % t.n;
}

/** Road height and its slope (rise per metre along the samples) at fractional sample f. */
export function liftAt(t: Track, f: number, out = { h: 0, slope: 0 }): { h: number; slope: number } {
  const h = liftOf(t), i = Math.floor(f) % t.n, j = (i + 1) % t.n, u = f - Math.floor(f);
  out.h = h[i] + (h[j] - h[i]) * u;
  out.slope = (h[j] - h[i]) / t.ds;
  return out;
}

/** Pitch (rad, about the car's own X) of a car heading `hdg` on slope `slope` at sample i: nose up going uphill. */
export function pitchOf(t: Track, i: number, hdg: number, slope: number): number {
  const k = ((Math.floor(i) % t.n) + t.n) % t.n;
  const fwd = Math.cos(hdg) * t.tx[k] + Math.sin(hdg) * t.ty[k] >= 0 ? 1 : -1;
  return -Math.atan(slope * fwd);
}

/** World position of the point `o` metres left of the centreline at sample i, `h` up from the road there. */
export function at(t: Track, i: number, o: number, h: number, out = new THREE.Vector3()): THREE.Vector3 {
  i = ((i % t.n) + t.n) % t.n;
  return out.set(t.px[i] - t.ty[i] * o, h + liftOf(t)[i], -(t.py[i] + t.tx[i] * o));
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
    parts.push({ key: 'skirt', geometry: strip(t, 0, N, P(s * WALL_OUT, WALL_H), P(s * WALL_OUT, SKIRT), () => '#1a2444', null, 'skirt') });
    parts.push({ key: 'strip', geometry: strip(t, 0, N, P(s * 12.62, WALL_H + 0.015), P(s * 12.98, WALL_H + 0.015), null, null, 'strip') });
  }
  for (const pad of t.pads) {
    parts.push({ key: 'pad', geometry: strip(t, pad.i0, pad.n, P(-4.2, 0.05), P(4.2, 0.05), null, (_i, side, k) => [side, k / 4], 'pad') });
  }
  // the start/finish line: a chequered band two samples long (about 4 m: four rows of 1 m squares)
  parts.push({ key: 'start', geometry: strip(t, t.startIdx, 2, P(-ROAD, 0.04), P(ROAD, 0.04), null, (_i, side, k) => [side, k * (t.ds / 2)], 'start') });
  parts.push(...bridgeParts(t));
  return parts;
}

/** The bridge's underside (where the deck is above the ground) and its pillars, clear of the road below. */
function bridgeParts(t: Track): Part[] {
  if (!t.crossing) return [];
  const h = liftOf(t), N = t.n, out: Part[] = [];
  let i0 = -1;
  for (let i = 0; i < N; i++) if (h[i] > -SKIRT && h[(i - 1 + N) % N] <= -SKIRT) i0 = i;
  if (i0 < 0) return [];
  let count = 0;
  while (count < N && h[(i0 + count + 1) % N] > -SKIRT) count++;
  out.push({ key: 'soffit', geometry: strip(t, i0, count, (i) => at(t, i, WALL_OUT, SKIRT), (i) => at(t, i, -WALL_OUT, SKIRT), () => '#1a2444', null, 'soffit') });
  // pillars: a pair across the deck every PILLAR_EVERY m where it is high enough to need them, none on the road below
  const lower = t.crossing.lower, clear = WALL_OUT + 1.5, reach = Math.ceil((CONFIG.track.crossFlat + CONFIG.track.crossRamp) / t.ds);
  const onLowerRoad = (x: number, z: number) => {
    for (let k = -reach; k <= reach; k++) {
      const j = ((lower + k) % N + N) % N, dx = x - t.px[j], dz = z + t.py[j];
      if (dx * dx + dz * dz < clear * clear) return true;
    }
    return false;
  };
  const geos: THREE.BufferGeometry[] = [], step = Math.max(1, Math.round(PILLAR_EVERY / t.ds)), p = new THREE.Vector3();
  for (let k = 0; k <= count; k += step) {
    const i = (i0 + k) % N, top = h[i] + SKIRT;
    if (top < 1.5) continue;
    for (const side of [-1, 1]) {
      at(t, i, side * (WALL_OUT - 1), 0, p);
      if (onLowerRoad(p.x, p.z)) continue;
      geos.push(new THREE.BoxGeometry(1.1, top + 1, 1.1).translate(p.x, (top - 1) / 2, p.z));
    }
  }
  if (geos.length) {
    const g = mergeGeometries(geos);
    geos.forEach((x) => x.dispose());
    if (!g) throw new Error('render: bridge pillars did not merge');
    const col = new Float32Array(g.attributes.position.count * 3), c = new THREE.Color('#c9d0dc');
    for (let k = 0; k < col.length; k += 3) { col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.push({ key: 'pillar', geometry: assertFiniteGeometry(g, 'pillars') });
  }
  return out;
}

/** Centre of the track's bounding box, in world space (y = 0). */
export function trackCentre(t: Track): THREE.Vector3 {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < t.n; i++) { x0 = Math.min(x0, t.px[i]); x1 = Math.max(x1, t.px[i]); y0 = Math.min(y0, t.py[i]); y1 = Math.max(y1, t.py[i]); }
  return toWorld((x0 + x1) / 2, (y0 + y1) / 2);
}
