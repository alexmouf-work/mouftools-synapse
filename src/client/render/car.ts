// The solid race car from the look mock-up (body, wings, canopy, four wheels that spin, tail lights, underglow).
// The training view uses it for each generation's best car and the champion's lap; the drive view (S4) adds per-wheel
// output spin and sensor rays. Faces +Z.
import * as THREE from 'three';

export interface CarModel { car: THREE.Group; wheels: { spin: THREE.Group; r: number }[]; dispose(): void }

function extrudeProfile(pts: [number, number][], width: number, bevel = 0.1): THREE.BufferGeometry {
  const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelThickness: bevel * 1.3, bevelSize: bevel, bevelSegments: 1, curveSegments: 1 });
  g.translate(0, 0, -width / 2); g.rotateY(-Math.PI / 2);
  return g;
}

export function makeCar(primary: string, trimHex: string, glowTex: THREE.Texture): CarModel {
  const geos: THREE.BufferGeometry[] = [], mats: THREE.Material[] = [];
  const G = <T extends THREE.BufferGeometry>(g: T) => { geos.push(g); return g; };
  const M = <T extends THREE.Material>(m: T) => { mats.push(m); return m; };
  const box = (w: number, h: number, d: number) => G(new THREE.BoxGeometry(w, h, d));
  const tubGeo = G(extrudeProfile([[-2.05, 0.32], [1.6, 0.3], [2.45, 0.36], [2.52, 0.46], [1.5, 0.66], [0.55, 0.8], [-0.6, 0.86], [-1.7, 0.9], [-2.12, 0.8], [-2.18, 0.5]], 1.0, 0.12));
  const podGeo = G(extrudeProfile([[-0.85, 0.3], [0.75, 0.3], [0.8, 0.5], [0.5, 0.66], [-0.7, 0.72], [-0.9, 0.55]], 0.42, 0.08));
  const canopyGeo = G(extrudeProfile([[-0.75, 0.82], [0.6, 0.78], [0.1, 1.12], [-0.6, 1.16]], 0.62, 0.07));
  const airboxGeo = G(extrudeProfile([[-1.55, 0.86], [-0.62, 0.86], [-0.74, 1.32], [-1.3, 1.38]], 0.42, 0.07));
  const tyreGeo = G(new THREE.CylinderGeometry(0.52, 0.52, 0.56, 14).rotateZ(Math.PI / 2));
  const tyreGeoR = G(new THREE.CylinderGeometry(0.56, 0.56, 0.62, 14).rotateZ(Math.PI / 2));
  const rimGeo = G(new THREE.CylinderGeometry(0.31, 0.31, 0.6, 7).rotateZ(Math.PI / 2));
  const rimGeoR = G(new THREE.CylinderGeometry(0.33, 0.33, 0.66, 7).rotateZ(Math.PI / 2));
  const tyreMat = M(new THREE.MeshStandardMaterial({ color: '#15171d', roughness: 0.85, flatShading: true }));
  const carbonMat = M(new THREE.MeshStandardMaterial({ color: '#171a22', roughness: 0.45, metalness: 0.35, flatShading: true }));
  const glassMat = M(new THREE.MeshPhysicalMaterial({ color: '#0a1124', roughness: 0.05, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.03, flatShading: true }));
  const paint = M(new THREE.MeshPhysicalMaterial({ color: primary, metalness: 0.2, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.08, flatShading: true, envMapIntensity: 0.7 }));
  const trim = M(new THREE.MeshPhysicalMaterial({ color: trimHex, metalness: 0.35, roughness: 0.3, clearcoat: 0.6, flatShading: true }));
  const tail = M(new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.15, 0.3) }));
  const led = M(new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.7, 3.0) }));
  const exhaust = M(new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.2, 0.2) }));

  const car = new THREE.Group();
  const body = new THREE.Group(); car.add(body);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = body) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
  };
  add(tubGeo, paint);
  add(podGeo, paint, 0.84); add(podGeo, paint, -0.84);
  add(box(0.36, 0.22, 0.06), carbonMat, 0.84, 0.47, 0.8); add(box(0.36, 0.22, 0.06), carbonMat, -0.84, 0.47, 0.8);
  add(canopyGeo, glassMat);
  add(airboxGeo, trim);
  add(box(0.3, 0.18, 0.05), carbonMat, 0, 1.25, -0.66);
  add(box(2.9, 0.07, 0.55), trim, 0, 0.27, 2.32);
  add(box(2.5, 0.05, 0.28), carbonMat, 0, 0.38, 2.12);
  add(box(0.07, 0.34, 0.66), paint, 1.45, 0.4, 2.3); add(box(0.07, 0.34, 0.66), paint, -1.45, 0.4, 2.3);
  add(box(2.36, 0.08, 0.66), trim, 0, 1.5, -2.12);
  add(box(2.36, 0.06, 0.3), paint, 0, 1.66, -2.36);
  add(box(0.08, 0.78, 1.0), carbonMat, 1.2, 1.38, -2.2); add(box(0.08, 0.78, 1.0), carbonMat, -1.2, 1.38, -2.2);
  add(box(0.07, 0.62, 0.24), carbonMat, 0.28, 1.12, -2.0); add(box(0.07, 0.62, 0.24), carbonMat, -0.28, 1.12, -2.0);
  const lights = [add(box(0.9, 0.08, 0.05), tail, 0, 0.74, -2.3), add(box(0.22, 0.16, 0.05), tail, 0, 1.3, -2.48)];
  lights.push(add(box(0.4, 0.05, 0.05), led, 0.32, 0.47, 2.36), add(box(0.4, 0.05, 0.05), led, -0.32, 0.47, 2.36));
  lights[2].rotation.y = -0.35; lights[3].rotation.y = 0.35;
  lights.push(add(G(new THREE.CylinderGeometry(0.1, 0.12, 0.2, 8).rotateX(Math.PI / 2)), exhaust, 0, 0.55, -2.3));
  for (const l of lights) l.userData.glow = true;
  const wheels: CarModel['wheels'] = [];
  for (const [x, z, rear] of [[1.25, 1.5, 0], [-1.25, 1.5, 0], [1.28, -1.5, 1], [-1.28, -1.5, 1]]) {
    const r = rear ? 0.56 : 0.52;
    const spin = new THREE.Group(); spin.position.set(x, r, z); car.add(spin);
    add(rear ? tyreGeoR : tyreGeo, tyreMat, 0, 0, 0, spin);
    add(rear ? rimGeoR : rimGeo, trim, 0, 0, 0, spin);
    for (const y of [r - 0.08, r + 0.12]) { const arm = add(box(Math.abs(x) - 0.6, 0.05, 0.09), carbonMat, Math.sign(x) * (0.6 + (Math.abs(x) - 0.6) / 2) * 0.98, y, z); arm.castShadow = false; }
    wheels.push({ spin, r });
  }
  const glowMat = M(new THREE.MeshBasicMaterial({ map: glowTex, color: new THREE.Color(primary).multiplyScalar(1.3), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  const glow = new THREE.Mesh(G(new THREE.PlaneGeometry(3.6, 6.2).rotateX(-Math.PI / 2)), glowMat);
  glow.position.y = 0.06; glow.userData.glow = true; car.add(glow);
  return { car, wheels, dispose: () => { geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose()); } };
}
