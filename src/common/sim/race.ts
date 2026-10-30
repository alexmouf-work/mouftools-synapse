// Run one car (cars are ghosts to each other, so N cars are N independent runs) for up to T ticks, optionally
// recording frames and activations. Training episodes stop early on a stall or when the car goes too far backwards.
import { CONFIG } from '../config';
import { evalNet, type Net } from './brain';
import { noiseLevel } from './energy';
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
  /** Per tick: energy used. */
  energy: Float64Array;
  /** Per tick: every node's output (nNodes per tick). */
  act: Float64Array;
  ticks: number;
}

export function newRecording(net: Net, ticks: number): Recording {
  return {
    x: new Float64Array(ticks), y: new Float64Array(ticks), hdg: new Float64Array(ticks), v: new Float64Array(ticks),
    energy: new Float64Array(ticks), act: new Float64Array(ticks * net.nNodes), ticks: 0,
  };
}

export interface RunOpts {
  ticks: number;
  budget: number;
  noiseSeed: number;
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
  private inputs = new Float64Array(10);
  private vals = new Float64Array(0);

  run(net: Net, t: Track, o: RunOpts): RunResult {
    if (this.vals.length < net.nNodes) this.vals = new Float64Array(net.nNodes);
    const c = startCar(t);
    let mark = 0;
    for (let k = 0; k < o.ticks; k++) {
      this.tick(net, t, c, o.budget, o.noiseSeed);
      const rec = o.record;
      if (rec) {
        rec.x[k] = c.x; rec.y[k] = c.y; rec.hdg[k] = c.hdg; rec.v[k] = c.v; rec.energy[k] = c.energyPrev;
        rec.act.set(this.vals.subarray(0, net.nNodes), k * net.nNodes);
        rec.ticks = k + 1;
      }
      if (o.earlyStop) {
        if (c.prog < TR.backLimit) break;
        if (c.tick % TR.stallTicks === 0) {
          if (c.maxProg - mark < TR.stallMetres) break;
          mark = c.maxProg;
        }
      }
    }
    return { ticks: c.tick, prog: c.prog, maxProg: c.maxProg, wallTicks: c.wallTicks };
  }

  /**
   * One brain tick + physics for car c. actionNoise (training-only exploration, 4 values) is added to the wheel
   * outputs before physics; races never pass it.
   */
  tick(net: Net, t: Track, c: CarState, budget: number, noiseSeed: number, actionNoise?: ArrayLike<number>): boolean {
    if (this.vals.length < net.nNodes) this.vals = new Float64Array(net.nNodes);
    c.noiseA = noiseLevel(c.energyPrev, budget);
    readSensors(c, t, net.inUsed, budget, this.inputs);
    const used = evalNet(net, this.inputs, this.vals, c.noiseA, noiseSeed, c.tick);
    if (!Number.isFinite(used)) throw new Error(`race: non-finite energy at tick ${c.tick}`);
    const o = net.outStart, v = this.vals;
    if (actionNoise) {
      for (let k = 0; k < 4; k++) { const x = v[o + k] + actionNoise[k]; v[o + k] = x < -1 ? -1 : x > 1 ? 1 : x; }
    }
    const wall = stepPhysics(c, t, v[o], v[o + 1], v[o + 2], v[o + 3]);
    c.energyPrev = used;
    return wall;
  }

  /** Node outputs of the last tick (valid until the next call). */
  lastValues(): Float64Array { return this.vals; }
}

export const fitnessOf = (r: RunResult): number => r.prog - TR.wallPenalty * r.wallTicks;
