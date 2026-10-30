// Neuroevolution (solo-loop plan §3 "Neuroevolution"): population 64 on the phase's training tracks, elitism,
// tournament selection, Gaussian mutation with σ falling linearly over the phase, occasional resets, weights clamped.
// Common random numbers: every policy sees the same tracks and noise. Ties break by index. Runs whole generations
// while the next one's worst case fits the budget; the generation count is a result, not a setting.
import { CONFIG } from '../config';
import { compile, evalNet, genomeHash, specHash } from '../sim/brain';
import { startCar } from '../sim/car';
import { readSensors } from '../sim/sensors';
import type { Genome } from '../sim/spec';
import { derive, Rng, TAG } from '../rng';
import type { Env } from './env';
import { registerTrainer, type Channel, type ProbeFrame, type Trainer, type TrainerEvent, type TrainerOptions } from './trainer';

const P = CONFIG.train;
const CAP = CONFIG.brain.weightCap;
const clampW = (x: number): number => (x > CAP ? CAP : x < -CAP ? -CAP : x);

export class Neuroevo implements Trainer {
  readonly id = 'evolution';
  readonly channels: readonly Channel[] = ['signal'];
  private env: Env | null = null;
  private genome: Genome | null = null;
  private rng = new Rng(0);
  private pop: Float64Array[] = [];
  private champ: Float64Array = new Float64Array(0);
  private gen = 0;
  private finished = false;

  constructor(private readonly opts: TrainerOptions) {}

  init(genome: Genome, seed: number, env: Env): void {
    if (specHash(genome.spec) !== specHash(env.setup.spec)) throw new Error('neuroevo: genome spec differs from the env spec');
    this.env = env;
    this.genome = genome;
    this.rng = new Rng(derive(seed, TAG.trainer));
    const nW = genome.spec.conns.length;
    this.pop = [];
    if (this.opts.start === 'fresh') {
      for (let p = 0; p < P.population; p++) {
        const w = new Float64Array(nW);
        for (let i = 0; i < nW; i++) w[i] = clampW(this.rng.normal() * P.initSd);
        this.pop.push(w);
      }
    } else {
      const carried = Float64Array.from(genome.w);
      this.pop.push(carried);
      for (let p = 1; p < P.population; p++) this.pop.push(this.mutate(carried, this.sigma()));
    }
    this.champ = Float64Array.from(this.pop[0]);
    this.gen = 0;
    this.finished = false;
  }

  private sigma(): number {
    const env = this.need();
    const f = Math.min(1, env.used / env.budget);
    return P.sigmaStart + (P.sigmaEnd - P.sigmaStart) * f;
  }

  private mutate(parent: Float64Array, sigma: number): Float64Array {
    const w = Float64Array.from(parent);
    for (let i = 0; i < w.length; i++) {
      const u = this.rng.next();
      if (u < P.pReset) w[i] = clampW(this.rng.normal() * P.resetSd);
      else if (u < P.pReset + P.pMutate) w[i] = clampW(w[i] + this.rng.normal() * sigma);
    }
    return w;
  }

  private need(): Env {
    if (!this.env) throw new Error('neuroevo: step before init');
    return this.env;
  }

  done(): boolean { return this.finished; }

  async step(tickAllowance: number): Promise<TrainerEvent[]> {
    const env = this.need();
    const events: TrainerEvent[] = [];
    let spent = 0;
    const worst = env.worstCase(P.population);
    while (!this.finished) {
      if (worst > env.remaining()) {
        this.finished = true;
        events.push({ type: 'done', ticksUsed: env.used, generations: this.gen });
        break;
      }
      if (spent + worst > tickAllowance) break;
      const before = env.used;
      const res = await env.runEpisodes(this.pop);
      spent += env.used - before;
      const fit = res.map((row) => {
        let s = 0;
        for (const r of row) s += r.prog - P.wallPenalty * r.wallTicks;
        return s / row.length;
      });
      const rank = fit.map((_, i) => i).sort((a, b) => (fit[b] - fit[a]) || (a - b));
      let mean = 0;
      for (const f of fit) mean += f;
      mean /= fit.length;
      this.gen++;
      this.champ = Float64Array.from(this.pop[rank[0]]);
      events.push({
        type: 'generation', gen: this.gen, best: fit[rank[0]], mean, champion: rank[0],
        championW: Float64Array.from(this.champ), ticksUsed: env.used,
      });
      // next generation: elites unchanged, the rest tournament-selected mutants
      const sigma = this.sigma();
      const next: Float64Array[] = [];
      for (let e = 0; e < P.elites; e++) next.push(Float64Array.from(this.pop[rank[e]]));
      while (next.length < P.population) {
        let best = this.rng.int(P.population);
        for (let k = 1; k < P.tournament; k++) {
          const c = this.rng.int(P.population);
          if (fit[c] > fit[best] || (fit[c] === fit[best] && c < best)) best = c;
        }
        next.push(this.mutate(this.pop[best], sigma));
      }
      this.pop = next;
    }
    return events;
  }

  weights(): Genome {
    const g = this.genome;
    if (!g) throw new Error('neuroevo: weights before init');
    return { spec: g.spec, w: Array.from(this.champ) };
  }

  /** signal = sender output × weight for the champion's first tick on training track 0 (no car-tick is spent). */
  probe(): ProbeFrame {
    const env = this.need();
    const g = this.weights();
    const net = compile(g);
    const t = env.track(0);
    const c = startCar(t);
    const inputs = new Float64Array(10), vals = new Float64Array(net.nNodes);
    readSensors(c, t, net.inUsed, env.setup.budget, inputs);
    evalNet(net, inputs, vals, 0, 0, 0);
    const signal = new Float64Array(g.spec.conns.length);
    for (let k = 0; k < net.w.length; k++) signal[net.specIdx[k]] = vals[net.from[k]] * net.w[k];
    return { channels: { signal } };
  }

  /** For tests: hash of the current champion. */
  championHash(): string { return genomeHash(this.weights()); }
}

registerTrainer('evolution', (o) => new Neuroevo(o));
