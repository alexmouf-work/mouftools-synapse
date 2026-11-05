// A race between brains (vs CPU now, Multiplayer next; tracks plan §4 and the coordinator's vs CPU calls of
// 2026-11-05): one race seed draws the track (any family, no boost pad on the whole grid for the race's number of cars
// or in the first 50 m) and the grid order; every car starts in its slot, two by two behind the line, and drives 2
// laps, capped at 120 s. A car whose progress has fallen for 3 s is put back at its furthest point, facing forwards
// (the wrong-way reset, race.ts putBack). Cars pass through each other, so each car is its own deterministic run
// (Runner) and every client that re-runs a race gets the same bits. Ranking: finish time (to a fraction of a tick, from where the car crossed the line), then progress at the
// cap, then grid slot.
import { CONFIG } from '../config';
import { Hasher } from '../hash';
import { derive, Rng, TAG } from '../rng';
import { compile } from './brain';
import { newRecording, Runner, type Recording } from './race';
import type { CarState } from './car';
import type { Genome } from './spec';
import { generateTrack, type Track } from './track';

const M = CONFIG.match;

/** The race's track seed (a race track: generateTrack(seed, cars)). */
export const raceTrackSeed = (raceSeed: number): number => derive(raceSeed >>> 0, TAG.raceTrack);

/** Grid slot of each car (car k starts in slot order[k]; slot 0 is pole), a seeded shuffle of the race seed. */
export function gridOrder(raceSeed: number, cars: number): number[] {
  const r = new Rng(derive(raceSeed >>> 0, TAG.grid)), slots = Array.from({ length: cars }, (_, i) => i);
  for (let i = cars - 1; i > 0; i--) { const j = r.int(i + 1); const x = slots[i]; slots[i] = slots[j]; slots[j] = x; }
  return slots;
}

/**
 * Where slot s sits: rows of two, the front row firstRow m behind the line and each next row rowGap further back
 * (rounded to whole samples), the even slots on the left of the centreline and the odd on the right, across m out.
 */
export function gridPlace(t: Track, slot: number): { i: number; back: number; side: number } {
  const row = Math.floor(slot / 2), steps = Math.round((M.firstRow + row * M.rowGap) / t.ds);
  return { i: (t.startIdx - steps + t.n * 4) % t.n, back: steps * t.ds, side: slot % 2 === 0 ? M.across : -M.across };
}

/** A car at rest in grid slot s, facing along the track; its progress counts from the line (negative behind it). */
export function gridCar(t: Track, slot: number): CarState {
  const { i, back, side } = gridPlace(t, slot);
  return {
    x: t.px[i] - t.ty[i] * side, y: t.py[i] + t.tx[i] * side, hdg: t.th[i], v: 0, idx: i, s: i * t.ds, off: side,
    prog: -back, maxProg: -back, wallTicks: 0, load: 0, cap: 1, tick: 0, padLap: t.pads.map(() => -0x7fffffff),
  };
}

export interface RaceCar {
  slot: number;
  rec: Recording;
  /** Finish time in ticks from Go (fractional: where it crossed the line within its tick), or null if it didn't finish. */
  finish: number | null;
  /** Progress when the race ended (m from the line). */
  prog: number;
}

export interface RaceResult {
  raceSeed: number;
  track: Track;
  cars: RaceCar[];
  /** Car indices from first to last. */
  ranking: number[];
  /** Ticks the race lasted: when the last car finished, else the cap. */
  endTicks: number;
  hash: string;
}

/** The ranking rule: finished cars by finish time, then the rest by progress at the end, then by grid slot. */
export function rank(cars: readonly Pick<RaceCar, 'slot' | 'finish' | 'prog'>[]): number[] {
  return cars.map((_, k) => k).sort((a, b) => {
    const A = cars[a], B = cars[b];
    if (A.finish !== null && B.finish !== null) return A.finish - B.finish || A.slot - B.slot;
    if (A.finish !== null) return -1;
    if (B.finish !== null) return 1;
    return B.prog - A.prog || A.slot - B.slot;
  });
}

/**
 * Run a race: car k is genomes[k]. `act(k)` says which cars keep every node's output per tick (the player's, for its
 * live brain); the rest record frames only. Every car has the wrong-way reset. Every car drives the whole cap (after the flag it carries on, as on a
 * cool-down lap), so a race's recordings never depend on the other cars.
 */
export function runRace(genomes: readonly Genome[], raceSeed: number, act: (k: number) => boolean = () => false): RaceResult {
  const track = generateTrack(raceTrackSeed(raceSeed), genomes.length), order = gridOrder(raceSeed, genomes.length);
  const goal = M.laps * track.len, runner = new Runner();
  const cars: RaceCar[] = genomes.map((g, k) => {
    const net = compile(g), rec = newRecording(net, M.capTicks, act(k));
    runner.run(net, track, { ticks: M.capTicks, earlyStop: false, record: rec, start: gridCar(track, order[k]), wrongWay: true });
    let finish: number | null = null;
    for (let j = 0, prev = -gridPlace(track, order[k]).back; j < rec.ticks; prev = rec.prog[j], j++) {
      if (rec.prog[j] >= goal) { finish = j + (goal - prev) / (rec.prog[j] - prev); break; }
    }
    return { slot: order[k], rec, finish, prog: 0 };
  });
  const all = cars.every((c) => c.finish !== null);
  const endTicks = all ? Math.min(M.capTicks, Math.ceil(Math.max(...cars.map((c) => c.finish as number)))) : M.capTicks;
  for (const c of cars) c.prog = c.rec.prog[endTicks - 1];
  const ranking = rank(cars);
  const h = new Hasher().u32(raceSeed >>> 0).u32(track.sub).u32(endTicks);
  for (const c of cars) h.u32(c.slot).f64(c.finish ?? -1).f64(c.prog).f64s(c.rec.x).f64s(c.rec.y).f64s(c.rec.hdg).f64s(c.rec.v);
  for (const k of ranking) h.u32(k);
  return { raceSeed, track, cars, ranking, endTicks, hash: h.hex() };
}
