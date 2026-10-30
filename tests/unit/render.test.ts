// Renderer guards in Node (three builds geometry without a GL context): one NaN vertex blacks out the frame through
// bloom, and an instance write past capacity is silently dropped, so both must throw.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/common/config';
import { generateTrack } from '../../src/common/sim/track';
import { PATH_STRIDE, type Paths } from '../../src/common/train/episodes';
import { GhostSwarm } from '../../src/client/render/ghosts';
import { assertFiniteGeometry, setInstance } from '../../src/client/render/guard';
import { buildScenery } from '../../src/client/render/scenery';
import { trackParts } from '../../src/client/render/trackMesh';

function paths(count: number, samples = 200): Paths {
  const data = new Float64Array(count * samples * PATH_STRIDE), ticks = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    ticks[i] = 100 + i * 4;
    for (let j = 0; j < samples; j++) { const q = (i * samples + j) * PATH_STRIDE; data[q] = j * 3; data[q + 1] = i; data[q + 2] = 3.1 * (j % 3); data[q + 3] = 30; data[q + 4] = j % 7 === 0 ? 1 : 0; }
  }
  return { count, samples, data, ticks };
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
  it('the ghost swarm holds a whole population and refuses more', () => {
    const sw = new GhostSwarm();
    expect(sw.capacity).toBe(CONFIG.train.population);
    expect(() => sw.offer(paths(CONFIG.train.population + 1), 1, 0)).toThrow(/capacity|holds/);
    sw.offer(paths(CONFIG.train.population), 1, 5);
    for (let k = 0; k < 40; k++) sw.update(0.1, k * 0.1); // plays out, every matrix checked finite
    expect(sw.shownGen).toBe(1);
    expect(sw.wantsNext()).toBe(true);
    sw.offer(paths(10), 2, 0);
    sw.update(0.1, 5);
    expect(sw.shownGen).toBe(2);
    expect(sw.mesh.count).toBe(10);
  });
});
