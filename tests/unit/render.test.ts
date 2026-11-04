// Renderer guards in Node (three builds geometry without a GL context): one NaN vertex blacks out the frame through
// bloom, and an instance write past capacity is silently dropped, so both must throw.
import * as THREE from 'three';
import { defaultSpec, paramCount } from '../../src/common/sim/spec';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/common/config';
import { generateTrack } from '../../src/common/sim/track';
import { PATH_STRIDE, type Paths } from '../../src/common/train/episodes';
import { makeCar } from '../../src/client/render/car';
import { MAX_GHOSTS, MAX_OFFSET, MIN_SHOW_S, offsetFor, Swarm } from '../../src/client/render/ghosts';
import { buildFinish } from '../../src/client/render/finish';
import { assertFiniteGeometry, setInstance } from '../../src/client/render/guard';
import { buildScenery } from '../../src/client/render/scenery';
import { buildStadium } from '../../src/client/render/stadium';
import { runDrive } from '../../src/common/sim/race';
import { trackParts } from '../../src/client/render/trackMesh';

/** Cars driving along a real track's centreline, some stopping early. */
function paths(t: ReturnType<typeof generateTrack>, count: number, samples = 200): Paths {
  const data = new Float64Array(count * samples * PATH_STRIDE), ticks = new Int32Array(count), nW = 3;
  for (let i = 0; i < count; i++) {
    ticks[i] = i % 3 === 0 ? 120 + i : 400;
    for (let j = 0; j < samples; j++) {
      const k = (t.startIdx + j * 2 + (i % 5)) % t.n, q = (i * samples + j) * PATH_STRIDE;
      data[q] = t.px[k]; data[q + 1] = t.py[k]; data[q + 2] = t.th[k]; data[q + 3] = 40; data[q + 4] = j % 7 === 0 ? 1 : 0;
    }
  }
  return { count, ids: Int32Array.from({ length: count }, (_, i) => i), w: new Float64Array(count * nW), nW, hl: count > 1 ? 1 : 0, hlProg: 0, act: new Float64Array(0), nN: 0, samples, data, ticks };
}

describe('render guards', () => {
  it('track geometry is finite for 200 seeds', () => {
    for (let s = 1; s <= 200; s++) {
      const parts = trackParts(generateTrack(s));
      expect(parts.length).toBeGreaterThan(10);
      for (const p of parts) assertFiniteGeometry(p.geometry, p.key); // throws on NaN
    }
  });
  it('scenery is finite (terrain, trees within capacity) for a few seeds', () => {
    for (const s of [1, 2, 3]) buildScenery(generateTrack(s), s).dispose();
  });
  it('a NaN vertex throws', () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, NaN, 0, 0, 1, 0], 3));
    expect(() => assertFiniteGeometry(g, 'bad')).toThrow(/non-finite/);
  });
  it('instance writes past capacity, or with a NaN matrix, throw', () => {
    const m = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 4);
    setInstance(m, 3, new THREE.Matrix4());
    expect(() => setInstance(m, 4, new THREE.Matrix4())).toThrow(/capacity/);
    expect(() => setInstance(m, 0, new THREE.Matrix4().makeTranslation(NaN, 0, 0))).toThrow(/non-finite/);
  });
  it('the ghosts: a whole generation, added in over frames; the newest generation after the minimum, never one twice, offsets never shrinking, then the champion', () => {
    const t = generateTrack(4);
    const sw = new Swarm(makeCar('#ffc21a', '#14161d', new THREE.Texture()));
    sw.setTrack(t);
    expect(sw.capacity).toBe(MAX_GHOSTS);
    expect(() => sw.offer(paths(t, MAX_GHOSTS + 1), 1, 0)).toThrow(/capacity|holds/);
    const step = (s: number) => { for (let k = 0; k < Math.round(s / 0.05); k++) sw.update(0.05, k * 0.05); };
    sw.offer(paths(t, MAX_GHOSTS), 1, 0);
    expect(sw.shownGen).toBe(1); // the first is shown at once
    const added: number[] = [];
    for (let k = 0; k < 5; k++) { sw.update(0.05, k * 0.05); added.push(sw.shownCount); }
    expect(added).toEqual([16, 32, 48, 64, 64]); // added in over frames, not all at once
    sw.offer(paths(t, 20), 2, 0.1);
    sw.offer(paths(t, 20), 3, 0.2); // only the newest waiting one matters
    step(MIN_SHOW_S - 0.5);
    expect(sw.shownGen).toBe(1); // not before the minimum
    step(0.4);
    expect(sw.shownGen).toBe(3);
    sw.offer(paths(t, 20), 2, 0.9); // older than what is on screen: ignored
    sw.offer(paths(t, 12), 7, 0.05); // a smaller share than before: the offset still never shrinks
    step(MIN_SHOW_S + 0.1);
    expect(sw.shownGen).toBe(7);
    step(10); // nothing newer: it holds (the road never empties)
    expect(sw.shownGen).toBe(7);
    expect(sw.dots.length).toBe(12);
    expect(MAX_GHOSTS).toBe(CONFIG.train.population); // the whole population, as before
    expect(sw.log.map((l) => l.gen)).toEqual([1, 3, 7]);
    const offs = sw.log.map((l) => l.offset);
    expect(offs).toEqual([0, offsetFor(0.2), offsetFor(0.2)]);
    expect(offsetFor(1)).toBe(MAX_OFFSET);
    const n = 600, lap = { x: new Float64Array(n), y: new Float64Array(n), hdg: new Float64Array(n), v: new Float64Array(n).fill(40), ticks: n, gen: 7 };
    for (let k = 0; k < n; k++) { const i = (t.startIdx + k) % t.n; lap.x[k] = t.px[i]; lap.y[k] = t.py[i]; lap.hdg[k] = t.th[i]; }
    sw.finish(lap);
    step(0.2);
    expect(sw.finale).toBe(true);
    sw.offer(paths(t, 20), 9, 1); // nothing after the finale
    step(30); // loops the lap; every matrix checked finite
    expect(sw.finale).toBe(true);
    expect(sw.log.map((l) => l.gen)).toEqual([1, 3, 7, 7]); // the champion's lap last, never generation 1 again
    expect(sw.log[3].offset).toBe(-1);
  });
  it('the finish flags: two, finite, clear of the road, for 50 seeds', () => {
    for (let s = 1; s <= 50; s++) {
      const t = generateTrack(s), f = buildFinish(t, new THREE.Texture());
      expect(f.flags).toBe(2);
      f.group.updateMatrixWorld(true);
      f.group.traverse((o) => { for (const e of o.matrixWorld.elements) expect(Number.isFinite(e)).toBe(true); });
      f.dispose();
    }
  });
  it('the drive stadium (stand, crowd, gates, boards, lights, chevrons) is finite and within capacity for 50 seeds', () => {
    const tex = { banner: () => new THREE.Texture(), gate: () => new THREE.Texture(), lamp: new THREE.Texture(), chevron: new THREE.Texture() };
    for (let s = 1; s <= 50; s++) {
      const t = generateTrack(s);
      const st = buildStadium(t, tex); // every geometry and instance write is checked inside
      expect(st.tvSpots.length).toBeGreaterThan(5);
      let crowd = 0;
      st.group.traverse((o) => { if (o instanceof THREE.InstancedMesh && o.name === 'crowd') crowd = o.count; });
      expect(crowd).toBeGreaterThan(500);
      st.group.updateMatrixWorld(true);
      st.group.traverse((o) => { for (const e of o.matrixWorld.elements) expect(Number.isFinite(e)).toBe(true); });
      buildScenery(t, s, st.keepClear).dispose();
      st.dispose();
    }
  });
  it('a drive is deterministic and its hash covers the run', () => {
    const spec = defaultSpec(), n = paramCount(spec), w = Array.from({ length: n }, (_, k) => ((k * 7) % 5 - 2) / 2);
    const a = runDrive({ spec, w }, 42), b = runDrive({ spec, w: [...w] }, 42), c = runDrive({ spec, w: w.map((x, k) => (k === n - 1 ? x + 0.1 : x)) }, 42);
    expect(a.rec.ticks).toBe(CONFIG.drive.ticks);
    expect(b.hash).toBe(a.hash);
    expect(c.hash).not.toBe(a.hash);
  });
});
