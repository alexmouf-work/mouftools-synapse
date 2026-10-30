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

/** Distance (m) seen by eye e, capped at the eye range. */
export function eyeDistance(c: CarState, t: Track, e: number): number {
  const ch = cos(c.hdg), sh = sin(c.hdg);
  const dx = ch * EYE_C[e] - sh * EYE_S[e], dy = sh * EYE_C[e] + ch * EYE_S[e];
  return castRay(t.grid, c.x, c.y, dx, dy, S.eyeRange);
}

export function readSensors(c: CarState, t: Track, used: Uint8Array, budget: number, out: Float64Array): void {
  const ch = cos(c.hdg), sh = sin(c.hdg);
  for (let e = 0; e < EYE_COUNT; e++) {
    if (!used[e]) { out[e] = 0; continue; }
    const dx = ch * EYE_C[e] - sh * EYE_S[e], dy = sh * EYE_C[e] + ch * EYE_S[e];
    out[e] = 1 - castRay(t.grid, c.x, c.y, dx, dy, S.eyeRange) / S.eyeRange;
  }
  if (used[IN.road]) {
    const j = (c.idx + Math.round(S.roadAhead / t.ds)) % t.n;
    const vx = t.px[j] - c.x, vy = t.py[j] - c.y;
    // signed angle from heading to the point ahead; + = left in world terms, so negate: the input is + = right
    out[IN.road] = -atan2(ch * vy - sh * vx, ch * vx + sh * vy) / PI;
  } else out[IN.road] = 0;
  out[IN.energy] = used[IN.energy] ? energyLeft(c.energyPrev, budget) : 0;
  out[IN.speed] = used[IN.speed] ? c.v / S.speedNorm : 0;
  out[IN.bias] = used[IN.bias] ? 1 : 0;
}
