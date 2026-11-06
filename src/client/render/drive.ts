// The drive view's 3-D rig, from the look mock-up: the detailed car in the player's yellow with each wheel spinning
// at its own output (backwards when the output is negative), one ray per boundary vector cell, cast along the centre
// of its field (sensors.bearingDir) up to its 20 m range and brighter as a wall gets closer, and the chase, broadcast
// and showroom cameras, and a race's director (match polish §3: broadcast shots cut with an onboard POV camera on the
// back of the car). Poses come from a recorded drive; nothing here feeds the sim. On the figure eight's bridge the
// car rides up the ramps (pitched) and its rays, like the sim's, skip the walls of the road below (and the reverse).
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CONFIG } from '../../common/config';
import { bearingDir } from '../../common/sim/sensors';
import { castRay, hiddenLayer, type Track } from '../../common/sim/track';
import { makeCar, type CarModel } from './car';
import { assertFiniteArray } from './guard';
import { covers, type TvSpot } from './sight';
import { liftAt, pitchOf, toWorld, yawOf } from './trackMesh';

/** chase, broadcast (tv), orbit; 'race' is a race's director: broadcast shots and the onboard POV, cut by themselves. */
export type CamMode = 'chase' | 'tv' | 'orbit' | 'race';
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
/** The broadcast camera: a shot holds at least this long (s), and frames about this much car and road (m, half). */
const TV_HOLD = 3, TV_FRAME = 11;
/**
 * The race director (match polish §3): broadcast for 5–8 s, then the POV for 4–6 s, and so on; no cut in the first
 * 2 s after Go (the director starts at Go) and none sooner than 3 s after the last (except when the car leaves a
 * broadcast shot's frame or stretch, as before). Where no spot covers the car, the POV.
 */
const DIR = { tv: [5, 8], pov: [4, 6], quiet: 2, gap: TV_HOLD } as const;
/** The POV mount in the car's frame (+z forward): on top of the back of the car, just over the rear wing (top 1.69 m). */
const POV_AT = new THREE.Vector3(0, 2.02, -2.15), POV_LOOK = new THREE.Vector3(0, 1.35, 14);

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
  /** The broadcast shot's age (s): a new spot only after TV_HOLD, unless the car has left the frame. */
  private tvHeld = 0;
  /** The camera's own clock (s of frames drawn), and every cut with why (checks). */
  private clock = 0;
  readonly cuts: { t: number; why: 'snap' | 'spot' | 'out' | 'pov' | 'tv'; spot: number }[] = [];
  /** The race director: the shot now, how long it has run and is to run (s), the director's clock and last cut (s). */
  private shot: 'tv' | 'pov' = 'tv';
  private shotAge = 0;
  private shotLen = 0;
  private dirClock = 0;
  /** The director runs on real seconds (performance.now), not on frame times: a slow frame must not stretch a shot. */
  private dirLast = -1;
  private dirDt = 0;
  private lastCut = -Infinity;
  private dirSeed = 1;
  /** A chase camera's glide to another car: time left and its length (s). */
  private glideLeft = 0;
  private glideLen = 0;
  private tvSpots: TvSpot[] = [];
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

  /**
   * The camera turns to follow another car (follow-a-racer plan): the chase camera eases there over `sec` (smooth, no
   * snap); the broadcast camera cuts to the best spot for it at once.
   */
  glide(sec: number): void {
    if (this.mode === 'tv' || this.mode === 'race') { this.tvIdx = -1; return; } // the POV rides the new car at once
    this.glideLeft = this.glideLen = sec;
  }
  /** The car the camera follows takes that car's colour (yours is yellow). */
  setCarColor(c: string): void { this.car.setColor(c); }
  /** How far the camera's aim is from the followed car (m), for the checks (the POV rides on it: 0). */
  lookOff(): number { return this.mode === 'race' && this.shot === 'pov' ? 0 : this.look.distanceTo(this.v.copy(this.car.car.position)); }
  /** The race director's shot now ('tv' or 'pov'; the other modes: their own name). */
  get shotNow(): string { return this.mode === 'race' ? this.shot : this.mode; }

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
      // (on the POV, only a car right on the camera: one just ahead stays in view)
      const near = this.mode === 'race' && this.shot === 'pov' ? 2.5 : NEAR_CAM;
      car.visible = car.position.distanceToSquared(this.camera.position) > near * near;
      for (const w of m.wheels) w.spin.rotation.x = (w.spin.rotation.x + (p.v * dt) / w.r) % (2 * Math.PI);
    });
  }
  /** World positions of the cars as drawn: yours, then the others shown (for the checks). */
  drawn(): number[][] {
    return [this.car.car, ...this.rivals.slice(0, this.nRivals).map((m) => m.car)].map((c) => [c.position.x, c.position.y, c.position.z, c.visible ? 1 : 0]);
  }

  /** Where a point `up` m over your car is on screen, as fractions of the canvas (0..1, top-left), or null if off it. */
  screenOf(up: number): { x: number; y: number } | null {
    const q = this.v.copy(this.car.car.position);
    q.y += up;
    q.project(this.camera);
    if (!(Number.isFinite(q.x) && Number.isFinite(q.y)) || q.z > 1 || q.x < -1 || q.x > 1 || q.y < -1 || q.y > 1) return null;
    return { x: (q.x + 1) / 2, y: (1 - q.y) / 2 };
  }

  setTrack(t: Track, tvSpots: TvSpot[]): void { this.track = t; this.tvSpots = tvSpots; this.snap = true; this.tvIdx = -1; this.dirSeed = (t.seed >>> 0) || 1; }

  setMode(m: CamMode, reduceMotion: boolean): void {
    this.mode = m;
    this.controls.enabled = m === 'orbit';
    if (m === 'orbit') {
      this.controls.target.copy(this.car.car.position);
      this.camera.position.copy(this.car.car.position).add(new THREE.Vector3(7, 3.2, 9));
      this.controls.autoRotate = !reduceMotion;
    }
    this.snap = true; this.tvIdx = -1; this.glideLeft = 0; this.cuts.length = 0;
    // the director starts on a broadcast shot (or the POV where no spot covers the car); its shot lengths follow the
    // track's seed, so a race's cuts come out the same each time it is shown
    this.shot = 'tv'; this.shotAge = 0; this.dirClock = 0; this.dirLast = -1; this.lastCut = -Infinity; this.shotLen = this.lenOf('tv');
  }
  /** A shot's length (s), drawn from the director's own sequence (display only). */
  private lenOf(k: 'tv' | 'pov'): number {
    let x = (this.dirSeed = (Math.imul(this.dirSeed, 1103515245) + 12345) >>> 0);
    x ^= x >>> 16;
    const [a, b] = DIR[k];
    return a + ((x >>> 0) / 4294967296) * (b - a);
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
    this.clock += dt;
    let k = this.snap ? 1 : 1 - Math.exp(-dt * 5);
    const gliding = this.glideLeft > 0 && !this.snap;
    if (gliding) {
      // an eased glide to the new car, done in glideLen s: the share of what is left to go, this frame
      const ease = (u: number) => u * u * (3 - 2 * u), u0 = 1 - this.glideLeft / this.glideLen;
      this.glideLeft = Math.max(0, this.glideLeft - dt);
      const u1 = 1 - this.glideLeft / this.glideLen;
      k = u0 >= 1 ? 1 : (ease(u1) - ease(u0)) / (1 - ease(u0));
    }
    if (this.mode === 'chase') {
      // stuck: swing slowly round the car so the pinned car (wheels still turning) never looks like a frozen frame
      this.swing = p.stuck && !reduceMotion ? this.swing + dt * 0.35 : this.swing * Math.exp(-dt * 2);
      const back = this.v.copy(this.fwd).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.swing).multiplyScalar(-10.5);
      this.pos.copy(car.position).add(back); this.pos.y = car.position.y + 3.9;
      cam.position.lerp(this.pos, k);
      this.look.lerp(this.v.copy(car.position).addScaledVector(this.fwd, p.stuck ? 0 : 6).setY(car.position.y + 1.2), this.snap ? 1 : gliding ? k : 1 - Math.exp(-dt * 8));
      cam.lookAt(this.look);
      const fov = 60 + Math.abs(p.v) * 0.1;
      if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * k; cam.updateProjectionMatrix(); }
    } else if (this.mode === 'race') {
      this.direct(p, dt, reduceMotion);
    } else if (this.mode === 'tv' && this.tvSpots.length) {
      this.broadcast(p, dt, false);
    } else {
      this.v.copy(car.position).sub(this.controls.target);
      cam.position.add(this.v); this.controls.target.copy(car.position);
      this.controls.update();
      if (cam.fov !== 50) { cam.fov = 50; cam.updateProjectionMatrix(); }
    }
    this.snap = false;
    assertFiniteArray(cam.matrixWorld.elements, 'drive camera');
  }

  private cut(why: DriveRig['cuts'][number]['why'], spot = -1): void {
    this.cuts.push({ t: this.mode === 'race' ? this.dirClock : this.clock, why, spot });
    if (this.cuts.length > 200) this.cuts.shift();
    this.lastCut = this.dirClock;
  }

  /** The best broadcast spot for sample idx: among those covering it (all of them if `any` and none does), or −1. */
  private spotFor(idx: number, any: boolean): number {
    const n = this.track ? this.track.n : 1;
    let best = -1, bv = Infinity;
    for (let pass = 0; pass < 2 && best < 0; pass++) {
      if (pass === 1 && !any) break;
      this.tvSpots.forEach((sp, j) => {
        if (pass === 0 && !covers(sp, idx, n)) return;
        let rel = ((idx - sp.i) % n + n) % n; if (rel > n / 2) rel -= n;
        const score = Math.abs(rel + 12);
        if (score < bv) { bv = score; best = j; }
      });
    }
    return best;
  }

  /**
   * A broadcast shot: the spot covering the car best (the drive view's tv mode: any spot if none covers it); a shot
   * holds at least TV_HOLD s (follow-a-racer plan) unless the car has left its frame or its stretch. Returns false if
   * no spot can show the car (the director then cuts to the POV).
   */
  private broadcast(p: DrivePose, dt: number, strict: boolean): boolean {
    const car = this.car.car, cam = this.camera, n = this.track ? this.track.n : 1;
    const best = this.spotFor(p.idx, !strict);
    if (best < 0) return false;
    this.tvHeld += this.mode === 'race' ? this.dirDt : dt;
    const out = this.tvIdx >= 0 && (!this.inFrame(car.position) || !covers(this.tvSpots[this.tvIdx], p.idx, n));
    if (best !== this.tvIdx && (this.tvIdx < 0 || this.tvHeld >= TV_HOLD || out)) {
      // a race director's cut back from the POV is 'tv'; a first shot, or one after a snap or a new car, 'snap'
      this.cut(this.tvIdx < 0 ? (this.mode === 'race' && this.shotAge === 0 && this.cuts.length > 0 ? 'tv' : 'snap') : out && this.tvHeld < TV_HOLD ? 'out' : 'spot', best);
      this.tvIdx = best; this.tvHeld = 0; this.snap = true; cam.position.copy(this.tvSpots[best].p);
    }
    this.look.lerp(this.v.copy(car.position).setY(car.position.y + 0.8), this.snap ? 1 : 1 - Math.exp(-dt * 7));
    cam.lookAt(this.look);
    const dist = cam.position.distanceTo(car.position);
    cam.fov = Math.min(55, Math.max(9, 2 * Math.atan(TV_FRAME / Math.max(dist, 1)) * 180 / Math.PI)); cam.updateProjectionMatrix();
    return true;
  }

  /** The onboard POV: rigidly on the back of the followed car, looking forward over it, with a slight vibration. */
  private pov(p: DrivePose, reduceMotion: boolean): void {
    const car = this.car.car, cam = this.camera;
    const speed = Math.min(1, Math.abs(p.v) / CONFIG.car.wheelSpeed), shake = reduceMotion ? 0 : 0.004 + 0.012 * speed, ph = this.clock * 47;
    this.pos.copy(POV_AT);
    this.pos.y += shake * Math.sin(ph); this.pos.x += shake * 0.5 * Math.sin(ph * 1.37 + 1.1);
    car.localToWorld(this.pos);
    this.look.copy(POV_LOOK); this.look.y += shake * 2 * Math.sin(ph * 0.83 + 0.4);
    car.localToWorld(this.look);
    cam.position.copy(this.pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.look);
    const fov = 68 + speed * 6;
    cam.fov = fov; cam.near = 0.1; cam.updateProjectionMatrix();
  }

  /** The race director: broadcast and POV shots in turn (DIR), cut by themselves; the followed car in both. */
  private direct(p: DrivePose, dt: number, reduceMotion: boolean): void {
    const now = performance.now() / 1000;
    this.dirDt = this.dirLast < 0 ? 0 : Math.max(0, Math.min(5, now - this.dirLast));
    this.dirLast = now;
    this.dirClock += this.dirDt; this.shotAge += this.dirDt;
    const sinceCut = this.dirClock - this.lastCut, may = this.dirClock >= DIR.quiet && sinceCut >= DIR.gap;
    if (this.shot === 'tv') {
      const due = this.shotAge >= this.shotLen && may;
      // the shot's time is up, or no spot covers the car (the first shot: at Go, at once): the POV
      if (due || this.spotFor(p.idx, false) < 0) {
        this.cut('pov');
        this.shot = 'pov'; this.shotAge = 0; this.shotLen = this.lenOf('pov'); this.tvIdx = -1;
      } else if (!this.broadcast(p, dt, true)) {
        this.cut('pov'); this.shot = 'pov'; this.shotAge = 0; this.shotLen = this.lenOf('pov'); this.tvIdx = -1;
      }
    } else if (this.shotAge >= this.shotLen && may && this.spotFor(p.idx, false) >= 0) {
      this.shot = 'tv'; this.shotAge = 0; this.shotLen = this.lenOf('tv'); this.tvIdx = -1; this.tvHeld = 0;
      this.broadcast(p, dt, true); // cuts ('tv') to the best spot
    }
    if (this.shot === 'pov') this.pov(p, reduceMotion);
  }

  /** A point in the camera's view (inside the frame and in front). */
  private inFrame(q: THREE.Vector3): boolean {
    const v = this.v.copy(q).project(this.camera);
    return Number.isFinite(v.x) && Number.isFinite(v.y) && v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
  }

  dispose(): void {
    this.controls.dispose();
    this.car.dispose();
    for (const r of this.rivals) r.dispose();
    this.beamGeo.dispose(); this.hitGeo.dispose();
    for (const b of this.beams) b.mat.dispose();
  }
}
