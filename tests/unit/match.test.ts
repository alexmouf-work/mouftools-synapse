// vs CPU races (B7, tracks plan §4): the grid, pads off it, the ranking rule, determinism, the stored CPU brains.
import { describe, expect, it } from 'vitest';
import data from '../../src/assets/cpu/brains.json';
import { CONFIG } from '../../src/common/config';
import { compile, defaultGenome } from '../../src/common/sim/brain';
import { newRecording, Runner } from '../../src/common/sim/race';
import { CPU_NAMES, cpuBrains } from '../../src/common/sim/cpu';
import { maxLoad } from '../../src/common/sim/energy';
import { gridCar, gridOrder, gridPlace, rank, raceTrackSeed, runRace } from '../../src/common/sim/match';
import { generateTrack } from '../../src/common/sim/track';

const M = CONFIG.match;

describe('the grid', () => {
  it('rows of two 8 m apart behind the line, 2.5 m either side, facing along the track', () => {
    const t = generateTrack(raceTrackSeed(3), true);
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
  it('no boost pad on the grid or in the first 50 m on any race track', () => {
    for (let s = 1; s <= 200; s++) {
      const t = generateTrack(raceTrackSeed(s), true);
      for (const p of t.pads) for (let j = 0; j < p.n; j++) {
        const d = ((p.i0 + j - t.startIdx) % t.n + t.n) % t.n;
        expect(d * t.ds > M.clearAhead && (t.n - d) * t.ds > M.clearBehind).toBe(true);
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
  const cpu = cpuBrains(data);
  const genomes = [defaultGenome(), ...cpu.map((b) => b.genome)];
  it('is deterministic and keeps every car independent of the others', () => {
    const a = runRace(genomes, 42, (k) => k === 0), b = runRace(genomes, 42);
    expect(a.hash).toBe(b.hash);
    expect(a.cars[0].rec.act.length).toBeGreaterThan(0);
    expect(b.cars[0].rec.act.length).toBe(0);
    // car 5 alone from its slot drives exactly the same: the other cars change nothing
    const net = compile(genomes[5]), rec = newRecording(net, M.capTicks, false);
    new Runner().run(net, a.track, { ticks: M.capTicks, earlyStop: false, record: rec, start: gridCar(a.track, a.cars[5].slot) });
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

describe('the CPU brains', () => {
  it('nine, named, each one a design a player could race, trained on budgets from 5% to 100% of T', () => {
    const b = cpuBrains(data);
    expect(b.map((x) => x.name)).toEqual([...CPU_NAMES]);
    for (const x of b) expect(maxLoad(x.genome.spec)).toBeLessThanOrEqual(100);
    expect(b[0].budget).toBe(Math.round(0.05 * CONFIG.train.T));
    expect(b[8].budget).toBe(CONFIG.train.T);
    expect(b.some((x) => x.design.startsWith('starter:')) && b.some((x) => !x.design.startsWith('starter:'))).toBe(true);
  });
});
