// Line of sight for the broadcast cameras (match polish §3, principal 2026-11-05: "placed with direct line of sight to
// the track, no trees or stands in the way"). A spot covers a stretch of road; a sight line runs from the spot to each
// road sample of that stretch, at a car's roof height on the centreline. Scenery is checked as boxes: each mesh's (or
// each instance's) geometry bounds under its own transform, so a rotated stand is its real shape, not an axis-aligned
// hull. Render-only: nothing here feeds the sim.
import * as THREE from 'three';
import type { Track } from '../../common/sim/track';
import { at } from './trackMesh';

/** The height over the road a sight line aims at (m): a car's roof. */
export const SIGHT_UP = 1.0;
/** Boxes are grown by this much (m) on every side, so a line never grazes scenery. */
const MARGIN = 0.3;

/** A box in its own frame (`inv` takes world points there) and its world-space bounds (for a quick reject). */
export interface Obstacle { box: THREE.Box3; inv: THREE.Matrix4; world: THREE.Box3; name: string }

const m4 = new THREE.Matrix4(), mi = new THREE.Matrix4();

/** Every mesh under `root` (instances one by one) as an obstacle, except what `skip` leaves out (with all under it). */
export function obstaclesOf(root: THREE.Object3D, skip: (o: THREE.Object3D) => boolean = () => false): Obstacle[] {
  const out: Obstacle[] = [];
  root.updateMatrixWorld(true);
  const add = (geo: THREE.BufferGeometry, world: THREE.Matrix4, name: string) => {
    if (!geo.boundingBox) geo.computeBoundingBox();
    const box = geo.boundingBox!.clone().expandByScalar(MARGIN);
    if (box.isEmpty()) return;
    out.push({ box, inv: world.clone().invert(), world: box.clone().applyMatrix4(world), name });
  };
  const walk = (o: THREE.Object3D) => {
    if (!o.visible || skip(o)) return; // and nothing under it
    if (o instanceof THREE.InstancedMesh) {
      for (let k = 0; k < o.count; k++) { o.getMatrixAt(k, mi); add(o.geometry, m4.multiplyMatrices(o.matrixWorld, mi), o.name || 'instance'); }
    } else if (o instanceof THREE.Mesh) add(o.geometry, o.matrixWorld, o.name || o.parent?.name || 'mesh');
    for (const c of o.children) walk(c);
  };
  walk(root);
  return out;
}

const ray = new THREE.Ray(), pa = new THREE.Vector3(), pb = new THREE.Vector3(), hit = new THREE.Vector3(), seg = new THREE.Box3();

/** The first obstacle the segment a–b passes through (or starts in), or null. */
export function blocker(a: THREE.Vector3, b: THREE.Vector3, obs: readonly Obstacle[]): Obstacle | null {
  seg.makeEmpty().expandByPoint(a).expandByPoint(b);
  for (const o of obs) {
    if (!seg.intersectsBox(o.world)) continue;
    pa.copy(a).applyMatrix4(o.inv); pb.copy(b).applyMatrix4(o.inv);
    if (o.box.containsPoint(pa) || o.box.containsPoint(pb)) return o;
    const len = pa.distanceTo(pb);
    if (len < 1e-9) continue;
    ray.origin.copy(pa); ray.direction.copy(pb).sub(pa).divideScalar(len);
    if (ray.intersectBox(o.box, hit) && hit.distanceTo(pa) <= len) return o;
  }
  return null;
}

/** Where a sight line ends: the centreline of sample j at a car's roof height (on the bridge, the bridge's road). */
export const sightTarget = (t: Track, j: number, out = new THREE.Vector3()): THREE.Vector3 => at(t, j, 0, SIGHT_UP, out);

/** A broadcast spot: where it is, the sample it is built round, and the stretch it covers (n samples from i0, wrapping). */
export interface TvSpot { i: number; p: THREE.Vector3; i0: number; n: number }
/** Whether spot s covers sample j. */
export const covers = (s: TvSpot, j: number, trackN: number): boolean => (((j - s.i0) % trackN) + trackN) % trackN < s.n;
/** The samples spot s covers, in order. */
export const coveredSamples = (s: TvSpot, trackN: number): number[] => Array.from({ length: s.n }, (_, k) => (s.i0 + k) % trackN);

/** Squared distance in the ground plane (x, z) from point (x, z) to the segment a–b. */
export function groundDist2(x: number, z: number, a: THREE.Vector3, b: THREE.Vector3): number {
  const dx = b.x - a.x, dz = b.z - a.z, L = dx * dx + dz * dz;
  const u = L > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L)) : 0;
  const ex = a.x + dx * u - x, ez = a.z + dz * u - z;
  return ex * ex + ez * ez;
}

/** A spot's sight lines as kept-clear corridors for later scenery (trees): the lines and their ground bounds. */
export interface Corridor { lines: [THREE.Vector3, THREE.Vector3][]; minX: number; maxX: number; minZ: number; maxZ: number }
export function corridorOf(t: Track, s: TvSpot): Corridor {
  const lines = coveredSamples(s, t.n).map((j) => [s.p.clone(), sightTarget(t, j)] as [THREE.Vector3, THREE.Vector3]);
  let minX = s.p.x, maxX = s.p.x, minZ = s.p.z, maxZ = s.p.z;
  for (const [, b] of lines) { minX = Math.min(minX, b.x); maxX = Math.max(maxX, b.x); minZ = Math.min(minZ, b.z); maxZ = Math.max(maxZ, b.z); }
  return { lines, minX, maxX, minZ, maxZ };
}
/** Whether a round thing of ground radius r at (x, z) stands in any corridor. */
export function inCorridor(cs: readonly Corridor[], x: number, z: number, r: number): boolean {
  for (const c of cs) {
    if (x < c.minX - r || x > c.maxX + r || z < c.minZ - r || z > c.maxZ + r) continue;
    for (const [a, b] of c.lines) if (groundDist2(x, z, a, b) < r * r) return true;
  }
  return false;
}
