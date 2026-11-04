// The finish line's flags (principal 2026-11-04: "give the flag a checker pattern too with a black stem. put the flag on
// either side of the finish line."): a chequered flag on a black pole each side of the start/finish line, in the
// run-off between the kerb and the wall, the cloth reaching away from the road so it never hangs over it. Matte
// materials (the bloom audit: scenery must not glow). The chequered band on the road itself is trackMesh's 'start'.
import * as THREE from 'three';
import type { Track } from '../../common/sim/track';
import { assertFiniteGeometry } from './guard';
import { at, KERB, WALL_IN } from './trackMesh';

const POLE_H = 3.6, POLE_R = 0.09, FLAG_W = 1.7, FLAG_H = 1.1;
/** Distance of each pole from the centreline (m): mid run-off. */
export const FLAG_OFF = (KERB + WALL_IN) / 2;

export interface Finish { group: THREE.Group; flags: number; dispose(): void }

export function buildFinish(t: Track, checker: THREE.Texture): Finish {
  const group = new THREE.Group();
  group.name = 'finish';
  const poleGeo = assertFiniteGeometry(new THREE.CylinderGeometry(POLE_R, POLE_R * 1.15, POLE_H, 10).translate(0, POLE_H / 2, 0), 'flag pole');
  const flagGeo = assertFiniteGeometry(new THREE.PlaneGeometry(FLAG_W, FLAG_H, 8, 1), 'flag');
  // a gentle fixed ripple, so the cloth reads as cloth
  const pos = flagGeo.attributes.position as THREE.BufferAttribute;
  for (let k = 0; k < pos.count; k++) { const x = pos.getX(k); pos.setZ(k, 0.08 * Math.sin(((x + FLAG_W / 2) / FLAG_W) * Math.PI * 2)); }
  flagGeo.computeVertexNormals();
  const poleMat = new THREE.MeshStandardMaterial({ color: '#0b0d12', roughness: 0.85, metalness: 0 });
  const tex = checker.clone();
  tex.needsUpdate = true;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6 / 16, 4 / 2); // the start checker is 16 × 2 squares: 6 × 4 of them on the cloth
  const flagMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0, side: THREE.DoubleSide, color: '#d9dde6' });
  const i = t.startIdx, a = at(t, i, 0, 0), b = at(t, i + 1, 0, 0);
  const along = Math.atan2(b.x - a.x, b.z - a.z); // yaw of the track direction
  let flags = 0;
  for (const side of [1, -1]) {
    const base = at(t, i, side * FLAG_OFF, 0);
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.copy(base);
    pole.castShadow = true;
    group.add(pole);
    const flag = new THREE.Mesh(flagGeo, flagMat);
    // the cloth faces along the track (seen by cars coming up to the line) and reaches outward from the pole
    const outward = at(t, i, side * (FLAG_OFF + 1), 0).sub(base).normalize();
    flag.position.copy(base).addScaledVector(outward, FLAG_W / 2 + POLE_R).setY(POLE_H - FLAG_H / 2 - 0.05);
    flag.rotation.set(0, along, 0);
    flag.castShadow = true;
    group.add(flag);
    flags++;
  }
  return { group, flags, dispose: () => { poleGeo.dispose(); flagGeo.dispose(); poleMat.dispose(); flagMat.dispose(); tex.dispose(); } };
}
