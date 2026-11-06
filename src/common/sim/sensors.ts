// Sense cells read from the car and the track, through the rules in senses.ts (one definition, shared with the
// designer's graphs). Boundary vector cells: a wall inside a 20 m field facing one way, sampled by three short rays
// across the field. Long-range boundary vector cells: the same out to 60 m, inverted (senses plan §3 and its
// 2026-11-06 section: 1 − the short cell's response, so d / R along the field's centre, 1 with no wall in range). Head direction: the cosine
// of the heading against the preferred one. Grid cells: the hexagonal pattern at the car's position. Speed: v / top.
// Each cell reads with its own learned tuning (net.tune, decoded from its field parameters; B2e).
import { cos, PI, sin } from '../fmath';
import { SENSE_CODE, type Net } from './brain';
import { fieldAct, gridAct, hdAct, speedAct } from './senses';
import { castRay, hiddenLayer, type Track } from './track';
import type { CarState } from './car';

const DEG = PI / 180;

/** World direction (unit vector) of a bearing `deg` degrees clockwise from the nose of a car heading `hdg`. */
export function bearingDir(hdg: number, deg: number): { dx: number; dy: number } {
  const a = hdg - deg * DEG;
  return { dx: cos(a), dy: sin(a) };
}

/**
 * A boundary vector cell with field (dir °, width °, range m): the strongest of three rays across it. With `keep`, the
 * strongest ray's distance and angular weight go to keep[at], keep[at + 1] (for its range gradient, fieldgrad.ts).
 */
export function boundaryValue(c: CarState, t: Track, dir: number, w: number, R: number, keep?: Float64Array, at = 0): number {
  let best = 0, bd = R, be = 0;
  const skip = hiddenLayer(t, c.idx); // at the figure eight's crossing, the other pass's walls are not seen
  for (let j = -1; j <= 1; j++) {
    const off = (j * w) / 2, ang = c.hdg - (dir + off) * DEG, dx = cos(ang), dy = sin(ang); // bearingDir, inline (no object per ray)
    const d = castRay(t.grid, c.x, c.y, dx, dy, R, skip), a = fieldAct(off, d, R, w);
    if (a > best) { best = a; bd = d; be = fieldAct(off, 0, R, w); }
  }
  if (keep) { keep[at] = bd; keep[at + 1] = be; }
  return best;
}

/** Every sense cell's value for car c, in net input order, into out. */
export function readSensors(c: CarState, t: Track, net: Net, out: Float64Array): void {
  const tu = net.tune;
  for (let i = 0; i < net.nIn; i++) {
    const q = 4 * i;
    switch (net.sense[i]) {
      case SENSE_CODE.boundary: out[i] = boundaryValue(c, t, tu[q], tu[q + 1], tu[q + 2], net.ray, 2 * i); break;
      // the long-range cell is the short one's response inverted (senses.ts farAct): d / R along its centre, 1 on open road
      case SENSE_CODE.far: out[i] = 1 - boundaryValue(c, t, tu[q], tu[q + 1], tu[q + 2], net.ray, 2 * i); break;
      case SENSE_CODE.hd: out[i] = hdAct(c.hdg, tu[q]); break;
      case SENSE_CODE.grid: out[i] = gridAct(c.x, c.y, tu[q], net.gridPhase[i], tu[q + 1], tu[q + 2], tu[q + 3]); break;
      default: out[i] = speedAct(c.v, tu[q]);
    }
  }
}
