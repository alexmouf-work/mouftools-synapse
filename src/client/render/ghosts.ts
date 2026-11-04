// The training swarm, told as a story: chosen generations (gen 1 first, then later ones) each play for a couple of
// seconds at ~3×, in order, on training track 0. Every car of the generation is a glowing ghost in the look mock-up's
// style; the generation's best car is the solid race car. A ghost touching a wall flashes red; one whose episode
// ended early (stalled, pinned, reversing) stays where it stopped and fades out flashing red, so a stuck car reads as
// stuck, never as a frozen frame; one that drove the whole episode fades out in its own colour. When the story has
// played the final generation, the finale loops the champion's lap with that generation faint behind it.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from '../../common/config';
import { locate, type Track } from '../../common/sim/track';
import { PATH_EVERY, PATH_STRIDE, type Paths } from '../../common/train/episodes';
import type { CarModel } from './car';
import { assertCapacity, assertFiniteArray, setInstance } from './guard';
import { toWorld, yawOf } from './trackMesh';

export const STORY_SPEED = 3; // sim seconds per real second while a generation is on screen
export const STORY_SLOT_S = 2.6; // real seconds each generation is shown (≈ the first 8 s of its episodes)
export const FINALE_SPEED = 1.5;
const TICK_HZ = CONFIG.tick.hz;
const FADE_S = 0.9; // real seconds an ended ghost takes to fade
const GHOST_SCALE = 1.15;
const FAINT = 0.35;
const FINALE_TRAIL_TICKS = 8; // the final generation trails the champion by 0.4 s (in view, between camera and car)

/** The champion's lap, replayed for display (per tick). */
export interface Lap { x: Float64Array; y: Float64Array; hdg: Float64Array; v: Float64Array; ticks: number; gen: number }
interface Shown { paths: Paths; gen: number; champion: number; final: boolean }

export class Swarm {
  readonly mesh: THREE.InstancedMesh;
  private track: Track | null = null;
  private queue: Shown[] = [];
  private cur: Shown | null = null;
  private t = 0;
  private played = false;
  private lap: Lap | null = null;
  /** The solid car as drawn this frame, for its engine sound: speed (m/s) and lateral demand (0..1 of the grip). */
  carV = 0;
  carTurn = 0;
  private lastHdg: number | null = null;
  private finaleOn = false;
  private readonly guess: Int32Array;
  private readonly prog: Float64Array;
  private carGuess = 0;
  /** After a seek: find every car on the whole track once (not near its last position). */
  private fullSearch = false;
  private readonly progs: number[] = [];
  /** Track sample the camera follows: the pack's median progress (story) or the champion (finale). */
  focusIdx = 0;
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.MeshBasicMaterial;

  constructor(private readonly car: CarModel, capacity = CONFIG.train.population) {
    const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
    const merged = mergeGeometries([box(1.3, 0.55, 4.4).translate(0, 0.6, 0), box(2.8, 0.08, 0.5).translate(0, 0.3, 2.2), box(2.3, 0.08, 0.6).translate(0, 1.4, -2.0), box(0.5, 0.45, 1.2).translate(0, 1.05, -0.2)]);
    if (!merged) throw new Error('render: ghost geometry did not merge');
    this.geo = merged;
    // see-through but not additive: a pack of near-identical cars on one line stays their colour instead of
    // stacking into a white bloom blob
    this.mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, capacity);
    this.mesh.name = 'ghosts';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.guess = new Int32Array(capacity);
    this.prog = new Float64Array(capacity);
    car.car.visible = false;
  }

  get capacity(): number { return this.mesh.instanceMatrix.count; }
  /** Generation on screen (0 = none yet). */
  get shownGen(): number { return this.finaleOn && this.lap ? this.lap.gen : this.cur?.gen ?? 0; }
  get finale(): boolean { return this.finaleOn; }

  setTrack(t: Track): void {
    this.track = t;
    this.queue = []; this.cur = null; this.lap = null; this.finaleOn = false; this.played = false;
    this.mesh.count = 0; this.car.car.visible = false;
    this.focusIdx = t.startIdx;
  }

  /** Add a recorded generation to the story. A newer final candidate replaces a queued one (only the last is final). */
  enqueue(paths: Paths, gen: number, champion: number, final: boolean): void {
    assertCapacity(this.mesh, paths.count);
    const s = { paths, gen, champion, final };
    const last = this.queue[this.queue.length - 1];
    if (last && last.final && final) this.queue[this.queue.length - 1] = s;
    else this.queue.push(s);
    if (!this.cur) this.next();
  }

  /** Jump to t real seconds into what is on screen (deterministic: the result does not depend on earlier frames). */
  seek(t: number): void { this.t = t; this.fullSearch = true; }

  /** The champion's lap for the finale; it starts once the story has shown the final generation. */
  setLap(lap: Lap): void { this.lap = lap; }

  private next(): void {
    const n = this.queue.shift();
    if (!n || !this.track) return;
    this.cur = n; this.t = 0; this.played = false;
    this.guess.fill(this.track.startIdx); this.prog.fill(0);
  }

  update(dt: number, time: number): void {
    if (!this.cur || !this.track) { this.mesh.count = 0; return; }
    this.t += dt;
    if (!this.finaleOn) {
      if (this.t >= STORY_SLOT_S + FADE_S * 0.5) {
        if (this.queue.length) this.next();
        else if (this.cur.final && this.lap) { this.finaleOn = true; this.t = 0; this.carGuess = this.track.startIdx; this.guess.fill(this.track.startIdx); this.prog.fill(0); }
        else { this.played = true; this.t = 0; this.guess.fill(this.track.startIdx); this.prog.fill(0); } // loop until something newer arrives
      } else if (this.played && this.queue.length) this.next();
    }
    const speed = this.finaleOn ? FINALE_SPEED : STORY_SPEED;
    let tau = this.t * TICK_HZ * speed;
    if (this.finaleOn && this.lap) {
      const period = this.lap.ticks + 2 * TICK_HZ; // a short pause on the line between laps
      if (tau >= period) { this.t = 0; tau = 0; this.carGuess = this.track.startIdx; this.guess.fill(this.track.startIdx); this.prog.fill(0); }
    }
    this.drawGhosts(this.finaleOn ? tau - FINALE_TRAIL_TICKS : tau, time);
    this.drawCar(tau, dt * speed * TICK_HZ);
    this.fullSearch = false;
  }

  private drawGhosts(tau: number, time: number): void {
    const cur = this.cur as Shown, t = this.track as Track;
    const { paths, champion } = cur, S = paths.samples, d = paths.data;
    const faint = this.finaleOn ? FAINT : 1;
    this.mesh.count = paths.count;
    this.progs.length = 0;
    const allProgs: number[] = [];
    for (let i = 0; i < paths.count; i++) {
      const ticks = paths.ticks[i];
      const pose = samplePath(d, S, i, ticks, tau);
      const ended = tau >= ticks;
      const waiting = tau < 0; // finale: not started yet (it trails the champion)
      const fade = ended ? 1 - (tau - ticks) / (TICK_HZ * (this.finaleOn ? FINALE_SPEED : STORY_SPEED)) / FADE_S : 1;
      toWorld(pose.x, pose.y, 0, this.p);
      this.q.setFromAxisAngle(this.up, yawOf(pose.hdg));
      // the generation's best car is drawn solid instead (story); hidden ghosts shrink to nothing
      const hide = fade <= 0 || waiting || (!this.finaleOn && i === champion);
      const sc = hide ? 1e-4 : GHOST_SCALE;
      this.m4.compose(this.p, this.q, this.s.set(sc, sc, sc));
      setInstance(this.mesh, i, this.m4);
      const early = ticks < CONFIG.train.episodeTicks;
      if (ended && early) this.c.setRGB(1.4, 0.2, 0.3).multiplyScalar(Math.max(fade, 0) * (0.55 + 0.45 * Math.abs(Math.sin(time * 9))));
      else if (ended) this.c.setRGB(0.45, 1.5, 2.2).multiplyScalar(0.55 * Math.max(fade, 0));
      else if (pose.wall) this.c.setRGB(2.4, 0.25, 0.35).multiplyScalar(0.6 + 0.4 * Math.abs(Math.sin(time * 18)));
      else this.c.setRGB(0.45, 1.5, 2.2).multiplyScalar(0.55);
      this.c.multiplyScalar(faint);
      this.mesh.setColorAt(i, this.c);
      // progress along the track, for the camera's median
      const idx = locate(t, pose.x, pose.y, this.fullSearch ? t.startIdx : this.guess[i], this.fullSearch ? t.n >> 1 : 40);
      let step = idx - (this.fullSearch ? t.startIdx : this.guess[i]);
      if (step > t.n / 2) step -= t.n; else if (step < -t.n / 2) step += t.n;
      if (this.fullSearch) this.prog[i] = step; else this.prog[i] += step;
      this.guess[i] = idx;
      allProgs.push(this.prog[i]);
      if (!ended) this.progs.push(this.prog[i]);
    }
    if (!this.finaleOn) {
      const ps = this.progs.length ? this.progs : allProgs;
      ps.sort((a, b) => a - b);
      const med = ps[Math.floor(ps.length / 2)];
      this.focusIdx = (((t.startIdx + Math.round(med)) % t.n) + t.n) % t.n;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private drawCar(tau: number, dTicks: number): void {
    const t = this.track as Track, cur = this.cur as Shown, car = this.car;
    let x: number, y: number, hdg: number, v: number;
    if (this.finaleOn && this.lap) {
      const L = this.lap, k = Math.min(tau, L.ticks - 1), j = Math.floor(k), j1 = Math.min(j + 1, L.ticks - 1), u = k - j;
      x = L.x[j] + (L.x[j1] - L.x[j]) * u; y = L.y[j] + (L.y[j1] - L.y[j]) * u;
      let dh = L.hdg[j1] - L.hdg[j]; dh -= 2 * Math.PI * Math.round(dh / (2 * Math.PI));
      hdg = L.hdg[j] + dh * u; v = L.v[j];
      const idx = locate(t, x, y, this.carGuess, this.fullSearch ? t.n >> 1 : 40);
      this.carGuess = idx;
      this.focusIdx = idx;
    } else {
      const pose = samplePath(cur.paths.data, cur.paths.samples, cur.champion, cur.paths.ticks[cur.champion], tau);
      x = pose.x; y = pose.y; hdg = pose.hdg; v = tau >= cur.paths.ticks[cur.champion] ? 0 : pose.v;
    }
    car.car.visible = true;
    toWorld(x, y, 0, car.car.position);
    car.car.rotation.set(0, yawOf(hdg), 0);
    car.car.updateMatrix();
    assertFiniteArray(car.car.matrix.elements, 'champion car');
    const dist = (v * dTicks) / TICK_HZ;
    if (this.lastHdg !== null && dTicks > 0) {
      let dh = hdg - this.lastHdg; dh -= 2 * Math.PI * Math.round(dh / (2 * Math.PI));
      // a cut to another generation's car jumps the heading: that is not a turn
      this.carTurn = Math.abs(dh) > 0.5 ? 0 : Math.min(1, Math.abs((dh * TICK_HZ) / dTicks * v) / CONFIG.car.grip);
    }
    this.lastHdg = hdg;
    this.carV = v;
    for (const w of car.wheels) w.spin.rotation.x = (w.spin.rotation.x + dist / w.r) % (2 * Math.PI);
  }

  dispose(): void { this.geo.dispose(); this.mat.dispose(); this.mesh.dispose(); }
}

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
    v: d[a + 3] + (d[b + 3] - d[a + 3]) * u, wall: d[a + 4] > 0,
  };
}
