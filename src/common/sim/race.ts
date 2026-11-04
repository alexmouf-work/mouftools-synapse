// Run one car (cars are ghosts to each other, so N cars are N independent runs) for up to T ticks, optionally
// recording frames and activations. Training episodes stop early on a stall or when the car goes too far backwards.
import { CONFIG } from '../config';
import { Hasher } from '../hash';
import { compile, evalNet, type Net } from './brain';
import { speedCap } from './energy';
import type { Genome } from './spec';
import { generateTrack } from './track';
import { readSensors } from './sensors';
import { startCar, stepPhysics, type CarState } from './car';
import type { Track } from './track';

const TR = CONFIG.train;

export interface Recording {
  /** Per tick after the step: x, y, hdg, v. */
  x: Float64Array;
  y: Float64Array;
  hdg: Float64Array;
  v: Float64Array;
  /** Per tick: the brain's energy load that tick (% of the supply; speed got what was left). */
  energy: Float64Array;
  /** Per tick: 1 if the car touched a wall. */
  wall: Uint8Array;
  /** Per tick: centreline progress (m). Not part of recordingHash (it follows from x, y). */
  prog: Float64Array;
  /** Per tick: every node's output (nNodes per tick). */
  act: Float64Array;
  ticks: number;
}

export function newRecording(net: Net, ticks: number): Recording {
  return {
    x: new Float64Array(ticks), y: new Float64Array(ticks), hdg: new Float64Array(ticks), v: new Float64Array(ticks),
    energy: new Float64Array(ticks), wall: new Uint8Array(ticks), prog: new Float64Array(ticks), act: new Float64Array(ticks * net.nNodes), ticks: 0,
  };
}

export interface RunOpts {
  ticks: number;
  /** Stop on stall / backwards (training episodes). */
  earlyStop: boolean;
  record?: Recording;
}

export interface RunResult {
  ticks: number;
  prog: number;
  maxProg: number;
  wallTicks: number;
}

/** Scratch buffers per net size, so the hot loop allocates nothing. */
export class Runner {
  private inputs = new Float64Array(0);
  private vals = new Float64Array(0);

  run(net: Net, t: Track, o: RunOpts): RunResult {
    if (this.vals.length < net.nNodes) this.vals = new Float64Array(net.nNodes);
    const c = startCar(t);
    let mark = 0;
    for (let k = 0; k < o.ticks; k++) {
      const wall = this.tick(net, t, c);
      const rec = o.record;
      if (rec) {
        rec.x[k] = c.x; rec.y[k] = c.y; rec.hdg[k] = c.hdg; rec.v[k] = c.v; rec.energy[k] = c.load; rec.wall[k] = wall ? 1 : 0; rec.prog[k] = c.prog;
        rec.act.set(this.vals.subarray(0, net.nNodes), k * net.nNodes);
        rec.ticks = k + 1;
      }
      if (o.earlyStop) {
        mark = stopCheck(c, mark);
        if (mark < 0) break;
      }
    }
    return { ticks: c.tick, prog: c.prog, maxProg: c.maxProg, wallTicks: c.wallTicks };
  }

  /**
   * One brain tick + physics for car c. actionNoise (training-only exploration, 4 values) is added to the wheel
   * outputs before physics; races never pass it. `act` (training only) sees every node's value after the brain ran
   * and before physics, and may rewrite the wheel outputs vals[outStart .. outStart + 3] (a teacher taking over,
   * sampled or noisy actions); the energy of the brain's own tick is charged either way.
   */
  tick(net: Net, t: Track, c: CarState, actionNoise?: ArrayLike<number>, act?: (vals: Float64Array, outStart: number) => void): boolean {
    if (this.vals.length < net.nNodes) this.vals = new Float64Array(net.nNodes);
    if (this.inputs.length < net.nIn) this.inputs = new Float64Array(net.nIn);
    readSensors(c, t, net, this.inputs);
    const load = evalNet(net, this.inputs, this.vals);
    if (!Number.isFinite(load)) throw new Error(`race: non-finite energy at tick ${c.tick}`);
    c.load = load; c.cap = speedCap(load); // what the brain spends this tick, speed gets the rest
    const o = net.outStart, v = this.vals;
    if (actionNoise) {
      for (let k = 0; k < 4; k++) { const x = v[o + k] + actionNoise[k]; v[o + k] = x < -1 ? -1 : x > 1 ? 1 : x; }
    }
    if (act) act(v, o);
    return stepPhysics(c, t, v[o], v[o + 1], v[o + 2], v[o + 3], c.cap);
  }

  /** Node outputs of the last tick (valid until the next call). */
  lastValues(): Float64Array { return this.vals; }
}

/**
 * THE training stop rule (episodes, and gradient trainers' lanes): call after each tick with the mark returned last
 * time (0 at the start). Returns the new mark, or −1 when the episode ends: progress below backLimit, or max progress
 * grew less than stallMetres over the last stallTicks.
 */
export function stopCheck(c: CarState, mark: number): number {
  if (c.prog < TR.backLimit) return -1;
  if (c.tick % TR.stallTicks === 0) {
    if (c.maxProg - mark < TR.stallMetres) return -1;
    return c.maxProg;
  }
  return mark;
}

/** THE training fitness of one run: progress minus the wall penalty. */
export const fitnessOf = (r: { prog: number; wallTicks: number }): number => r.prog - TR.wallPenalty * r.wallTicks;

/** Hash of a recording: frames, energy and every node's output, bit for bit. */
export function recordingHash(rec: Recording): string {
  const n = rec.ticks, a = rec.act.length / Math.max(rec.x.length, 1);
  return new Hasher().f64s(rec.x.subarray(0, n)).f64s(rec.y.subarray(0, n)).f64s(rec.hdg.subarray(0, n)).f64s(rec.v.subarray(0, n))
    .f64s(rec.energy.subarray(0, n)).f64s(rec.act.subarray(0, n * a)).hex();
}

/**
 * The drive view's run: the brain on one track for CONFIG.drive.ticks, deterministic and recorded. The browser plays
 * it back; a Node replay of the same genome and track seed gives the same hash.
 */
export function runDrive(g: Genome, trackSeed: number) {
  const net = compile(g);
  const track = generateTrack(trackSeed);
  const rec = newRecording(net, CONFIG.drive.ticks);
  const result = new Runner().run(net, track, { ticks: CONFIG.drive.ticks, earlyStop: false, record: rec });
  return { net, track, rec, result, hash: recordingHash(rec) };
}
