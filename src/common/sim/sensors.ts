// Sense cells read from the car and the track, through the rules in senses.ts (one definition, shared with the
// designer's graphs). Boundary vector cells: a wall inside a 20 m field facing one way, sampled by three short rays
// across the field. Landmark cells: the finish line within 40 m, in the field's direction. Head direction: the cosine
// of the heading against the preferred one. Grid cells: the hexagonal pattern at the car's position. Speed: v / top.
import { CONFIG } from '../config';
import { atan2, cos, PI, sin, wrapAngle } from '../fmath';
import { SENSE_CODE, type Net } from './brain';
import { fieldAct, fieldWidthDeg, gridAct, gridPhase, gridScale, hdAct, hdPreferred, speedAct, spreadDeg } from './senses';
import { castRay, type Track } from './track';
import type { CarState } from './car';

const S = CONFIG.senses;
const DEG = PI / 180;

/** World direction (unit vector) of a bearing `deg` degrees clockwise from the nose of a car heading `hdg`. */
export function bearingDir(hdg: number, deg: number): { dx: number; dy: number } {
  const a = hdg - deg * DEG;
  return { dx: cos(a), dy: sin(a) };
}

/** Boundary vector cell k of n: the strongest of three rays across its field (centre and both half-widths). */
export function boundaryValue(c: CarState, t: Track, k: number, n: number): number {
  const dir = spreadDeg(k, n), w = fieldWidthDeg('boundary', n), R = S.boundary.rangeM;
  let best = 0;
  for (let j = -1; j <= 1; j++) {
    const off = (j * w) / 2, { dx, dy } = bearingDir(c.hdg, dir + off);
    const a = fieldAct(off, castRay(t.grid, c.x, c.y, dx, dy, R), R, w);
    if (a > best) best = a;
  }
  return best;
}

/** The finish line: the segment across the road at the start, wall to wall. */
function finishPoint(c: CarState, t: Track): { qx: number; qy: number } {
  const i = t.startIdx, nx = -t.ty[i], ny = t.tx[i], h = t.wallOff;
  const ax = t.px[i] + nx * h, ay = t.py[i] + ny * h, ex = -2 * nx * h, ey = -2 * ny * h;
  let u = ((c.x - ax) * ex + (c.y - ay) * ey) / (ex * ex + ey * ey);
  u = u < 0 ? 0 : u > 1 ? 1 : u;
  return { qx: ax + ex * u, qy: ay + ey * u };
}

/** Landmark cell k of n: the finish line inside its field (distance and bearing to its nearest point). */
export function landmarkValue(c: CarState, t: Track, k: number, n: number): number {
  const { qx, qy } = finishPoint(c, t), dx = qx - c.x, dy = qy - c.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  const bearing = d > 1e-9 ? -wrapAngle(atan2(dy, dx) - c.hdg) / DEG : 0; // degrees clockwise from the nose
  const w = fieldWidthDeg('landmark', n);
  let off = bearing - spreadDeg(k, n);
  off -= 360 * Math.round(off / 360);
  return fieldAct(off, d, S.landmark.rangeM, w);
}

/** Every sense cell's value for car c, in net input order, into out. */
export function readSensors(c: CarState, t: Track, net: Net, out: Float64Array): void {
  for (let i = 0; i < net.nIn; i++) {
    const k = net.cellK[i], n = net.cellN[i];
    switch (net.sense[i]) {
      case SENSE_CODE.boundary: out[i] = boundaryValue(c, t, k, n); break;
      case SENSE_CODE.landmark: out[i] = landmarkValue(c, t, k, n); break;
      case SENSE_CODE.hd: out[i] = hdAct(c.hdg, hdPreferred(k, n)); break;
      case SENSE_CODE.grid: out[i] = gridAct(c.x, c.y, gridScale(k), gridPhase(k)); break;
      default: out[i] = speedAct(c.v);
    }
  }
}
