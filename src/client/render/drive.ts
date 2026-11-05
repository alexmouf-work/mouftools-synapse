// The drive view's 3-D rig, from the look mock-up: the detailed car in the player's yellow with each wheel spinning
// at its own output (backwards when the output is negative), one ray per boundary vector cell, cast along the centre
// of its field (sensors.bearingDir) up to its 20 m range and brighter as a wall gets closer, and the chase, broadcast
// and showroom cameras. Poses come from a recorded drive; nothing here feeds the sim. On the figure eight's bridge the
// car rides up the ramps (pitched) and its rays, like the sim's, skip the walls of the road below (and the reverse).
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CONFIG } from '../../common/config';
import { bearingDir } from '../../common/sim/sensors';
import { castRay, hiddenLayer, type Track } from '../../common/sim/track';
import { makeCar, type CarModel } from './car';
import { assertFiniteArray } from './guard';
import { liftAt, pitchOf, toWorld, yawOf } from './trackMesh';

export type CamMode = 'chase' | 'tv' | 'orbit';
export interface DrivePose {
  x: number; y: number; hdg: number; v: number; idx: number;
  /** Fractional track sample (from the run's progress): where on the road, and so how high. */
  f: number;
  /** Wheel outputs FL, FR, RL, RR (−1..1). */
  wheels: ArrayLike<number>;
  /** Field centre of each boundary vector cell (degrees clockwise from the nose). */
  beams: ArrayLike<number>;
  /** Each beam's range (m): the cell's learned field (B2e). */
  ranges?: ArrayLike<number>;
  stuck: boolean;
}

/** A race's other cars as drawn (B7): pose from their recordings, wheels turning with their speed. */
export interface RivalPose { x: number; y: number; hdg: number; v: number; f: number; on: boolean; color: string }
/** The most other cars drawn in 3-D at once (vs CPU: all nine; in a room, the nearest; the rest are dots on the map). */
export const MAX_RIVALS = 11;

/** Other cars closer than this to the camera (m) are not drawn. */
const NEAR_CAM = 8;
const WHEEL_SPIN = 18; // rad/s at output ±1: readable on screen, direction and rate follow the output
const RANGE = CONFIG.senses.boundary.rangeM;
const MAX_BEAMS = CONFIG.senses.boundary.max;

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
  readonly rayDist = new Float64Array(MAX_BEAMS);
  private shown = 0;
  /** The race's other cars (a pool made on first use, at most MAX_RIVALS; each frame shows whichever car it is given). */
  readonly rivals: CarModel[] = [];
  private readonly glowTex: THREE.Texture;

  constructor(glowTex: THREE.Texture, private readonly camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.glowTex = glowTex;
    this.car = makeCar('#ffc21a', '#14161d', glowTex);
    this.car.car.rotation.order = 'YXZ';
    this.group.add(this.car.car);
    const col = new THREE.Color('#ffc21a').multiplyScalar(2.4);
    for (let e = 0; e < MAX_BEAMS; e++) {
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

  /** Put the camera exactly where it wants to be on the next update (no easing). */
  snapNow(): void { this.snap = true; this.tvIdx = -1; this.swing = 0; }

  /** World unit direction of each boundary cell's beam as drawn (for the beam-direction check). */
  beamDirs(): number[][] {
    const v = new THREE.Vector3();
    return this.beams.slice(0, this.shown).map((b) => b.beam.getWorldDirection(v).toArray());
  }

  /** How many other cars to draw (0: the drive view). The pool grows to it once and is reused. */
  setRivals(count: number): void {
    if (count > MAX_RIVALS) throw new Error(`render: ${count} rivals wanted, the rig draws ${MAX_RIVALS}`);
    while (this.rivals.length < count) {
      const m = makeCar('#9aa3b5', '#14161d', this.glowTex);
      m.car.rotation.order = 'YXZ';
      this.rivals.push(m);
      this.group.add(m.car);
      this.onRivals(m.car);
    }
    this.rivals.forEach((m, k) => { m.car.visible = k < count; });
    this.nRivals = count;
  }
  private nRivals = 0;
  /** The stage scales a new car's lit materials as it does every other (set by the stage). */
  onRivals: (root: THREE.Object3D) => void = () => {};
  get rivalsShown(): number { return this.rivals.slice(0, this.nRivals).filter((m) => m.car.visible).length; }

  /** Place the other cars for this frame (call before update; poses past the rivals set are an error). */
  placeRivals(poses: readonly RivalPose[], dt: number): void {
    const t = this.track;
    if (!t) return;
    if (poses.length > this.nRivals) throw new Error(`render: ${poses.length} rival poses for ${this.nRivals} cars`);
    poses.forEach((p, k) => {
      const m = this.rivals[k], car = m.car;
      car.visible = p.on;
      if (!p.on) return;
      m.setColor(p.color);
      const lift = liftAt(t, p.f);
      toWorld(p.x, p.y, lift.h, car.position);
      car.rotation.set(pitchOf(t, p.f, p.hdg, lift.slope), yawOf(p.hdg), 0);
      car.updateMatrixWorld();
      assertFiniteArray(car.matrixWorld.elements, `rival car ${k}`);
      // a car right under the chase camera (the one behind yours on the grid) would fill the screen: not drawn
      car.visible = car.position.distanceToSquared(this.camera.position) > NEAR_CAM * NEAR_CAM;
      for (const w of m.wheels) w.spin.rotation.x = (w.spin.rotation.x + (p.v * dt) / w.r) % (2 * Math.PI);
    });
  }
  /** World positions of the cars as drawn: yours, then the others shown (for the checks). */
  drawn(): number[][] {
    return [this.car.car, ...this.rivals.slice(0, this.nRivals).map((m) => m.car)].map((c) => [c.position.x, c.position.y, c.position.z, c.visible ? 1 : 0]);
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
    const lift = liftAt(t, p.f);
    toWorld(p.x, p.y, lift.h, car.position);
    car.rotation.set(pitchOf(t, p.f, p.hdg, lift.slope), yawOf(p.hdg), 0);
    car.updateMatrixWorld();
    assertFiniteArray(car.matrixWorld.elements, 'drive car');
    this.car.wheels.forEach((w, k) => { w.spin.rotation.x = (w.spin.rotation.x + p.wheels[k] * WHEEL_SPIN * dt) % (2 * Math.PI); });
    // one ray per boundary vector cell along its field's centre, at eye height
    const oy = lift.h + 0.75, skip = hiddenLayer(t, p.idx);
    this.shown = Math.min(p.beams.length, MAX_BEAMS);
    for (let e = 0; e < MAX_BEAMS; e++) {
      const b = this.beams[e], on = e < this.shown;
      b.beam.visible = on; b.hit.visible = on;
      if (!on) continue;
      // the field's direction, from the sim's rule (sensors.bearingDir), sim (x, y) → world (x, −y)
      const dir = bearingDir(p.hdg, p.beams[e]);
      const R = p.ranges?.[e] ?? RANGE;
      const d = castRay(t.grid, p.x, p.y, dir.dx, dir.dy, R, skip);
      this.rayDist[e] = d;
      const dx = dir.dx, dz = -dir.dy;
      b.beam.position.set(car.position.x, oy, car.position.z);
      this.v.set(car.position.x + dx * d, oy, car.position.z + dz * d);
      b.beam.lookAt(this.v); b.beam.scale.set(1, 1, Math.max(d, 0.01));
      b.hit.position.copy(this.v); b.hit.rotation.y = time * 3; b.hit.visible = d < R - 0.5;
      b.mat.opacity = 0.3 + (1 - d / R) * 0.7;
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
    for (const r of this.rivals) r.dispose();
    this.beamGeo.dispose(); this.hitGeo.dispose();
    for (const b of this.beams) b.mat.dispose();
  }
}
