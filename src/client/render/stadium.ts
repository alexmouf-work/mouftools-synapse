// The drive view's stadium, from the look mock-up ("FIRE"): a grandstand with a crowd and a SYNAPSE banner by the
// start, a start gate and checkpoint gates, SYNAPSE billboards, floodlights, chevron boards on tight corners, and the
// broadcast camera spots. Built from a sim Track; textures are passed in so Node tests can build it without a canvas.
// Lit surfaces stay under the bloom threshold; lit bands and lamp heads are tagged glow. Every stand, board, light and
// camera spot goes on the side of the road that is clear of the rest of the track (the hairpin's, clover's and figure
// eight's other roads can be close), and none by the figure eight's crossing.
import * as THREE from 'three';
import { Rng } from '../../common/rng';
import type { Track } from '../../common/sim/track';
import { fadeNear } from './glow';
import { assertCapacity, assertFiniteGeometry, setInstance } from './guard';
import { at, trackCentre, WALL_H, WALL_OUT } from './trackMesh';

export interface StadiumTex {
  banner(text: string, sub: string, a: string, b: string, fg?: string): THREE.Texture;
  gate(label: string): THREE.Texture;
  lamp: THREE.Texture;
  chevron: THREE.Texture;
}
export interface KeepClear { x: number; z: number; r: number }
export interface Stadium { group: THREE.Group; tvSpots: { i: number; p: THREE.Vector3 }[]; keepClear: KeepClear[]; dispose(): void }

const LIT = new THREE.Color(0.35, 1.9, 2.5);

export function buildStadium(t: Track, tex: StadiumTex): Stadium {
  const group = new THREE.Group();
  const rng = new Rng(t.seed ^ 0x57ad);
  const rand = () => rng.next();
  const geos: THREE.BufferGeometry[] = [], mats: THREE.Material[] = [];
  const G = <T extends THREE.BufferGeometry>(g: T) => { geos.push(assertFiniteGeometry(g, 'stadium') as T); return g; };
  const M = <T extends THREE.Material>(m: T) => { mats.push(m); return m; };
  const centre = trackCentre(t);
  const keepClear: KeepClear[] = [];
  const v0 = new THREE.Vector3(), v1 = new THREE.Vector3();
  /** +1 if the left side of sample i faces away from the track's centre. */
  const outSide = (i: number) => { at(t, i, 0, 0, v0); at(t, i, 1, 0, v1); return Math.sign((v1.x - v0.x) * (v0.x - centre.x) + (v1.z - v0.z) * (v0.z - centre.z)) || 1; };
  /** Orientation with local +X pointing to `side` (+1 = left of travel) and local +Z along the track. */
  const frame = (i: number, side: number) => {
    at(t, i, 0, 0, v0); at(t, i, side, 0, v1);
    const x = v1.clone().sub(v0).normalize(), y = new THREE.Vector3(0, 1, 0), z = new THREE.Vector3().crossVectors(x, y);
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  };
  const glow = <T extends THREE.Object3D>(o: T) => { o.userData.glow = true; return o; };
  /** Every point `o` m to `side` of samples i + k (k over ks) is at least `gap` m from the centreline, off the crossing. */
  const clear = (i: number, side: number, ks: readonly number[], os: readonly number[], gap: number) => {
    for (const k of ks) {
      const j = ((i + k) % t.n + t.n) % t.n;
      if (t.layer[j]) return false;
      for (const o of os) {
        at(t, j, side * o, 0, v0);
        for (let q = 0; q < t.n; q += 2) { const dx = v0.x - t.px[q], dz = v0.z + t.py[q]; if (dx * dx + dz * dz < gap * gap) return false; }
      }
    }
    return true;
  };
  /** The side (±1) to put something on, the outside first, or 0 if neither is clear. */
  const sideFor = (i: number, ks: readonly number[], os: readonly number[], gap: number) => {
    const s = outSide(i);
    return clear(i, s, ks, os, gap) ? s : clear(i, -s, ks, os, gap) ? -s : 0;
  };
  const litMat = M(fadeNear(new THREE.MeshBasicMaterial({ color: LIT })));

  // grandstand on the outside of the start straight
  {
    const i = (t.startIdx + Math.round(34 / t.ds)) % t.n, LEN = 120, tiers = 8;
    const along = [-30, -15, 0, 15, 30].map((m) => Math.round(m / t.ds)), deep = [WALL_OUT + 5, WALL_OUT + 15, WALL_OUT + 5 + tiers * 2.4 + 6];
    const s = sideFor(i, along, deep, WALL_OUT + 2) || outSide(i);
    const g = new THREE.Group();
    const seatMats = [M(new THREE.MeshStandardMaterial({ color: '#1f5eff', roughness: 0.6, flatShading: true })), M(new THREE.MeshStandardMaterial({ color: '#c3cad8', roughness: 0.8, flatShading: true }))];
    // the pale tiers and crowd are toned down and matte: since B5 a track can face any way, and a near-white tier or
    // spectator square to a low sun went over the bloom threshold (1.61 at the drive check's start)
    const crowd = new THREE.InstancedMesh(G(new THREE.BoxGeometry(0.55, 0.8, 0.5)), M(new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true })), tiers * 130);
    crowd.name = 'crowd';
    const m4 = new THREE.Matrix4(), cc = new THREE.Color(), pal = ['#ffc21a', '#ff3d7f', '#1ed2f0', '#78e04a', '#f3f6fb', '#ff7a1a', '#1f5eff'];
    let n = 0;
    for (let k = 0; k < tiers; k++) {
      const h = 1.1 * (k + 1);
      const tier = new THREE.Mesh(G(new THREE.BoxGeometry(2.4, h, LEN)), seatMats[k % 2]);
      tier.position.set(k * 2.4 + 1.2, h / 2 - 0.4, 0); tier.castShadow = tier.receiveShadow = true; g.add(tier);
      for (let z = -LEN / 2 + 1; z < LEN / 2 - 1 && n < crowd.instanceMatrix.count; z += 0.92) {
        if (rand() < 0.18) continue;
        m4.makeTranslation(k * 2.4 + 1.0 + rand() * 0.5, h, z + rand() * 0.3);
        setInstance(crowd, n, m4); cc.set(pal[Math.floor(rand() * pal.length)]).multiplyScalar(0.8); crowd.setColorAt(n, cc); n++;
      }
    }
    assertCapacity(crowd, n);
    crowd.count = n; crowd.castShadow = true; g.add(crowd);
    const back = tiers * 2.4, roofY = 1.1 * tiers + 7;
    const roof = new THREE.Mesh(G(new THREE.BoxGeometry(back + 8, 0.7, LEN + 6)), M(new THREE.MeshStandardMaterial({ color: '#cdd5e4', roughness: 0.75, metalness: 0.05, flatShading: true, envMapIntensity: 0.4 })));
    roof.position.set(back / 2 - 2, roofY, 0); roof.rotation.z = 0.06; roof.castShadow = true; g.add(roof);
    const roofLight = glow(new THREE.Mesh(G(new THREE.BoxGeometry(0.4, 0.25, LEN + 6)), litMat));
    roofLight.position.set(-6, roofY - 0.2, 0); g.add(roofLight);
    const colMat = M(new THREE.MeshStandardMaterial({ color: '#1a2444', roughness: 0.5 })), colGeo = G(new THREE.BoxGeometry(0.9, roofY + 1, 0.9));
    for (let z = -LEN / 2; z <= LEN / 2; z += 20) { const col = new THREE.Mesh(colGeo, colMat); col.position.set(back + 0.5, (roofY + 1) / 2 - 0.5, z); col.castShadow = true; g.add(col); }
    const board = new THREE.Mesh(G(new THREE.PlaneGeometry(38, 11.9)), M(new THREE.MeshStandardMaterial({ map: tex.banner('SYNAPSE', 'Build · Train · Drive', '#ff3d7f', '#ff7a1a'), roughness: 0.5 })));
    board.position.set(back / 2, roofY + 6.6, 0); board.rotation.y = -Math.PI / 2; g.add(board);
    const boardBack = new THREE.Mesh(G(new THREE.BoxGeometry(0.6, 12.4, 38.6)), M(new THREE.MeshStandardMaterial({ color: '#121a33' })));
    boardBack.position.set(back / 2 + 0.35, roofY + 6.6, 0); g.add(boardBack);
    at(t, i, s * (WALL_OUT + 5), 0, g.position);
    g.quaternion.copy(frame(i, s));
    group.add(g);
    keepClear.push({ x: g.position.x, z: g.position.z, r: 80 });
  }

  // gates: start and checkpoints
  {
    const pillarMat = M(new THREE.MeshStandardMaterial({ color: '#121a33', roughness: 0.4, metalness: 0.3, flatShading: true }));
    const bigLit = M(fadeNear(new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.7, 0.2) })));
    t.gates.forEach((gi, k) => {
      const big = k === 0, H = big ? 10 : 8.5, span = WALL_OUT + 1.2;
      const g = new THREE.Group();
      const lit = big ? bigLit : litMat;
      for (const sd of [-1, 1]) {
        const p = new THREE.Mesh(G(new THREE.BoxGeometry(1.8, H, 1.8)), pillarMat); p.position.set(sd * span, H / 2, 0); p.castShadow = true; g.add(p);
        const band = glow(new THREE.Mesh(G(new THREE.BoxGeometry(0.25, H - 1, 1.85)), lit)); band.position.set(sd * (span - 0.95), H / 2, 0); g.add(band);
      }
      const face = M(new THREE.MeshStandardMaterial({ map: tex.gate(big ? 'START · SYNAPSE' : `CHECKPOINT ${k}`), roughness: 0.5 }));
      const beam = new THREE.Mesh(G(new THREE.BoxGeometry(span * 2 + 1.8, 2.4, 1.6)), [pillarMat, pillarMat, pillarMat, pillarMat, face, face]);
      beam.position.y = H; beam.castShadow = true; g.add(beam);
      const under = glow(new THREE.Mesh(G(new THREE.BoxGeometry(span * 2 - 1.8, 0.18, 1.0)), lit)); under.position.y = H - 1.25; g.add(under);
      const idx = big ? (t.startIdx + 2) % t.n : gi;
      at(t, idx, 0, 0, g.position);
      g.quaternion.copy(frame(idx, 1));
      group.add(g);
    });
  }

  // billboards and floodlights on the outside
  const faceTrack = (g: THREE.Object3D, i: number) => { const tg = at(t, i, 0, 0); g.rotation.set(0, Math.atan2(tg.x - g.position.x, tg.z - g.position.z), 0); };
  {
    const frameMat = M(new THREE.MeshStandardMaterial({ color: '#121a33', roughness: 0.5 }));
    const boards: [number, string, string, string, string?][] = [
      [0.22, 'Evolution · Pop 64', '#1f5eff', '#1ed2f0'],
      [0.52, '% of energy budget', '#121a33', '#1f5eff', '#ffc21a'],
      [0.8, 'Build · Train · Drive', '#78e04a', '#1ed2f0', '#0d1020'],
    ];
    for (const [f, sub, a, b, fg] of boards) {
      const i = Math.round(f * t.n) % t.n, s = sideFor(i, [-8, 0, 8], [34], WALL_OUT + 16);
      if (!s) continue;
      const g = new THREE.Group();
      const panel = new THREE.Mesh(G(new THREE.PlaneGeometry(30, 9.4)), M(new THREE.MeshStandardMaterial({ map: tex.banner('SYNAPSE', sub, a, b, fg), roughness: 0.5 })));
      panel.position.y = 11; g.add(panel);
      const fr = new THREE.Mesh(G(new THREE.BoxGeometry(30.8, 10.2, 0.6)), frameMat); fr.position.set(0, 11, -0.35); fr.castShadow = true; g.add(fr);
      for (const x of [-10, 10]) { const p = new THREE.Mesh(G(new THREE.BoxGeometry(0.8, 7, 0.8)), frameMat); p.position.set(x, 3.2, -0.4); p.castShadow = true; g.add(p); }
      at(t, i, s * 34, -0.5, g.position);
      faceTrack(g, i + 6);
      group.add(g); keepClear.push({ x: g.position.x, z: g.position.z, r: 22 });
    }
    // satin, not polished: a polished pale pole glinted to 1.4 against a low sun (bloom audit, brain v2 drive)
    const poleMat = M(new THREE.MeshStandardMaterial({ color: '#d7deec', roughness: 0.75, metalness: 0.15, flatShading: true }));
    const lampMat = M(new THREE.MeshBasicMaterial({ map: tex.lamp, color: new THREE.Color(2.4, 2.3, 2.1) }));
    for (const f of [0.14, 0.36, 0.64, 0.9]) {
      const i = Math.round(f * t.n) % t.n, s = sideFor(i, [0], [30], WALL_OUT + 3);
      if (!s) continue;
      const g = new THREE.Group();
      const pole = new THREE.Mesh(G(new THREE.CylinderGeometry(0.5, 0.9, 46, 6)), poleMat); pole.position.y = 23; pole.castShadow = true; g.add(pole);
      const head = new THREE.Mesh(G(new THREE.BoxGeometry(9, 4.5, 1.4)), [poleMat, poleMat, poleMat, poleMat, lampMat, poleMat]);
      head.position.set(0, 47, 0.6); head.rotation.x = 0.35; head.castShadow = true; head.userData.glow = true; g.add(head);
      at(t, i, s * 30, -0.3, g.position);
      faceTrack(g, i);
      group.add(g); keepClear.push({ x: g.position.x, z: g.position.z, r: 8 });
    }
  }

  // chevron boards on the outside of tight corners
  {
    const mat = M(new THREE.MeshStandardMaterial({ map: tex.chevron, roughness: 0.45, side: THREE.DoubleSide }));
    const geo = G(new THREE.PlaneGeometry(3.6, 1.8)), postGeo = G(new THREE.BoxGeometry(0.18, 1.0, 0.18)), postMat = M(new THREE.MeshStandardMaterial({ color: '#1a2444' }));
    const step = Math.max(1, Math.round(14 / t.ds));
    for (let i = 0; i < t.n; i += step) {
      if (Math.abs(t.curv[i]) < 0.016) continue;
      const s = -Math.sign(t.curv[i]); // the outside of the corner (curvature + = turning left)
      const m = new THREE.Mesh(geo, mat);
      at(t, i, s * 12.9, WALL_H + 1.5, m.position);
      const inward = at(t, i, s * 11.9, WALL_H + 1.5);
      m.lookAt(inward);
      m.castShadow = true; group.add(m);
      const post = new THREE.Mesh(postGeo, postMat); at(t, i, s * 12.9, WALL_H + 0.5, post.position); group.add(post);
    }
  }

  // broadcast camera spots (follow-a-racer plan, broadcast in matches): about 140 m apart, 40–60 m off the centreline
  // and 8–18 m up; where neither side is clear that far out (another stretch of track), 30 m if that is clear
  const tvSpots: Stadium['tvSpots'] = [];
  for (let i = 5; i < t.n; i += Math.round(140 / t.ds)) {
    let off = 40 + rand() * 20, s = sideFor(i, [0], [off], WALL_OUT + 4);
    const hy = 8 + rand() * 10;
    if (!s) { off = 30; s = sideFor(i, [0], [off], WALL_OUT + 4); }
    if (!s) continue;
    const p = at(t, i, s * off, 0);
    p.y = hy;
    tvSpots.push({ i, p }); keepClear.push({ x: p.x, z: p.z, r: 10 });
  }
  return { group, tvSpots, keepClear, dispose: () => { geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose()); } };
}
