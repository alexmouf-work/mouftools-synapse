// Light scenery round a generated track, from the look mock-up: low-poly terrain (flat near the track, rising to
// hills and ridges far away), groves of trees, and clouds. Render-only and derived from the track seed, so a seed
// always looks the same. Uses engine Math freely: nothing here feeds the sim.
import * as THREE from 'three';
import { Rng } from '../../common/rng';
import type { Track } from '../../common/sim/track';
import { assertCapacity, assertFiniteGeometry, setInstance } from './guard';
import { trackCentre } from './trackMesh';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const smooth = (e0: number, e1: number, x: number) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
function hash2(x: number, y: number) { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); }
function vnoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < 4; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; } return s; }

export interface Scenery { group: THREE.Group; dispose(): void }

export function buildScenery(t: Track, seed: number): Scenery {
  const rng = new Rng(seed ^ 0x5ce4e);
  const rand = () => rng.next();
  const group = new THREE.Group();
  const centre = trackCentre(t);
  // world-space centreline, every 5th sample, for distance queries
  const coarse: number[] = [];
  for (let i = 0; i < t.n; i += 5) coarse.push(t.px[i], -t.py[i]);
  const distToTrack = (x: number, z: number) => {
    let m = 1e12;
    for (let k = 0; k < coarse.length; k += 2) { const dx = x - coarse[k], dz = z - coarse[k + 1]; const d = dx * dx + dz * dz; if (d < m) m = d; }
    return Math.sqrt(m);
  };
  const terrainH = (x: number, z: number, d: number) => {
    const far = smooth(40, 260, d);
    const n = fbm(x * 0.0035 + 3.1, z * 0.0035 - 1.7);
    const ridge = smooth(500, 1100, Math.hypot(x - centre.x, z - centre.z));
    return -0.35 + far * (n * 55 + 4) + ridge * (n * 160 + 40) + smooth(24, 50, d) * (vnoise(x * 0.05, z * 0.05) - 0.5) * 1.6;
  };
  const disposables: { dispose(): void }[] = [];

  // terrain
  {
    const size = 2800, seg = 190;
    const g = new THREE.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI / 2).toNonIndexed();
    const pos = g.attributes.position;
    const cache = new Map<string, number>();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + centre.x, z = pos.getZ(i) + centre.z;
      const key = x.toFixed(2) + ',' + z.toFixed(2);
      let h = cache.get(key);
      if (h === undefined) { h = terrainH(x, z, distToTrack(x, z)); cache.set(key, h); }
      pos.setXYZ(i, x, h, z);
    }
    const cols = new Float32Array(pos.count * 3);
    const low = new THREE.Color('#46c25e'), mid = new THREE.Color('#2f9f58'), high = new THREE.Color('#9fd06c'), peak = new THREE.Color('#eef1f6'), c = new THREE.Color();
    for (let f = 0; f < pos.count; f += 3) {
      const hy = (pos.getY(f) + pos.getY(f + 1) + pos.getY(f + 2)) / 3;
      if (hy < 6) c.copy(low).lerp(mid, smooth(0, 6, hy));
      else if (hy < 70) c.copy(mid).lerp(high, smooth(6, 70, hy));
      else c.copy(high).lerp(peak, smooth(110, 170, hy));
      c.multiplyScalar(0.92 + rand() * 0.14);
      for (let q = 0; q < 3; q++) cols.set([c.r, c.g, c.b], (f + q) * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    g.computeVertexNormals();
    assertFiniteGeometry(g, 'terrain');
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, envMapIntensity: 0.35 });
    const ground = new THREE.Mesh(g, mat);
    ground.receiveShadow = true; group.add(ground);
    disposables.push(g, mat);
  }

  // trees, in groves
  {
    const roundGeo = new THREE.IcosahedronGeometry(1, 0), coneGeo = new THREE.ConeGeometry(1, 2.4, 6), trunkGeo = new THREE.CylinderGeometry(0.14, 0.22, 1, 5);
    const leafMat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.85 });
    const trunkMat = new THREE.MeshStandardMaterial({ color: '#6b4a34', roughness: 0.9, flatShading: true });
    const MAX = 700;
    const rounds = new THREE.InstancedMesh(roundGeo, leafMat, MAX), cones = new THREE.InstancedMesh(coneGeo, leafMat, MAX), trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, MAX * 2);
    rounds.name = 'trees.round'; cones.name = 'trees.cone'; trunks.name = 'trees.trunk';
    const pal = ['#2fb36b', '#239a5c', '#4fcc6e', '#1d8a55', '#7fd35a', '#ffb547', '#ff7a59'];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), cc = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
    let nr = 0, nc = 0, nt = 0, tries = 0;
    while ((nr < MAX || nc < MAX) && tries < 9000) {
      tries++;
      const x = centre.x + (rand() - 0.5) * 1500, z = centre.z + (rand() - 0.5) * 1500;
      const d = distToTrack(x, z);
      if (d < 22 + rand() * 6) continue;
      if (vnoise(x * 0.012, z * 0.012) < 0.42 && d > 60) continue;
      const h = terrainH(x, z, d);
      if (h > 120) continue;
      const size = 2.4 + rand() * 3.6;
      const isCone = nr >= MAX || (nc < MAX && rand() < 0.45);
      cc.set(pal[rand() < 0.88 ? Math.floor(rand() * 5) : 5 + Math.floor(rand() * 2)]);
      q.setFromAxisAngle(up, rand() * 6.28);
      const trunkH = size * 0.7;
      ps.set(x, h + trunkH / 2 - 0.2, z); sc.set(size, trunkH, size); m4.compose(ps, q, sc); setInstance(trunks, nt++, m4);
      if (isCone) { ps.set(x, h + trunkH + size * 0.9, z); sc.set(size, size, size); m4.compose(ps, q, sc); setInstance(cones, nc, m4); cones.setColorAt(nc, cc); nc++; }
      else { ps.set(x, h + trunkH + size * 0.75, z); sc.set(size * 1.05, size * 1.2, size * 1.05); m4.compose(ps, q, sc); setInstance(rounds, nr, m4); rounds.setColorAt(nr, cc); nr++; }
    }
    assertCapacity(trunks, nt);
    rounds.count = nr; cones.count = nc; trunks.count = nt;
    for (const m of [rounds, cones, trunks]) { m.castShadow = true; m.receiveShadow = true; group.add(m); }
    disposables.push(roundGeo, coneGeo, trunkGeo, leafMat, trunkMat, rounds, cones, trunks);
  }

  // clouds
  {
    const cg = new THREE.IcosahedronGeometry(1, 0);
    const cm = new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 1, emissive: '#cfe0ff', emissiveIntensity: 0.25 });
    for (let k = 0; k < 16; k++) {
      const a = rand() * Math.PI * 2, r = 420 + rand() * 520;
      const g = new THREE.Group(); g.position.set(centre.x + Math.cos(a) * r, 120 + rand() * 110, centre.z + Math.sin(a) * r);
      const puffs = 4 + Math.floor(rand() * 4);
      for (let p = 0; p < puffs; p++) { const m = new THREE.Mesh(cg, cm); const s = 14 + rand() * 18; m.scale.set(s * 1.4, s * 0.8, s); m.position.set((p - puffs / 2) * 16 + rand() * 6, rand() * 8, rand() * 14 - 7); g.add(m); }
      group.add(g);
    }
    disposables.push(cg, cm);
  }
  return { group, dispose: () => disposables.forEach((d) => d.dispose()) };
}
