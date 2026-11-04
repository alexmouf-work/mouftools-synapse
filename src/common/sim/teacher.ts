// The scripted teacher for backprop (solo-loop plan §3b: "copy a teacher"): pure pursuit on the centreline for the
// skid-steer car. It reads the car and the track (privileged: the centreline and its curvature, which the brain never
// sees) and returns the four wheel targets the brain is taught to copy. It never touches the sim itself: when it
// drives in training, it does so through a metered lane like any car (train/imitate.ts).
//   steering: aim at the centreline point L ahead (L grows with speed); the arc through it has curvature
//             κ = 2·left / d² (= 2 sin α / d), so the yaw rate wanted is ω = κ·v, and skid-steer gives it as
//             vR − vL = ω × trackWidth.
//   speed:    the slowest corner within braking reach caps the speed: v ≤ √(gripUse·grip / |curv| + 2·brakeUse·brake·s).
import { CONFIG } from '../config';
import { cos, sin } from '../fmath';
import { compile } from './brain';
import type { CarState } from './car';
import { startCar } from './car';
import { Runner, type RunResult } from './race';
import type { BrainSpec } from './spec';
import type { Track } from './track';

const K = CONFIG.car, P = CONFIG.teacher;

/** Per sample: the square of the fastest speed its corner allows (gripUse · grip / |curv|), cached per track. */
const cornerCache = new WeakMap<Track, Float64Array>();
function cornerSpeed2(t: Track): Float64Array {
  let v2 = cornerCache.get(t);
  if (!v2) {
    v2 = new Float64Array(t.n);
    for (let i = 0; i < t.n; i++) {
      const ak = t.curv[i] < 0 ? -t.curv[i] : t.curv[i];
      v2[i] = ak > 1e-9 ? (P.gripUse * K.grip) / ak : Infinity;
    }
    cornerCache.set(t, v2);
  }
  return v2;
}

/** The teacher's wheel targets (FL, FR, RL, RR, each −1..1) for car c on track t. Allocates nothing. */
export function teacherWheels(c: CarState, t: Track, out: Float64Array): void {
  const v = c.v > 0 ? c.v : 0;
  const decel = P.brakeUse * K.brake;
  // speed: the slowest corner within braking reach (in v², one square root at the end)
  const corner = cornerSpeed2(t);
  let vt2: number = K.wheelSpeed * K.wheelSpeed;
  const reach = (v * v) / (2 * decel) + P.speedLook;
  const steps = Math.ceil(reach / t.ds), gain = 2 * decel * t.ds;
  for (let j = 0; j <= steps; j++) {
    const v2 = corner[(c.idx + j) % t.n] + gain * j;
    if (v2 < vt2) vt2 = v2;
  }
  let vt = Math.sqrt(vt2);
  // steering: pure pursuit on the centreline
  let L = P.lookMin + P.lookPerSpeed * v;
  if (L > P.lookMax) L = P.lookMax;
  const j = (c.idx + Math.round(L / t.ds)) % t.n;
  const dx = t.px[j] - c.x, dy = t.py[j] - c.y;
  const ch = cos(c.hdg), sh = sin(c.hdg);
  const fwd = ch * dx + sh * dy, left = -sh * dx + ch * dy;
  const d2 = dx * dx + dy * dy;
  let omega = P.steerGain * ((2 * left) / (d2 > 1 ? d2 : 1)) * (v > P.vMin ? v : P.vMin);
  if (fwd < 0) {
    // the target is behind: turn on the spot towards it
    omega = left >= 0 ? K.yawMax : -K.yawMax;
    vt = 0;
  }
  const half = (omega * K.trackWidth) / 2;
  let l = (vt - half) / K.wheelSpeed, r = (vt + half) / K.wheelSpeed;
  // keep the steering difference when a wheel would pass ±1: give up speed, not the turn
  const hi = l > r ? l : r;
  if (hi > 1) { l -= hi - 1; r -= hi - 1; }
  const lo = l < r ? l : r;
  if (lo < -1) { l -= lo + 1; r -= lo + 1; }
  l = l < -1 ? -1 : l > 1 ? 1 : l;
  r = r < -1 ? -1 : r > 1 ? 1 : r;
  out[0] = l; out[1] = r; out[2] = l; out[3] = r;
}

/** A brain with no wires: it costs nothing, so a teacher-only run never meets the energy noise. */
const EMPTY: BrainSpec = { v: 1, layers: 1, nodes: [], conns: [] };

/**
 * The teacher alone on a track from the start line (a reference for tests and the bench; not part of any training
 * budget: training charges every tick the teacher drives through the metered env).
 */
export function driveTeacher(t: Track, ticks: number, pool: number, noiseSeed = 0): RunResult & { maxV: number } {
  const net = compile({ spec: EMPTY, w: [] });
  const c = startCar(t), runner = new Runner(), out = new Float64Array(4);
  let maxV = 0;
  const act = (vals: Float64Array, o: number) => {
    teacherWheels(c, t, out);
    for (let k = 0; k < 4; k++) vals[o + k] = out[k];
  };
  for (let k = 0; k < ticks; k++) {
    runner.tick(net, t, c, pool, noiseSeed, undefined, act);
    if (c.v > maxV) maxV = c.v;
  }
  return { ticks: c.tick, prog: c.prog, maxProg: c.maxProg, wallTicks: c.wallTicks, maxV };
}
