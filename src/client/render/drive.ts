// The drive view's 3-D rig, from the look mock-up: the detailed car in the player's yellow with each wheel spinning
// at its own output (backwards when the output is negative), the six eye rays cast from the car's real sensor
// directions (brighter as a wall gets closer; unwired eyes faint; flickering when over budget), and the chase,
// broadcast and showroom cameras. Poses come from a recorded drive; nothing here feeds the sim.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CONFIG } from '../../common/config';
import { EYE_COUNT } from '../../common/sim/spec';
import { eyeDistance } from '../../common/sim/sensors';
import type { CarState } from '../../common/sim/car';
import type { Track } from '../../common/sim/track';
import { makeCar, type CarModel } from './car';
import { assertFiniteArray } from './guard';
import { toWorld, yawOf } from './trackMesh';

export type CamMode = 'chase' | 'tv' | 'orbit';
export interface DrivePose {
  x: number; y: number; hdg: number; v: number; idx: number;
  /** Wheel outputs FL, FR, RL, RR (−1..1). */
  wheels: ArrayLike<number>;
  /** Which eyes are wired (6). */
  eyesUsed: ArrayLike<number>;
  /** Over-budget noise level 0..1. */
  noise: number;
  stuck: boolean;
}

const WHEEL_SPIN = 18; // rad/s at output ±1: readable on screen, direction and rate follow the output
const RANGE = CONFIG.sensors.eyeRange;

export class DriveRig {
  readonly car: CarModel;
  readonly group = new THREE.Group();
  mode: CamMode = 'chase';
  private readonly beams: { beam: THREE.Mesh; hit: THREE.Mesh; mat: THREE.MeshBasicMaterial }[] = [];
  private readonly beamGeo = new THREE.BoxGeometry(0.07, 0.07, 1).translate(0, 0, 0.5);
  private readonly hitGeo = new THREE.OctahedronGeometry(0.3, 0);
  private readonly controls: OrbitControls;
  private readonly look = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();
  private snap = true;
  private swing = 0;
  private tvIdx = -1;
  private tvSpots: { i: number; p: THREE.Vector3 }[] = [];
  private track: Track | null = null;
  private readonly probe = { x: 0, y: 0, hdg: 0 } as CarState;
  readonly rayDist = new Float64Array(EYE_COUNT);

  constructor(glowTex: THREE.Texture, private readonly camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.car = makeCar('#ffc21a', '#14161d', glowTex);
    this.group.add(this.car.car);
    const col = new THREE.Color('#ffc21a').multiplyScalar(2.4);
    for (let e = 0; e < EYE_COUNT; e++) {
      const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
      const beam = new THREE.Mesh(this.beamGeo, mat), hit = new THREE.Mesh(this.hitGeo, mat);
      beam.userData.glow = true; hit.userData.glow = true;
      this.group.add(beam, hit);
      this.beams.push({ beam, hit, mat });
    }
    this.controls = new OrbitControls(camera, dom);
    this.controls.enabled = false; this.controls.enableDamping = true; this.controls.autoRotateSpeed = 1.4;
    this.controls.minDistance = 6; this.controls.maxDistance = 60; this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.addEventListener('start', () => { this.controls.autoRotate = false; });
  }

  setTrack(t: Track, tvSpots: { i: number; p: THREE.Vector3 }[]): void { this.track = t; this.tvSpots = tvSpots; this.snap = true; this.tvIdx = -1; }

  setMode(m: CamMode, reduceMotion: boolean): void {
    this.mode = m;
    this.controls.enabled = m === 'orbit';
    if (m === 'orbit') {
      this.controls.target.copy(this.car.car.position);
      this.camera.position.copy(this.car.car.position).add(new THREE.Vector3(7, 3.2, 9));
      this.controls.autoRotate = !reduceMotion;
    }
    this.snap = true; this.tvIdx = -1;
  }

  update(p: DrivePose, dt: number, time: number, reduceMotion: boolean): void {
    const t = this.track;
    if (!t) return;
    const car = this.car.car;
    toWorld(p.x, p.y, 0, car.position);
    car.rotation.set(0, yawOf(p.hdg), 0);
    car.updateMatrixWorld();
    assertFiniteArray(car.matrixWorld.elements, 'drive car');
    this.car.wheels.forEach((w, k) => { w.spin.rotation.x = (w.spin.rotation.x + p.wheels[k] * WHEEL_SPIN * dt) % (2 * Math.PI); });
    // eye rays from the car's sensor directions, at eye height
    this.probe.x = p.x; this.probe.y = p.y; this.probe.hdg = p.hdg;
    const oy = 0.75;
    for (let e = 0; e < EYE_COUNT; e++) {
      const d = eyeDistance(this.probe, t, e);
      this.rayDist[e] = d;
      const b = this.beams[e];
      const deg = [-90, -45, 0, 45, 90, 180][e];
      const jitter = p.noise > 0 ? (Math.random() - 0.5) * 0.7 * p.noise : 0; // display only
      const a = yawOf(p.hdg) - deg * Math.PI / 180 + jitter;
      const dx = Math.sin(a), dz = Math.cos(a);
      b.beam.position.set(car.position.x, oy, car.position.z);
      this.v.set(car.position.x + dx * d, oy, car.position.z + dz * d);
      b.beam.lookAt(this.v); b.beam.scale.set(1, 1, Math.max(d, 0.01));
      b.hit.position.copy(this.v); b.hit.rotation.y = time * 3; b.hit.visible = d < RANGE - 0.5;
      const near = 1 - d / RANGE;
      const flick = p.noise > 0 ? 1 - p.noise * Math.random() : 1;
      b.mat.opacity = (p.eyesUsed[e] ? 0.3 + near * 0.7 : 0.1) * flick;
    }
    this.camera.near = 0.3;
    this.updateCamera(p, dt, reduceMotion);
  }

  private updateCamera(p: DrivePose, dt: number, reduceMotion: boolean): void {
    const car = this.car.car, cam = this.camera;
    this.fwd.set(0, 0, 1).applyQuaternion(car.quaternion);
    const k = this.snap ? 1 : 1 - Math.exp(-dt * 5);
    if (this.mode === 'chase') {
      // stuck: swing slowly round the car so the pinned car (wheels still turning) never looks like a frozen frame
      this.swing = p.stuck && !reduceMotion ? this.swing + dt * 0.35 : this.swing * Math.exp(-dt * 2);
      const back = this.v.copy(this.fwd).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.swing).multiplyScalar(-10.5);
      this.pos.copy(car.position).add(back); this.pos.y = car.position.y + 3.9;
      cam.position.lerp(this.pos, k);
      this.look.lerp(this.v.copy(car.position).addScaledVector(this.fwd, p.stuck ? 0 : 6).setY(car.position.y + 1.2), this.snap ? 1 : 1 - Math.exp(-dt * 8));
      cam.lookAt(this.look);
      const fov = 60 + Math.abs(p.v) * 0.1;
      if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * k; cam.updateProjectionMatrix(); }
    } else if (this.mode === 'tv' && this.tvSpots.length) {
      const n = this.track ? this.track.n : 1;
      let best = 0, bv = Infinity;
      this.tvSpots.forEach((sp, j) => { let rel = ((p.idx - sp.i) % n + n) % n; if (rel > n / 2) rel -= n; const score = Math.abs(rel + 12); if (score < bv) { bv = score; best = j; } });
      if (best !== this.tvIdx) { this.tvIdx = best; this.snap = true; cam.position.copy(this.tvSpots[best].p); }
      this.look.lerp(this.v.copy(car.position).setY(car.position.y + 0.8), this.snap ? 1 : 1 - Math.exp(-dt * 7));
      cam.lookAt(this.look);
      const dist = cam.position.distanceTo(car.position);
      cam.fov = Math.min(55, Math.max(9, 2 * Math.atan(8 / dist) * 180 / Math.PI)); cam.updateProjectionMatrix();
    } else {
      this.v.copy(car.position).sub(this.controls.target);
      cam.position.add(this.v); this.controls.target.copy(car.position);
      this.controls.update();
      if (cam.fov !== 50) { cam.fov = 50; cam.updateProjectionMatrix(); }
    }
    this.snap = false;
    assertFiniteArray(cam.matrixWorld.elements, 'drive camera');
  }

  dispose(): void {
    this.controls.dispose();
    this.car.dispose();
    this.beamGeo.dispose(); this.hitGeo.dispose();
    for (const b of this.beams) b.mat.dispose();
  }
}
