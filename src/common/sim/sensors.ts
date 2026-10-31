// Sensor readings for the 10 fixed inputs. Only wired inputs are computed (an unwired pin reads 0 and costs nothing).
import { CONFIG } from '../config';
import { atan2, cos, PI, sin } from '../fmath';
import { energyLeft } from './energy';
import { EYE_COUNT, IN, INPUTS } from './spec';
import { castRay, type Track } from './track';
import type { CarState } from './car';

const S = CONFIG.sensors;
// Eye direction offsets: rotate the heading by −deg (deg is clockwise from the nose; heading is counter-clockwise).
const EYE_C = new Float64Array(EYE_COUNT), EYE_S = new Float64Array(EYE_COUNT);
for (let e = 0; e < EYE_COUNT; e++) {
  const r = -(INPUTS[e].deg as number) * PI / 180;
  EYE_C[e] = cos(r); EYE_S[e] = sin(r);
}

// Eye e's unit direction for a heading with cos ch and sin sh: THE eye-direction rule (sensors and beams use it).
const eyeX = (ch: number, sh: number, e: number) => ch * EYE_C[e] - sh * EYE_S[e];
const eyeY = (ch: number, sh: number, e: number) => sh * EYE_C[e] + ch * EYE_S[e];

/**
 * Unit direction (sim frame) eye e looks along for a car heading hdg: the heading turned by INPUTS[e].deg clockwise
 * (left −90°, front-left −45°, front 0°, front-right +45°, right +90°, back 180°). The drive view's beams use this.
 */
export function eyeDirection(hdg: number, e: number): { dx: number; dy: number } {
  const ch = cos(hdg), sh = sin(hdg);
  return { dx: eyeX(ch, sh, e), dy: eyeY(ch, sh, e) };
}

/** Distance (m) seen by eye e, capped at the eye range. */
export function eyeDistance(c: CarState, t: Track, e: number): number {
  const { dx, dy } = eyeDirection(c.hdg, e);
  return castRay(t.grid, c.x, c.y, dx, dy, S.eyeRange);
}

/** pool: the run's energy pool (energy.poolFor). */
export function readSensors(c: CarState, t: Track, used: Uint8Array, pool: number, out: Float64Array): void {
  const ch = cos(c.hdg), sh = sin(c.hdg);
  for (let e = 0; e < EYE_COUNT; e++) {
    if (!used[e]) { out[e] = 0; continue; }
    const dx = eyeX(ch, sh, e), dy = eyeY(ch, sh, e);
    out[e] = 1 - castRay(t.grid, c.x, c.y, dx, dy, S.eyeRange) / S.eyeRange;
  }
  if (used[IN.road]) {
    const j = (c.idx + Math.round(S.roadAhead / t.ds)) % t.n;
    const vx = t.px[j] - c.x, vy = t.py[j] - c.y;
    // signed angle from heading to the point ahead; + = left in world terms, so negate: the input is + = right
    out[IN.road] = -atan2(ch * vy - sh * vx, ch * vx + sh * vy) / PI;
  } else out[IN.road] = 0;
  out[IN.energy] = used[IN.energy] ? energyLeft(c.energyUsed, pool) : 0;
  out[IN.speed] = used[IN.speed] ? c.v / S.speedNorm : 0;
  out[IN.bias] = used[IN.bias] ? 1 : 0;
}
