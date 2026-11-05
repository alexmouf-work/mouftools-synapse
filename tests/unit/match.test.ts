// vs CPU races (B7, tracks plan §4): the grid, pads off it, the ranking rule, determinism, the wrong-way reset, the
// stored CPU brains.
import { describe, expect, it } from 'vitest';
import data from '../../src/assets/cpu/brains.json';
import { CONFIG } from '../../src/common/config';
import { compile, defaultGenome } from '../../src/common/sim/brain';
import { newRecording, putBack, Runner } from '../../src/common/sim/race';
import { biasIndex, OUTPUTS, type Genome } from '../../src/common/sim/spec';
import { CPU_NAMES, cpuRounds } from '../../src/common/sim/cpu';
import { maxLoad } from '../../src/common/sim/energy';
import { gridCar, gridOrder, gridPlace, rank, raceTrackSeed, ROUND_RACE, runRace } from '../../src/common/sim/match';
import { generateTrack, gridDepth } from '../../src/common/sim/track';

const M = CONFIG.match;

describe('the grid', () => {
  it('rows of two 8 m apart behind the line, 2.5 m either side, facing along the track', () => {
    const t = generateTrack(raceTrackSeed(3), M.cars);
    for (let s = 0; s < M.cars; s++) {
      const c = gridCar(t, s), p = gridPlace(t, s), row = Math.floor(s / 2);
      expect(Math.abs(-c.prog - (M.firstRow + row * M.rowGap))).toBeLessThan(t.ds / 2 + 1e-9);
      expect(c.prog).toBe(-p.back);
      expect(c.off).toBe(s % 2 === 0 ? M.across : -M.across);
      // the offset is really across the road: distance to the centreline sample = 2.5 m
      expect(Math.hypot(c.x - t.px[c.idx], c.y - t.py[c.idx])).toBeCloseTo(M.across, 9);
      expect(c.hdg).toBe(t.th[c.idx]);
      if (s >= 2) expect(gridPlace(t, s - 2).back).toBeLessThan(p.back);
    }
  });
  it('slot order is a seeded shuffle of the race seed', () => {
    const a = gridOrder(5, M.cars);
    expect([...a].sort((x, y) => x - y)).toEqual([...Array(M.cars).keys()]);
    expect(gridOrder(5, M.cars)).toEqual(a);
    expect(gridOrder(6, M.cars)).not.toEqual(a);
  });
  it('no boost pad on the whole grid (for the number of cars, up to 100) or in the first 50 m on any race track', () => {
    expect(gridDepth(10)).toBe(36);
    expect(gridDepth(100)).toBe(396);
    for (const cars of [2, 10, 37, 100]) {
      for (let s = 1; s <= (cars === 100 ? 200 : 60); s++) {
        const t = generateTrack(raceTrackSeed(s), cars);
        const back = gridPlace(t, cars - 1).back; // the back row as placed (rounded to samples)
        expect(back).toBeLessThan(gridDepth(cars) + M.clearPast);
        for (const p of t.pads) for (let j = 0; j < p.n; j++) {
          const d = ((p.i0 + j - t.startIdx) % t.n + t.n) % t.n;
          expect(d * t.ds > M.clearAhead && (t.n - d) * t.ds > gridDepth(cars) + M.clearPast).toBe(true);
        }
      }
    }
  });
});

describe('ranking', () => {
  it('finish time, then progress at the cap, then grid slot', () => {
    const cars = [
      { slot: 3, finish: null, prog: 2000 }, { slot: 1, finish: 1500.25, prog: 3500 }, { slot: 0, finish: 1500.25, prog: 3400 },
      { slot: 2, finish: 1499, prog: 3300 }, { slot: 4, finish: null, prog: 2500 }, { slot: 5, finish: null, prog: 2500 },
    ];
    expect(rank(cars)).toEqual([3, 2, 1, 4, 5, 0]);
  });
});

describe('a race', () => {
  const cpu = cpuRounds(data)[4];
  const genomes = [defaultGenome(), ...cpu.map((b) => b.genome)];
  it('is deterministic and keeps every car independent of the others', () => {
    const a = runRace(genomes, 42, (k) => k === 0), b = runRace(genomes, 42);
    expect(a.hash).toBe(b.hash);
    expect(a.cars[0].rec.act.length).toBeGreaterThan(0);
    expect(b.cars[0].rec.act.length).toBe(0);
    // car 5 alone from its slot drives exactly the same: the other cars change nothing
    const net = compile(genomes[5]), rec = newRecording(net, M.capTicks, false);
    new Runner().run(net, a.track, { ticks: M.capTicks, earlyStop: false, record: rec, start: gridCar(a.track, a.cars[5].slot), wrongWay: true });
    expect(Array.from(rec.x)).toEqual(Array.from(a.cars[5].rec.x));
    expect(a.cars[5].rec.ticks).toBe(M.capTicks);
    expect(a.ranking.length).toBe(M.cars);
    expect(runRace(genomes, 43).hash).not.toBe(a.hash);
  });
  it('finish times come from where each car crossed the line after 2 laps; the race ends with the last finisher or at the cap', () => {
    for (const seed of [1, 2, 3]) {
      const r = runRace(genomes, seed), goal = M.laps * r.track.len;
      for (const c of r.cars) {
        if (c.finish === null) { expect(c.rec.prog.slice(0, M.capTicks).every((p) => p < goal)).toBe(true); continue; }
        const j = Math.floor(c.finish);
        expect(c.rec.prog[j]).toBeGreaterThanOrEqual(goal);
        if (j > 0) expect(c.rec.prog[j - 1]).toBeLessThan(goal);
      }
      const fin = r.cars.filter((c) => c.finish !== null);
      expect(r.endTicks).toBe(fin.length === r.cars.length ? Math.ceil(Math.max(...fin.map((c) => c.finish as number))) : M.capTicks);
      expect(r.cars.every((c) => Number.isFinite(c.prog))).toBe(true);
    }
  });
});

/** A brain that drives backwards: every wheel's bias at the cap (tanh(−4) ≈ −1), nothing else. */
function backwards(): Genome {
  const g = defaultGenome();
  for (const o of OUTPUTS) g.w[biasIndex(g.spec, o.id)] = -CONFIG.brain.weightCap;
  return g;
}

describe('the wrong-way reset (races only)', () => {
  const W = M.wrongWayTicks;
  it('a car whose progress has fallen for 60 ticks is put back at its furthest point, on the centre line, facing forwards, at rest', () => {
    const r = runRace([backwards(), defaultGenome()], 9), c = r.cars[0], rec = c.rec, t = r.track, start = -gridPlace(t, c.slot).back;
    const resets: number[] = [];
    for (let k = 0; k < rec.ticks; k++) if (rec.wrong[k] >= W) resets.push(k);
    expect(resets.length).toBeGreaterThan(10);
    let best = start;
    for (let k = 0, prev = start, fell = 0; k < rec.ticks; k++) {
      const p = rec.prog[k];
      // the count is the rule: ticks in a row of falling progress, put back on the 60th
      fell = p < prev || rec.wrong[k] >= W ? fell + 1 : 0;
      expect(rec.wrong[k]).toBe(fell);
      if (rec.wrong[k] >= W) {
        fell = 0;
        // put back: at rest, on the centreline sample at or just behind its best point, facing along the track
        const a = ((t.startIdx * t.ds + best) % t.len + t.len) % t.len, i = Math.min(Math.floor(a / t.ds), t.n - 1);
        expect(rec.v[k]).toBe(0);
        expect(rec.x[k]).toBe(t.px[i]);
        expect(rec.y[k]).toBe(t.py[i]);
        expect(rec.hdg[k]).toBe(t.th[i]);
        expect(p).toBeLessThanOrEqual(best);
        expect(best - p).toBeLessThan(t.ds + 1e-9);
      }
      if (p > best) best = p;
      prev = p;
    }
    // it never gets more than about 3 s of reversing behind the grid: no more kilometres backwards
    for (let k = 0; k < rec.ticks; k++) expect(rec.prog[k]).toBeGreaterThan(start - W / CONFIG.tick.hz * CONFIG.car.wheelSpeed);
    expect(Number.isFinite(c.prog)).toBe(true);
  });
  it('training and the drive view are unchanged: no reset unless a race asks for it', () => {
    const t = generateTrack(raceTrackSeed(9), M.cars), net = compile(backwards()), rec = newRecording(net, 400, false);
    const res = new Runner().run(net, t, { ticks: 400, earlyStop: false, record: rec });
    expect(res.prog).toBeLessThan(-100);
    expect(rec.wrong.every((w) => w === 0)).toBe(true);
  });
  it('putBack keeps progress and position one', () => {
    const t = generateTrack(raceTrackSeed(4), M.cars), c = gridCar(t, 3);
    c.maxProg = 777.7; c.prog = 700; c.v = -12;
    putBack(c, t);
    expect(c.v).toBe(0);
    expect(c.off).toBe(0);
    expect(c.prog).toBeLessThanOrEqual(777.7);
    expect(777.7 - c.prog).toBeLessThan(t.ds);
    expect(((t.startIdx * t.ds + c.prog) % t.len + t.len) % t.len).toBeCloseTo(c.idx * t.ds, 6);
  });
  it('is deterministic: the same race gives the same bits', () => {
    const g = [backwards(), ...cpuRounds(data)[4].map((b) => b.genome)];
    expect(runRace(g, 77).hash).toBe(runRace(g, 77).hash);
  });
  it('a round\'s timed race: 30 s, no finishers, ranked by the signed distance covered from each grid slot', () => {
    const g = [backwards(), ...cpuRounds(data)[0].map((b) => b.genome)], r = runRace(g, 5, undefined, ROUND_RACE);
    expect(r.endTicks).toBe(CONFIG.rounds.raceTicks);
    for (const c of r.cars) {
      expect(c.finish).toBeNull();
      expect(c.rec.ticks).toBe(CONFIG.rounds.raceTicks);
      expect(c.dist).toBeCloseTo(c.rec.prog[CONFIG.rounds.raceTicks - 1] + gridPlace(r.track, c.slot).back, 9);
    }
    for (let i = 1; i < r.ranking.length; i++) expect(r.cars[r.ranking[i - 1]].dist).toBeGreaterThanOrEqual(r.cars[r.ranking[i]].dist);
    // backwards counts against you: below its grid spot while going backwards (the wrong-way reset puts it back), never ahead
    const c0 = r.cars[0], back0 = gridPlace(r.track, c0.slot).back;
    expect(Math.min(...c0.rec.prog.slice(0, c0.rec.ticks)) + back0).toBeLessThan(0);
    expect(c0.dist).toBeLessThanOrEqual(0);
    expect(runRace(g, 5, undefined, ROUND_RACE).hash).toBe(r.hash);
  });
});

describe('the CPU brains', () => {
  it('five rounds of nine, named, each within its round\'s budget, trained on 5% to 100% of T, growing round to round', () => {
    const rounds = cpuRounds(data);
    expect(rounds.length).toBe(CONFIG.rounds.count);
    rounds.forEach((b, r) => {
      expect(b.map((x) => x.name)).toEqual([...CPU_NAMES]);
      for (const x of b) expect(maxLoad(x.genome.spec)).toBeLessThanOrEqual(CONFIG.rounds.budgets[r] + 1e-9);
      expect(b[0].budget).toBe(Math.round(0.05 * CONFIG.train.T));
      expect(b[8].budget).toBe(CONFIG.train.T);
    });
    // each player's design only grows: every later round has at least the cells it had
    for (let k = 0; k < CPU_NAMES.length; k++) for (let r = 1; r < rounds.length; r++) {
      const a = rounds[r - 1][k].genome.spec, c = rounds[r][k].genome.spec;
      expect(c.layers.length).toBe(a.layers.length);
      a.layers.forEach((l, L) => expect(c.layers[L].n).toBeGreaterThanOrEqual(l.n));
      for (const id of Object.keys(a.senses) as (keyof typeof a.senses)[]) expect(c.senses[id]).toBeGreaterThanOrEqual(a.senses[id]);
    }
  });
});
