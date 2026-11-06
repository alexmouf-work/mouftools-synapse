// The broadcast cameras' line of sight (match polish §3, principal 2026-11-05: "placed with direct line of sight to the
// track, no trees or stands in the way"): every spot sees every road sample it covers, past every box of scenery (the
// stand, its crowd, gates, boards, lights, chevrons, trees) and over the terrain.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/common/config';
import { familyOf, generateTrack } from '../../src/common/sim/track';
import { buildScenery, terrainOf } from '../../src/client/render/scenery';
import { blocker, corridorOf, coveredSamples, covers, obstaclesOf, sightTarget } from '../../src/client/render/sight';
import { buildStadium } from '../../src/client/render/stadium';

const tex = { banner: () => new THREE.Texture(), gate: () => new THREE.Texture(), lamp: new THREE.Texture(), chevron: new THREE.Texture() };

describe('broadcast line of sight', () => {
  it('blocker finds a box on the line and misses one beside it', () => {
    const g = new THREE.Group(), m = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    m.position.set(5, 0, 0); m.rotation.y = 0.7; g.add(m);
    const obs = obstaclesOf(g);
    expect(blocker(new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0), obs)).not.toBeNull();
    expect(blocker(new THREE.Vector3(0, 3, 0), new THREE.Vector3(10, 3, 0), obs)).toBeNull();
    expect(blocker(new THREE.Vector3(0, 0, 0), new THREE.Vector3(3, 0, 0), obs)).toBeNull(); // stops short of it
  });

  it('no scenery box or hill meets a spot\'s sight lines (race tracks of 10 cars; every family)', () => {
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
    const fams = new Set<string>();
    let lines = 0, spots = 0, covered = 0, road = 0;
    for (const s of seeds) {
      const t = generateTrack(s, CONFIG.match.cars), st = buildStadium(t, tex);
      fams.add(familyOf(s));
      const sc = buildScenery(t, t.seed, st.keepClear, st.tvSpots.map((sp) => corridorOf(t, sp)));
      const root = new THREE.Group();
      root.add(st.group, sc.group);
      const obs = obstaclesOf(root, (o) => o.name === 'terrain' || o.name === 'cloud');
      expect(obs.some((o) => o.name.startsWith('trees.'))).toBe(true);
      const ground = terrainOf(t), q = new THREE.Vector3(), b = new THREE.Vector3();
      for (const sp of st.tvSpots) {
        spots++;
        expect(Number.isFinite(sp.p.x + sp.p.y + sp.p.z)).toBe(true);
        for (const j of coveredSamples(sp, t.n)) {
          sightTarget(t, j, b);
          const hit = blocker(sp.p, b, obs);
          expect(hit, `seed ${s}: spot at sample ${sp.i} → sample ${j} blocked by ${hit?.name}`).toBeNull();
          for (let k = 1; k < 8; k++) {
            q.lerpVectors(sp.p, b, k / 8);
            expect(q.y, `seed ${s}: spot ${sp.i} → ${j}: a hill at ${k}/8`).toBeGreaterThan(ground(q.x, q.z) + 0.3);
          }
          lines++;
        }
      }
      // how much of the lap some spot covers (the rest is the POV camera's)
      for (let j = 0; j < t.n; j++) { road++; if (st.tvSpots.some((sp) => covers(sp, j, t.n))) covered++; }
      sc.dispose(); st.dispose();
    }
    expect(fams.size).toBeGreaterThanOrEqual(5);
    expect(spots).toBeGreaterThan(seeds.length * 6);
    expect(covered / road).toBeGreaterThan(0.7);
    console.log(`sight: ${spots} spots, ${lines} sight lines clear; ${(100 * covered / road).toFixed(0)}% of the road covered by a spot`);
  }, 120_000);
});
