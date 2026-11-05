// The training view's cars (B6, docs/plans/2026-11-04-tracks-training-matches.md §3). Every generation records its
// agents on training track 0 (the whole population of 64, as before: principal 2026-11-04 "keep it as many cars as we
// had before, but load them more lazily so that we don't have a lag spike"); the view plays the newest finished
// generation at 12×, all as glowing ghosts, one of them highlighted (its brain is drawn live in the panel). A new
// generation's ghosts are added in over several frames (REVEAL_PER_FRAME, the highlighted one first), and the one
// mesh is made once and reused. A newer generation
// takes over after a short minimum (about 2 s), so the screen keeps up with training; each generation's replay
// starts further into its episode than the one before (the offset grows with the generation's share of the run,
// never shrinks, and leaves a few seconds to watch). A generation is shown at most once, in order; if training falls
// behind, the last frame holds. When training ends, the champion's lap loops as the solid race car (never generation
// 1 again). A ghost touching a wall flashes red; one whose episode ended early stays where it stopped, fading. Each car's
// place on the track comes from its recorded progress, never a nearest-sample search, so at the figure eight's crossing
// it stays on its own road: up on the bridge (pitched on the ramps) or underneath, and drawn so on the map.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from '../../common/config';
import type { Track } from '../../common/sim/track';
import { PATH_EVERY, PATH_STRIDE, type Paths } from '../../common/train/episodes';
import type { CarModel } from './car';
import { assertCapacity, assertFiniteArray, setInstance } from './guard';
import { liftAt, pitchOf, sampleOf, toWorld, yawOf } from './trackMesh';

export const PLAY_SPEED = 12; // sim seconds per real second (principal 2026-11-04: "12x speed")
export const MIN_SHOW_S = 2; // real seconds a generation stays before a newer one takes over
export const LEAVE_S = 2.5; // real seconds of episode the offset always leaves to watch
export const FINALE_SPEED = 1.5;
/** Most ghosts any device shows: a whole generation. */
export const MAX_GHOSTS = CONFIG.train.population;
/** Ghosts added per frame when a generation takes over (64 come in over 4 frames). */
export const REVEAL_PER_FRAME = 16;
const TICK_HZ = CONFIG.tick.hz;
const EP = CONFIG.train.episodeTicks;
/** The latest an episode's replay can start (ticks), so LEAVE_S of it is always left. */
export const MAX_OFFSET = Math.max(0, EP - LEAVE_S * PLAY_SPEED * TICK_HZ);
const FADE_S = 0.9; // real seconds an ended ghost takes to fade to its floor
const FLOOR = 0.28; // an ended ghost stays faintly where it stopped (a held frame never empties the road)
const GHOST_SCALE = 1.15;

/** Start offset (ticks) of a generation at fraction f = (g − 1) / (N − 1) of the run. */
export const offsetFor = (f: number): number => Math.round(Math.max(0, Math.min(1, f)) * MAX_OFFSET);

/** The champion's lap, replayed for display (per tick). */
export interface Lap { x: Float64Array; y: Float64Array; hdg: Float64Array; v: Float64Array; prog: Float64Array; ticks: number; gen: number }
interface Shown { paths: Paths; gen: number; offset: number; end: number; hl: number; order: Int32Array; revealed: number }
/** One car on the map (deck 1: on the figure eight's bridge, drawn over it). */
export interface Dot { x: number; y: number; hl: boolean; alpha: number; deck: number }

export class Swarm {
  readonly mesh: THREE.InstancedMesh;
  private track: Track | null = null;
  private pending: Shown | null = null;
  private cur: Shown | null = null;
  private t = 0;
  private lap: Lap | null = null;
  private ended = false;
  private finaleOn = false;
  private lastOffset = 0;
  /** Every generation shown, in order, and its start offset (ticks): for the checks. */
  readonly log: { gen: number; offset: number; at: number }[] = [];
  private clock = 0;
  /** The highlighted car as drawn this frame, for its engine sound: speed (m/s) and lateral demand (0..1 of the grip). */
  carV = 0;
  carTurn = 0;
  /** Sim tick on screen now (of the generation's episode, or of the champion's lap). */
  tick = 0;
  private lastHdg: number | null = null;
  /** Set when the view jumps to another generation (the camera snaps instead of flying across the track). */
  jumped = false;
  /** Track sample the camera follows: the highlighted car (story) or the champion (finale). */
  focusIdx = 0;
  readonly dots: Dot[] = [];
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly lift = { h: 0, slope: 0 };
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();
  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.MeshBasicMaterial;

  constructor(private readonly car: CarModel, capacity = MAX_GHOSTS) {
    const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
    const merged = mergeGeometries([box(1.3, 0.55, 4.4).translate(0, 0.6, 0), box(2.8, 0.08, 0.5).translate(0, 0.3, 2.2), box(2.3, 0.08, 0.6).translate(0, 1.4, -2.0), box(0.5, 0.45, 1.2).translate(0, 1.05, -0.2)]);
    if (!merged) throw new Error('render: ghost geometry did not merge');
    this.geo = merged;
    // see-through but not additive: cars on one line stay their colour instead of stacking into a white bloom blob
    this.mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, capacity); // made once, reused for every generation
    this.mesh.name = 'ghosts';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    car.car.visible = false;
    car.car.rotation.order = 'YXZ';
  }

  get capacity(): number { return this.mesh.instanceMatrix.count; }
  /** Generation on screen (0 = none yet; the champion's generation in the finale). */
  get shownGen(): number { return this.finaleOn && this.lap ? this.lap.gen : this.cur?.gen ?? 0; }
  get finale(): boolean { return this.finaleOn; }
  /** Index (in its generation's recorded handful) of the highlighted car, or −1. */
  get highlight(): number { return this.cur?.hl ?? -1; }
  get current(): { paths: Paths; gen: number; offset: number } | null { return this.cur; }
  /** Ghosts on screen now (all of the generation once they have been added in). */
  get shownCount(): number { return this.finaleOn ? 0 : this.cur?.revealed ?? 0; }
  /** Ghosts the generation on screen recorded. */
  get recordedCount(): number { return this.finaleOn ? 0 : this.cur?.paths.count ?? 0; }

  setTrack(t: Track): void {
    this.track = t;
    this.pending = null; this.cur = null; this.lap = null; this.ended = false; this.finaleOn = false; this.lastOffset = 0;
    this.log.length = 0; this.clock = 0;
    this.mesh.count = 0; this.car.car.visible = false;
    this.focusIdx = t.startIdx;
  }

  /**
   * A newly finished generation, f = its share of the run. It waits as the next one to show (replacing an older one
   * that was waiting: only the newest matters); older or repeated generations are ignored.
   */
  offer(paths: Paths, gen: number, f: number): void {
    if (!paths.count) return;
    assertCapacity(this.mesh, paths.count);
    if (gen <= (this.pending?.gen ?? this.cur?.gen ?? 0) || this.finaleOn) return;
    const hl = highlightOf(paths);
    let end = 0;
    for (let i = 0; i < paths.count; i++) end = Math.max(end, paths.ticks[i]);
    // instance slots: the highlighted car first, then the rest in order
    const order = new Int32Array(paths.count);
    order[0] = hl;
    for (let i = 0, k = 1; i < paths.count; i++) if (i !== hl) order[k++] = i;
    this.pending = { paths, gen, offset: 0, end, hl, order, revealed: 0 };
    this.pendingF = f;
    if (!this.cur) this.take();
  }
  private pendingF = 0;

  /** Training has ended; the champion's lap plays once the last generation has had its minimum time. */
  finish(lap: Lap | null): void { this.ended = true; this.lap = lap; }

  /** Jump to t real seconds into what is on screen (deterministic: the result does not depend on earlier frames). */
  seek(t: number): void { this.t = t; if (this.cur) this.cur.revealed = this.cur.paths.count; }
  /** Real seconds into what is on screen (an audit puts it back after seeking, so the playback's timing is unchanged). */
  get at(): number { return this.t; }

  private take(): void {
    const n = this.pending;
    if (!n || !this.track) return;
    this.pending = null;
    // the offset grows with the run, never shrinks; a car whose episode ended before it is already faded
    n.offset = Math.max(this.lastOffset, offsetFor(this.pendingF));
    this.lastOffset = n.offset;
    this.cur = n; this.t = 0; this.jumped = true; this.lastHdg = null;
    this.log.push({ gen: n.gen, offset: n.offset, at: this.clock });
  }

  private startFinale(): void {
    if (!this.track || !this.lap) return;
    this.finaleOn = true; this.t = 0; this.jumped = true; this.lastHdg = null;
    this.log.push({ gen: this.lap.gen, offset: -1, at: this.clock });
  }

  update(dt: number, time: number): void {
    this.clock += dt;
    if (!this.track || (!this.cur && !this.finaleOn)) { this.mesh.count = 0; this.dots.length = 0; return; }
    this.t += dt;
    if (!this.finaleOn && this.t >= MIN_SHOW_S) {
      if (this.pending) this.take();
      else if (this.ended && this.lap) this.startFinale();
    }
    if (this.finaleOn && this.lap) {
      let tau = this.t * TICK_HZ * FINALE_SPEED;
      const period = this.lap.ticks + 2 * TICK_HZ; // a short pause on the line between laps
      if (tau >= period) { this.t = 0; tau = 0; }
      this.mesh.count = 0;
      this.tick = Math.min(Math.floor(tau), this.lap.ticks - 1);
      this.drawLap(tau, dt * FINALE_SPEED * TICK_HZ);
    } else {
      const cur = this.cur as Shown;
      // hold the last frame when training is slower than the replay
      const tau = Math.min(cur.offset + this.t * TICK_HZ * PLAY_SPEED, cur.end + FADE_S * PLAY_SPEED * TICK_HZ);
      this.tick = Math.min(Math.floor(tau), EP - 1);
      this.car.car.visible = false;
      this.drawGhosts(tau, time, dt);
    }
  }

  private drawGhosts(tau: number, time: number, dt: number): void {
    const cur = this.cur as Shown, t = this.track as Track;
    const { paths, hl, order } = cur, S = paths.samples, d = paths.data;
    cur.revealed = Math.min(paths.count, cur.revealed + REVEAL_PER_FRAME);
    this.mesh.count = cur.revealed;
    this.dots.length = 0;
    for (let k = 0; k < cur.revealed; k++) {
      const i = order[k], ticks = paths.ticks[i];
      const pose = samplePath(d, S, i, ticks, tau);
      const ended = tau >= ticks;
      const fade = ended ? Math.max(FLOOR, 1 - (tau - ticks) / (TICK_HZ * PLAY_SPEED) / FADE_S) : 1;
      const f = sampleOf(t, pose.prog), lift = liftAt(t, f, this.lift);
      toWorld(pose.x, pose.y, lift.h, this.p);
      this.q.setFromEuler(this.e.set(pitchOf(t, f, pose.hdg, lift.slope), yawOf(pose.hdg), 0));
      this.m4.compose(this.p, this.q, this.s.set(GHOST_SCALE, GHOST_SCALE, GHOST_SCALE));
      setInstance(this.mesh, k, this.m4);
      const early = ticks < EP;
      if (ended && early) this.c.setRGB(1.4, 0.2, 0.3).multiplyScalar(fade * (fade > FLOOR ? 0.55 + 0.45 * Math.abs(Math.sin(time * 9)) : 1));
      else if (pose.wall && !ended) this.c.setRGB(2.4, 0.25, 0.35).multiplyScalar(0.6 + 0.4 * Math.abs(Math.sin(time * 18)));
      else if (i === hl) this.c.setRGB(2.3, 1.7, 0.25).multiplyScalar(0.6 * fade); // the highlighted car: warm yellow
      else this.c.setRGB(0.45, 1.5, 2.2).multiplyScalar(0.55 * fade);
      this.mesh.setColorAt(k, this.c);
      this.dots.push({ x: pose.x, y: pose.y, hl: i === hl, alpha: fade, deck: t.deck[Math.round(f) % t.n] });
      if (i === hl) {
        this.focusIdx = Math.round(f) % t.n;
        this.sound(pose.hdg, ended ? 0 : pose.v, dt * PLAY_SPEED * TICK_HZ);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private drawLap(tau: number, dTicks: number): void {
    const t = this.track as Track, car = this.car, L = this.lap as Lap;
    const k = Math.min(tau, L.ticks - 1), j = Math.floor(k), j1 = Math.min(j + 1, L.ticks - 1), u = k - j;
    const x = L.x[j] + (L.x[j1] - L.x[j]) * u, y = L.y[j] + (L.y[j1] - L.y[j]) * u;
    let dh = L.hdg[j1] - L.hdg[j]; dh -= 2 * Math.PI * Math.round(dh / (2 * Math.PI));
    const hdg = L.hdg[j] + dh * u, v = tau >= L.ticks ? 0 : L.v[j];
    const f = sampleOf(t, L.prog[j] + (L.prog[j1] - L.prog[j]) * u), lift = liftAt(t, f, this.lift);
    this.focusIdx = Math.round(f) % t.n;
    this.dots.length = 0;
    this.dots.push({ x, y, hl: true, alpha: 1, deck: t.deck[this.focusIdx] });
    car.car.visible = true;
    toWorld(x, y, lift.h, car.car.position);
    car.car.rotation.set(pitchOf(t, f, hdg, lift.slope), yawOf(hdg), 0);
    car.car.updateMatrix();
    assertFiniteArray(car.car.matrix.elements, 'champion car');
    const dist = (v * dTicks) / TICK_HZ;
    for (const w of car.wheels) w.spin.rotation.x = (w.spin.rotation.x + dist / w.r) % (2 * Math.PI);
    this.sound(hdg, v, dTicks);
  }

  private sound(hdg: number, v: number, dTicks: number): void {
    if (this.lastHdg !== null && dTicks > 0) {
      let dh = hdg - this.lastHdg; dh -= 2 * Math.PI * Math.round(dh / (2 * Math.PI));
      this.carTurn = Math.abs(dh) > 0.5 ? 0 : Math.min(1, Math.abs((dh * TICK_HZ) / dTicks * v) / CONFIG.car.grip);
    }
    this.lastHdg = hdg;
    this.carV = v;
  }

  dispose(): void { this.geo.dispose(); this.mat.dispose(); this.mesh.dispose(); }
}

/** The highlighted car of a recorded handful: the one furthest along the track (chosen where it was recorded). */
export const highlightOf = (p: Paths): number => Math.max(0, Math.min(p.hl, p.count - 1));

/** Interpolated pose of policy i at sim tick tau (held at its last sample once its episode has ended). */
function samplePath(d: Float64Array, S: number, i: number, ticks: number, tau: number) {
  const last = Math.max(0, Math.ceil(ticks / PATH_EVERY) - 1);
  const f = Math.max(0, Math.min(tau, Math.max(ticks - 1, 0))) / PATH_EVERY;
  const j = Math.min(Math.floor(f), last), j1 = Math.min(j + 1, last), u = Math.min(f - j, 1);
  const a = (i * S + j) * PATH_STRIDE, b = (i * S + j1) * PATH_STRIDE;
  let dh = d[b + 2] - d[a + 2];
  dh -= 2 * Math.PI * Math.round(dh / (2 * Math.PI));
  return {
    x: d[a] + (d[b] - d[a]) * u, y: d[a + 1] + (d[b + 1] - d[a + 1]) * u, hdg: d[a + 2] + dh * u,
    v: d[a + 3] + (d[b + 3] - d[a + 3]) * u, wall: d[a + 4] > 0, prog: d[a + 5] + (d[b + 5] - d[a + 5]) * u,
  };
}
