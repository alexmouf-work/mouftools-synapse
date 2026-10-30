// The training swarm: every car of one generation on training track 0, played back from recorded paths at ~8×
// (look mock-up's ghost style: additive, glowing). The generation's champion glows yellow. A ghost touching a wall
// flashes red; when its episode ended early (stalled, pinned or reversing) it stays where it stopped and fades out in
// flashing red, so a stuck car reads as stuck, never as a frozen frame. Cars that drove the whole episode fade out.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from '../../common/config';
import { PATH_EVERY, PATH_STRIDE, type Paths } from '../../common/train/episodes';
import { assertCapacity, setInstance } from './guard';
import { toWorld, yawOf } from './trackMesh';

export const PLAYBACK_SPEED = 8;
const TICK_HZ = CONFIG.tick.hz;
const FADE_S = 0.9; // seconds an ended ghost takes to fade
const HOLD_S = 0.5; // pause after the last ghost before the next set

interface Shown { paths: Paths; gen: number; champion: number; maxTicks: number }

export class GhostSwarm {
  readonly mesh: THREE.InstancedMesh;
  private cur: Shown | null = null;
  private pending: Shown | null = null;
  private t = 0;
  /** The set on screen has played through at least once (it loops until a newer one arrives). */
  private played = false;
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();
  private readonly up = new THREE.Vector3(0, 1, 0);
  readonly leader = new THREE.Vector3();
  readonly centre = new THREE.Vector3();
  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.MeshBasicMaterial;

  constructor(capacity = CONFIG.train.population) {
    const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
    const merged = mergeGeometries([box(1.3, 0.55, 4.4).translate(0, 0.6, 0), box(2.8, 0.08, 0.5).translate(0, 0.3, 2.2), box(2.3, 0.08, 0.6).translate(0, 1.4, -2.0), box(0.5, 0.45, 1.2).translate(0, 1.05, -0.2)]);
    if (!merged) throw new Error('render: ghost geometry did not merge');
    this.geo = merged;
    this.mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, capacity);
    this.mesh.name = 'ghosts';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  get capacity(): number { return this.mesh.instanceMatrix.count; }
  /** Generation on screen, or 0. */
  get shownGen(): number { return this.cur?.gen ?? 0; }
  /** True when the swarm would like a newer generation (nothing queued and the current one has played out). */
  wantsNext(): boolean { return !this.pending && (!this.cur || this.played || this.finished()); }

  /** Queue a generation's paths; it starts once the one on screen has played out (or at once if none). */
  offer(paths: Paths, gen: number, champion: number): void {
    assertCapacity(this.mesh, paths.count);
    let maxTicks = 0;
    for (let i = 0; i < paths.count; i++) maxTicks = Math.max(maxTicks, paths.ticks[i]);
    const s = { paths, gen, champion, maxTicks };
    if (!this.cur) { this.cur = s; this.t = 0; this.played = false; } else this.pending = s;
  }

  private finished(): boolean {
    const c = this.cur;
    return !!c && this.t > c.maxTicks / (TICK_HZ * PLAYBACK_SPEED) + FADE_S + HOLD_S;
  }

  update(dt: number, time: number): void {
    if (this.pending && (this.played || this.finished())) { // a newer set starts once the one on screen has played through
      this.cur = this.pending; this.pending = null; this.played = false; this.t = 0;
    } else if (this.cur && this.finished()) { this.played = true; this.t = 0; } // nothing newer: loop it
    const cur = this.cur;
    if (!cur) { this.mesh.count = 0; return; }
    this.t += dt;
    const { paths, champion } = cur, S = paths.samples, d = paths.data;
    const tau = this.t * TICK_HZ * PLAYBACK_SPEED; // sim ticks into the episode
    this.mesh.count = paths.count;
    let n = 0;
    this.centre.set(0, 0, 0);
    for (let i = 0; i < paths.count; i++) {
      const ticks = paths.ticks[i];
      const last = Math.max(0, Math.ceil(ticks / PATH_EVERY) - 1);
      const f = Math.min(tau, Math.max(ticks - 1, 0)) / PATH_EVERY;
      const j = Math.min(Math.floor(f), last), j1 = Math.min(j + 1, last), u = Math.min(f - j, 1);
      const a = (i * S + j) * PATH_STRIDE, b = (i * S + j1) * PATH_STRIDE;
      const x = d[a] + (d[b] - d[a]) * u, y = d[a + 1] + (d[b + 1] - d[a + 1]) * u;
      let dh = d[b + 2] - d[a + 2];
      dh -= 2 * Math.PI * Math.round(dh / (2 * Math.PI));
      const hdg = d[a + 2] + dh * u;
      const wall = d[a + 4] > 0;
      const ended = tau >= ticks;
      const fade = ended ? 1 - (tau - ticks) / (TICK_HZ * PLAYBACK_SPEED) / FADE_S : 1;
      toWorld(x, y, 0, this.p);
      this.q.setFromAxisAngle(this.up, yawOf(hdg));
      const sc = fade > 0 ? 1 : 1e-4;
      this.m4.compose(this.p, this.q, this.s.set(sc, sc, sc));
      setInstance(this.mesh, i, this.m4);
      // stopped early (stalled, pinned, reversing): stays where it stopped and fades out in flashing red;
      // drove the whole episode: fades out in its own colour
      const early = ticks < CONFIG.train.episodeTicks;
      if (ended && early) this.c.setRGB(1.3, 0.22, 0.32).multiplyScalar(Math.max(fade, 0) * (0.55 + 0.45 * Math.abs(Math.sin(time * 9))));
      else if (ended) this.c.setRGB(0.45, 1.5, 2.2).multiplyScalar(0.3 * Math.max(fade, 0));
      else if (wall) this.c.setRGB(2.4, 0.25, 0.35).multiplyScalar(0.55 + 0.45 * Math.abs(Math.sin(time * 18)));
      else if (i === champion) this.c.setRGB(2.6, 1.8, 0.25);
      else this.c.setRGB(0.45, 1.5, 2.2).multiplyScalar(0.3); // dim: 64 additive cars on one spot must not bloom to white
      this.mesh.setColorAt(i, this.c);
      if (i === champion) this.leader.copy(this.p);
      if (!ended) { this.centre.add(this.p); n++; }
    }
    if (n > 0) this.centre.multiplyScalar(1 / n); else this.centre.copy(this.leader);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void { this.geo.dispose(); this.mat.dispose(); this.mesh.dispose(); }
}
