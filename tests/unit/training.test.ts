import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/common/config';
import { defaultSpec, paramCount } from '../../src/common/sim/spec';
import { EpisodeCore, InlineExecutor, PATH_STRIDE, pathSamples } from '../../src/common/train/episodes';
import { phaseSeeds, runPhase } from '../../src/common/train/phase';
import { Rng } from '../../src/common/rng';
import { compile, genomeHash } from '../../src/common/sim/brain';
import { newRecording, Runner } from '../../src/common/sim/race';

const T = 700_000; // a few generations of 60 s episodes

describe('training view plumbing', () => {
  it('recording track-0 paths changes no result', () => {
    const s = phaseSeeds(3), spec = defaultSpec();
    const core = new EpisodeCore({ spec, trackSeeds: s.trainTracks, episodeTicks: CONFIG.train.episodeTicks });
    const r = new Rng(1), n = 6, w = new Float64Array(n * paramCount(spec)).map(() => r.normal());
    const all = Array.from({ length: n }, (_, i) => i);
    const a = core.run(w, n), b = core.run(w, n, all), c = core.run(w, n);
    expect(Array.from(b.out)).toEqual(Array.from(a.out));
    expect(Array.from(c.out)).toEqual(Array.from(a.out));
    expect(a.paths).toBeNull();
    const p = b.paths!;
    expect(p.count).toBe(n);
    expect(Array.from(p.w)).toEqual(Array.from(w)); // the recorded agents' weights, for the live brain
    // a handful, recorded across a block boundary (as a pool splits it), gives the same paths as recording them all
    const nW = paramCount(spec), some = [1, 4];
    const lo = core.run(w.slice(0, 3 * nW), 3, some, 0).paths!, hi = core.run(w.slice(3 * nW), n - 3, some, 3).paths!;
    expect([...lo.ids, ...hi.ids]).toEqual(some);
    expect(Array.from(lo.data)).toEqual(Array.from(p.data.subarray(1 * p.samples * PATH_STRIDE, 2 * p.samples * PATH_STRIDE)));
    expect(Array.from(hi.w)).toEqual(Array.from(w.subarray(4 * nW, 5 * nW)));
    expect(p.samples).toBe(pathSamples(CONFIG.train.episodeTicks));
    // the highlighted car is the furthest along track 0, and its recorded firing is exactly its replay
    const progs = Array.from({ length: n }, (_, k) => a.out[k * 2 * 3]);
    expect(p.hl).toBe(progs.indexOf(Math.max(...progs)));
    const net = compile({ spec, w: Array.from(w.subarray(p.hl * nW, (p.hl + 1) * nW)) }), rec = newRecording(net, CONFIG.train.episodeTicks);
    new Runner().run(net, core.tracks[0], { ticks: CONFIG.train.episodeTicks, earlyStop: true, record: rec });
    expect(Array.from(p.act)).toEqual(Array.from(rec.act.subarray(0, rec.ticks * net.nNodes)));
    for (let k = 0; k < n; k++) {
      expect(p.ticks[k]).toBe(a.out[k * 2 * 3 + 2]); // track-0 ticks match the results
      const used = Math.ceil(p.ticks[k] / 2);
      for (let j = 0; j < used; j++) for (let q = 0; q < PATH_STRIDE; q++) expect(Number.isFinite(p.data[(k * p.samples + j) * PATH_STRIDE + q])).toBe(true);
    }
  });
  it('stepping one generation at a time (with paths recorded) gives the same hash as one big step', async () => {
    const a = await runPhase(new InlineExecutor(), defaultSpec(), 9, { T });
    const ex = new InlineExecutor();
    let events = 0;
    const b = await runPhase(ex, defaultSpec(), 9, {
      T, stepTicks: (env) => env.worstCase(CONFIG.train.population), beforeStep: () => { ex.record = (count) => [0, 5, count - 1]; }, onEvent: () => { events++; },
    });
    expect(b.hash).toBe(a.hash);
    expect(events).toBe(a.gens.length + 1); // every generation plus done
    expect(ex.lastPaths?.count).toBe(3);
    expect(Array.from(ex.lastPaths!.ids)).toEqual([0, 5, CONFIG.train.population - 1]);
  });
  it('a retrain (phase 1) draws new tracks and a new trainer stream; phase 0 keeps the S1 stream', () => {
    const p0 = phaseSeeds(5, 0), p1 = phaseSeeds(5, 1);
    expect(p0.trainer).toBe(5);
    expect(p1.trainer).not.toBe(5);
    expect(p1.trainTracks).not.toEqual(p0.trainTracks);
  });
  it('stop() ends a phase early and says so', async () => {
    let n = 0;
    const r = await runPhase(new InlineExecutor(), defaultSpec(), 2, { T, stop: () => ++n > 3, stepTicks: (env) => env.worstCase(CONFIG.train.population) });
    expect(r.stopped).toBe(true);
    expect(r.gens.length).toBe(3);
  });
  it('Stop is the generation limit reached there: the same brain as a run asked for that many generations', async () => {
    // B6 (2026-11-04): "stopping the training should be functionally equivalent to hitting the limit on the number of
    // generations" and "we take the best performing agent that was discovered so far"
    const one = (env: { worstCase(n: number): number }) => env.worstCase(CONFIG.train.population);
    let n = 0;
    const stopped = await runPhase(new InlineExecutor(), defaultSpec(), 4, { T: 2_000_000, generations: 10, stepTicks: one, stop: () => ++n > 3 });
    const limit = await runPhase(new InlineExecutor(), defaultSpec(), 4, { T: 2_000_000, generations: 3 });
    expect(stopped.stopped).toBe(true);
    expect(stopped.gens.map((g) => g.best)).toEqual(limit.gens.map((g) => g.best));
    expect(genomeHash(stopped.final)).toBe(genomeHash(limit.final));
    const best = stopped.gens.reduce((b, g) => (g.best > b.best ? g : b));
    expect(stopped.final.w).toEqual(Array.from(best.champion)); // the best agent evaluated so far
    // stopped before any generation: the starting brain, unchanged
    const none = await runPhase(new InlineExecutor(), defaultSpec(), 4, { T, stop: () => true });
    expect(none.final.w.every((x) => x === 0)).toBe(true);
  });
  it('a step that fails because Stop aborted the pool drops that generation; any other failure still throws', async () => {
    let calls = 0, stop = false;
    const ex = new InlineExecutor();
    const run = ex.run.bind(ex);
    ex.run = async (w, c) => { if (++calls === 3) { stop = true; const e = new Error('aborted'); e.name = 'AbortError'; throw e; } return run(w, c); };
    const r = await runPhase(ex, defaultSpec(), 4, { T, stop: () => stop, stepTicks: (env) => env.worstCase(CONFIG.train.population) });
    expect(r.stopped).toBe(true);
    expect(r.gens.length).toBe(2);
    // Stop while the workers are still setting up: stopped, nothing evaluated, the brain as it was
    const ex3 = new InlineExecutor();
    let stop3 = false;
    ex3.setup = async () => { stop3 = true; const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
    const r3 = await runPhase(ex3, defaultSpec(), 4, { T, stop: () => stop3 });
    expect(r3.stopped).toBe(true);
    expect(r3.gens.length).toBe(0);
    const ex2 = new InlineExecutor();
    ex2.run = async () => { throw new Error('boom'); };
    await expect(runPhase(ex2, defaultSpec(), 4, { T })).rejects.toThrow('boom');
  });
});
