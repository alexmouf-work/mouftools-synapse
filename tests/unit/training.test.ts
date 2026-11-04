import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/common/config';
import { defaultSpec, paramCount } from '../../src/common/sim/spec';
import { EpisodeCore, InlineExecutor, PATH_STRIDE, pathSamples } from '../../src/common/train/episodes';
import { phaseSeeds, runPhase } from '../../src/common/train/phase';
import { Rng } from '../../src/common/rng';

const T = 700_000; // a few generations of 60 s episodes

describe('training view plumbing', () => {
  it('recording track-0 paths changes no result', () => {
    const s = phaseSeeds(3), spec = defaultSpec();
    const core = new EpisodeCore({ spec, trackSeeds: s.trainTracks, episodeTicks: CONFIG.train.episodeTicks });
    const r = new Rng(1), n = 6, w = new Float64Array(n * paramCount(spec)).map(() => r.normal());
    const a = core.run(w, n, false), b = core.run(w, n, true), c = core.run(w, n, false);
    expect(Array.from(b.out)).toEqual(Array.from(a.out));
    expect(Array.from(c.out)).toEqual(Array.from(a.out));
    expect(a.paths).toBeNull();
    const p = b.paths!;
    expect(p.count).toBe(n);
    expect(p.samples).toBe(pathSamples(CONFIG.train.episodeTicks));
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
      T, stepTicks: (env) => env.worstCase(CONFIG.train.population), beforeStep: () => { ex.record = true; }, onEvent: () => { events++; },
    });
    expect(b.hash).toBe(a.hash);
    expect(events).toBe(a.gens.length + 1); // every generation plus done
    expect(ex.lastPaths?.count).toBe(CONFIG.train.population);
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
});
