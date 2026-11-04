// Contract every trainer must pass (solo-loop plan step 1): spends within budget, same seed → same hash, weights()
// keeps the architecture, ticks monotonic, declared channels present. Runs for every registered trainer.
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { genomeHash, specHash, starterSpec } from '../sim/brain';
import { InlineExecutor, type EpisodeSetup } from './episodes';
import { MeteredEnv } from './env';
import { phaseSeeds, runPhase } from './phase';
import { createTrainer, trainerIds, type TrainerEvent } from './trainer';
import './neuroevo';
import './backprop';

const T = 700_000; // small phase: a few generations (one is 64 × 2 × 1200 ticks at worst)
const spec = starterSpec();

async function makeEnv(seed: number, budgetT = T) {
  const s = phaseSeeds(seed);
  const setup: EpisodeSetup = { spec, trackSeeds: s.trainTracks, noiseSeeds: s.trainNoise, pool: CONFIG.budget[0] * CONFIG.train.episodeTicks, episodeTicks: CONFIG.train.episodeTicks };
  const exec = new InlineExecutor();
  await exec.setup(setup);
  return new MeteredEnv(setup, exec, budgetT);
}

describe.each(trainerIds())('trainer contract: %s', (id) => {
  it('spends within the budget, ticks monotonic, leaves less than one more unit of work', async () => {
    const env = await makeEnv(3);
    const tr = createTrainer(id, { start: 'fresh' });
    tr.init({ spec, w: spec.conns.map(() => 0) }, 3, env);
    const events: TrainerEvent[] = [];
    let last = 0;
    while (!tr.done()) {
      const before = env.used;
      const ev = await tr.step(200_000);
      expect(env.used - before).toBeLessThanOrEqual(200_000);
      for (const e of ev) { expect(e.ticksUsed).toBeGreaterThanOrEqual(last); last = e.ticksUsed; }
      events.push(...ev);
    }
    expect(env.used).toBeLessThanOrEqual(T);
    expect(env.used).toBeGreaterThan(0);
    const done = events.filter((e) => e.type === 'done');
    expect(done.length).toBe(1);
    expect(done[0].ticksUsed).toBe(env.used);
    if (id === 'evolution') expect(env.remaining()).toBeLessThan(env.worstCase(CONFIG.train.population));
    else expect(env.remaining()).toBeLessThan(CONFIG.train.grad.lanes * CONFIG.train.grad.roundTicks + env.worstCase(1)); // a round + the final check
    const after = env.used;
    expect(await tr.step(Infinity)).toEqual([]);
    expect(env.used).toBe(after);
  });

  it('same seed → same hash; another seed → another', async () => {
    const a = await runPhase(new InlineExecutor(), spec, 5, { trainer: id, T });
    const b = await runPhase(new InlineExecutor(), spec, 5, { trainer: id, T });
    const c = await runPhase(new InlineExecutor(), spec, 6, { trainer: id, T });
    expect(b.hash).toBe(a.hash);
    expect(c.hash).not.toBe(a.hash);
  });

  it('weights() keeps the architecture; declared channels are present', async () => {
    const env = await makeEnv(4);
    const tr = createTrainer(id, { start: 'fresh' });
    tr.init({ spec, w: spec.conns.map(() => 0) }, 4, env);
    await tr.step(Infinity);
    const g = tr.weights();
    expect(specHash(g.spec)).toBe(specHash(spec));
    expect(g.w.length).toBe(spec.conns.length);
    const p = tr.probe();
    expect(tr.channels).toContain('signal');
    for (const ch of tr.channels) {
      const v = p.channels[ch];
      expect(v, `channel ${ch}`).toBeDefined();
      expect(v!.length).toBe(spec.conns.length);
      for (const x of v!) expect(Number.isFinite(x)).toBe(true);
    }
  });

  it('carry: the carried genome is in the first generation exactly (its fitness is matched or beaten)', async () => {
    const a = await runPhase(new InlineExecutor(), spec, 7, { trainer: id, T });
    const b = await runPhase(new InlineExecutor(), spec, 7, { trainer: id, T, start: 'carry', genome: a.final });
    expect(b.gens[0].best).toBeGreaterThanOrEqual(a.gens[a.gens.length - 1].best);
    expect(genomeHash(b.final)).not.toBe('');
  });
});

describe('metered env', () => {
  it('throws on a request that could overrun, before running it', async () => {
    const env = await makeEnv(2, 1000);
    // 2 policies × 2 tracks × 400 ticks = 1600 > 1000
    await expect(env.runEpisodes([new Float64Array(spec.conns.length), new Float64Array(spec.conns.length)])).rejects.toThrow(/overruns/);
    expect(env.used).toBe(0);
  });
  it('openCar meters one tick per step and applies exploration noise to the wheels', async () => {
    const env = await makeEnv(2, 3);
    const car = env.openCar(spec.conns.map(() => 0), 0);
    car.step([1, 1, 1, 1]);
    expect(car.state.v).toBeGreaterThan(0); // zero brain, but the noise pushed every wheel forward
    car.step(); car.step();
    expect(env.used).toBe(3);
    expect(() => car.step()).toThrow(/overruns/);
  });
});
