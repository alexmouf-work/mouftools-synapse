// Contract every trainer must pass (solo-loop plan step 1): spends within budget, same seed → same hash, weights()
// keeps the architecture, ticks monotonic, declared channels present. contract.test.ts runs it for evolution and
// backprop, contract-ac.test.ts and contract-arp.test.ts for actor-critic and A_RP (so no file keeps a test worker busy for a
// minute).
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { genomeHash, specHash, zeroGenome } from '../sim/brain';
import { defaultSpec, paramCount } from '../sim/spec';
import { InlineExecutor, type EpisodeSetup } from './episodes';
import { MeteredEnv } from './env';
import { phaseSeeds, runPhase } from './phase';
import { createTrainer, trainerIds, type TrainerEvent } from './trainer';

const T = 700_000; // small phase: a few generations (one is 64 × 2 × 1200 ticks at worst)
const spec = defaultSpec();
const nW = paramCount(spec);

export async function makeEnv(seed: number, budgetT = T) {
  const s = phaseSeeds(seed);
  const setup: EpisodeSetup = { spec, trackSeeds: s.trainTracks, episodeTicks: CONFIG.train.episodeTicks };
  const exec = new InlineExecutor();
  await exec.setup(setup);
  return new MeteredEnv(setup, exec, budgetT);
}

/** The contract, for each of `ids` (each must be registered). */
export function contractSuite(ids: string[]): void {
  for (const id of ids) if (!trainerIds().includes(id)) throw new Error(`contract: ${id} is not registered`);
  describe.each(ids)('trainer contract: %s', (id) => {
    it('spends within the budget, ticks monotonic, leaves less than one more unit of work', async () => {
      const env = await makeEnv(3);
      const tr = createTrainer(id, { start: 'fresh' });
      tr.init(zeroGenome(spec), 3, env);
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
      tr.init(zeroGenome(spec), 4, env);
      await tr.step(Infinity);
      const g = tr.weights();
      expect(specHash(g.spec)).toBe(specHash(spec));
      expect(g.w.length).toBe(nW);
      const p = tr.probe();
      expect(tr.channels).toContain('signal');
      for (const ch of tr.channels) {
        const v = p.channels[ch];
        expect(v, `channel ${ch}`).toBeDefined();
        expect(v!.length).toBe(nW);
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
}
