// Skid-steer car (solo-loop plan §3 "Car"). Each wheel's target speed = wheelSpeed × its output. The car eases toward
// the mean side speed (accel/brake limits), yaws at (vR − vL) / trackWidth capped by lateral grip (and yawMax at low
// speed), and loses speed to front/rear mismatch on a side. Walls clamp the car back, cut speed, ease the heading to
// the tangent and count a wall tick. Boost pads add speed once per pad per lap. All Float64.
import { CONFIG, DT } from '../config';
import { cos, PI, sin, wrapAngle } from '../fmath';
import { locate, type Track } from './track';

const K = CONFIG.car;
const NO_LAP = -0x7fffffff;

export interface CarState {
  x: number;
  y: number;
  hdg: number;
  v: number;
  /** Nearest centreline sample. */
  idx: number;
  /** Arc position of the last update (for unwrapping progress). */
  s: number;
  /** Signed lateral offset from the centreline (+ = left). */
  off: number;
  /** Cumulative centreline progress since the start (m; backwards subtracts). */
  prog: number;
  maxProg: number;
  wallTicks: number;
  /** Energy used on the previous tick. */
  energyPrev: number;
  /** Energy used so far this run, taken from the pool (drives "Energy left" and the noise level). */
  energyUsed: number;
  noiseA: number;
  tick: number;
  /** Per pad: the lap on which it last boosted this car. */
  padLap: number[];
}

/** A car at rest at sample i (the start line by default; gradient trainers also start lanes elsewhere). */
export function startCar(t: Track, i: number = t.startIdx): CarState {
  return {
    x: t.px[i], y: t.py[i], hdg: t.th[i], v: 0, idx: i, s: i * t.ds, off: 0, prog: 0, maxProg: 0, wallTicks: 0,
    energyPrev: 0, energyUsed: 0, noiseA: 0, tick: 0, padLap: t.pads.map(() => NO_LAP),
  };
}

/** Re-find the nearest sample and update offset and progress. */
function track(c: CarState, t: Track): void {
  const i = locate(t, c.x, c.y, c.idx, 3);
  c.idx = i;
  const ex = c.x - t.px[i], ey = c.y - t.py[i];
  let along = ex * t.tx[i] + ey * t.ty[i];
  if (along > t.ds) along = t.ds; else if (along < -t.ds) along = -t.ds;
  c.off = -ex * t.ty[i] + ey * t.tx[i];
  const s = i * t.ds + along;
  let d = s - c.s;
  const half = t.len / 2;
  if (d > half) d -= t.len; else if (d < -half) d += t.len;
  c.s = s;
  c.prog += d;
  if (c.prog > c.maxProg) c.maxProg = c.prog;
}

/**
 * Advance one brain tick (CONFIG.tick.substeps physics substeps) with wheel outputs fl, fr, rl, rr in −1..1.
 * Returns true if the car touched a wall this tick.
 */
export function stepPhysics(c: CarState, t: Track, fl: number, fr: number, rl: number, rr: number): boolean {
  const W = K.wheelSpeed;
  const vL = (fl + rl) * 0.5 * W, vR = (fr + rr) * 0.5 * W;
  const vT = (vL + vR) * 0.5;
  const mis = ((fl > rl ? fl - rl : rl - fl) + (fr > rr ? fr - rr : rr - fr)) * 0.5;
  const yawWant = (vR - vL) / K.trackWidth;
  let wall = false;
  for (let k = 0; k < CONFIG.tick.substeps; k++) {
    const dv = vT - c.v;
    const speeding = c.v >= 0 ? dv > 0 : dv < 0;
    const lim = (speeding ? K.accel : K.brake) * DT;
    c.v += dv > lim ? lim : dv < -lim ? -lim : dv;
    const scr = K.scrub * mis * DT;
    if (c.v > 0) c.v = c.v > scr ? c.v - scr : 0;
    else if (c.v < 0) c.v = -c.v > scr ? c.v + scr : 0;
    const av = c.v < 0 ? -c.v : c.v;
    let cap = K.yawMax;
    if (av > 0 && K.grip / av < cap) cap = K.grip / av;
    const yaw = yawWant > cap ? cap : yawWant < -cap ? -cap : yawWant;
    c.hdg = wrapAngle(c.hdg + yaw * DT);
    c.x += c.v * cos(c.hdg) * DT;
    c.y += c.v * sin(c.hdg) * DT;
    track(c, t);
    if (c.off > K.wallCar || c.off < -K.wallCar) {
      const i = c.idx;
      const push = c.off > 0 ? c.off - K.wallCar : c.off + K.wallCar;
      c.x -= -t.ty[i] * push;
      c.y -= t.tx[i] * push;
      c.v *= K.wallSpeedKeep;
      const fwd = cos(c.hdg) * t.tx[i] + sin(c.hdg) * t.ty[i] >= 0;
      const target = fwd ? t.th[i] : wrapAngle(t.th[i] + PI);
      c.hdg = wrapAngle(c.hdg + K.wallHeadingEase * wrapAngle(target - c.hdg));
      track(c, t);
      wall = true;
    }
  }
  const pad = t.padAt[c.idx];
  if (pad >= 0 && c.off < K.padHalfWidth && c.off > -K.padHalfWidth) {
    const lap = Math.floor(c.prog / t.len);
    if (c.padLap[pad] !== lap) {
      c.padLap[pad] = lap;
      c.v = c.v + K.padBoost > K.padCap ? K.padCap : c.v + K.padBoost;
    }
  }
  if (wall) c.wallTicks++;
  c.tick++;
  if (!(Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.hdg) && Number.isFinite(c.v) && Number.isFinite(c.prog))) {
    throw new Error(`car: non-finite state at tick ${c.tick}: ${JSON.stringify({ x: c.x, y: c.y, hdg: c.hdg, v: c.v })}`);
  }
  return wall;
}
