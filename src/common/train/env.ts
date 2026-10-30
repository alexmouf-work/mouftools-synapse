// Metered environment: the only way a trainer reaches the sim. Counts every car-tick; a request whose worst case
// would overrun the experience budget T throws before it runs (fail loudly, never silently trim).
import { CONFIG } from '../config';
import { compile, setWeights, type Net } from '../sim/brain';
import { startCar, type CarState } from '../sim/car';
import { Runner } from '../sim/race';
import { generateTrack, type Track } from '../sim/track';
import { RESULT_STRIDE, type EpisodeSetup, type Executor } from './episodes';

export interface EpisodeOutcome { prog: number; wallTicks: number; ticks: number }

/** One car stepped tick by tick (for gradient trainers; metered one tick per step). */
export interface CarHandle {
  readonly state: CarState;
  /** One tick; actionNoise (4 values) is added to the wheel outputs, then clamped to −1..1. */
  step(actionNoise?: ArrayLike<number>): { wall: boolean; values: Float64Array };
}

export interface Env {
  readonly setup: EpisodeSetup;
  /** Experience budget T (car-ticks). */
  readonly budget: number;
  readonly used: number;
  remaining(): number;
  /** Worst-case car-ticks for running `policies` policies over every training track. */
  worstCase(policies: number): number;
  /** Run every policy on every training track; outcome[p][k]. */
  runEpisodes(w: Float64Array[]): Promise<EpisodeOutcome[][]>;
  openCar(w: ArrayLike<number>, trackIndex: number): CarHandle;
  track(i: number): Track;
}

export class MeteredEnv implements Env {
  private usedTicks = 0;
  private tracks: (Track | undefined)[] = [];
  constructor(readonly setup: EpisodeSetup, private readonly exec: Executor, readonly budget: number = CONFIG.train.T) {}

  get used(): number { return this.usedTicks; }
  remaining(): number { return this.budget - this.usedTicks; }
  worstCase(policies: number): number { return policies * this.setup.trackSeeds.length * this.setup.episodeTicks; }

  private charge(worst: number): void {
    if (this.usedTicks + worst > this.budget) {
      throw new Error(`env: request of up to ${worst} car-ticks overruns the budget (${this.usedTicks} / ${this.budget} used)`);
    }
  }

  async runEpisodes(ws: Float64Array[]): Promise<EpisodeOutcome[][]> {
    const nW = this.setup.spec.conns.length, nT = this.setup.trackSeeds.length;
    this.charge(this.worstCase(ws.length));
    const flat = new Float64Array(ws.length * nW);
    ws.forEach((w, p) => {
      if (w.length !== nW) throw new Error(`env: policy ${p} has ${w.length} weights, spec has ${nW} wires`);
      flat.set(w, p * nW);
    });
    const r = await this.exec.run(flat, ws.length);
    if (r.length !== ws.length * nT * RESULT_STRIDE) throw new Error('env: executor returned the wrong number of results');
    const out: EpisodeOutcome[][] = [];
    let ticks = 0;
    for (let p = 0; p < ws.length; p++) {
      const row: EpisodeOutcome[] = [];
      for (let k = 0; k < nT; k++) {
        const o = (p * nT + k) * RESULT_STRIDE;
        row.push({ prog: r[o], wallTicks: r[o + 1], ticks: r[o + 2] });
        ticks += r[o + 2];
      }
      out.push(row);
    }
    this.usedTicks += ticks;
    return out;
  }

  track(i: number): Track {
    if (i < 0 || i >= this.setup.trackSeeds.length) throw new Error(`env: no training track ${i}`);
    return (this.tracks[i] ??= generateTrack(this.setup.trackSeeds[i]));
  }

  openCar(w: ArrayLike<number>, trackIndex: number): CarHandle {
    const t = this.track(trackIndex);
    const net: Net = compile({ spec: this.setup.spec, w: Array.from(w) });
    setWeights(net, w);
    const state = startCar(t), runner = new Runner();
    const noiseSeed = this.setup.noiseSeeds[trackIndex], budget = this.setup.budget;
    return {
      state,
      step: (actionNoise) => {
        this.charge(1);
        const wall = runner.tick(net, t, state, budget, noiseSeed, actionNoise);
        this.usedTicks += 1;
        return { wall, values: runner.lastValues() };
      },
    };
  }
}
