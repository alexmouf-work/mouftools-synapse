// A Multiplayer match's shared schedule (match-flow v2 plan §M2): the host's Start match fixes the match's start on the
// server's clock, and every phase of the rounds starts at a fixed offset from it, so every client derives the same
// phases from that one time. Round n of 3 (match polish §1): build (60 s in round 1, then 20 s), train 20 s, hand in
// 3 s, the race's countdown 5 s (the server freezes the round's entries as it begins), the race 30 s, the cars hold
// 1.5 s, then 8 s of standings (after the last round the final standings stay). Times are milliseconds from the match's start. supabase/schema.sql
// computes the same freeze times (synapse_round_start / synapse_round_freeze); tests/unit/schedule.test.ts keeps the
// two in step.
import { CONFIG } from './config';

const R = CONFIG.rounds, S = 1000;
const RACE = (R.raceTicks / CONFIG.tick.hz) * S;

export type RoomPhase = 'build' | 'train' | 'handIn' | 'countdown' | 'race' | 'hold' | 'standings' | 'over';

/** When round n's phases start (ms from the match's start). `next` is the next round's build (the last round: the end). */
export interface RoundTimes { start: number; train: number; handIn: number; freeze: number; go: number; raceEnd: number; standings: number; next: number }

/** The length of round n (1–CONFIG.rounds.count), build to the end of its standings. */
export const roundMs = (n: number): number => (R.build[n - 1] + R.train + R.room.handIn + R.room.lead + R.hold + R.nextAfter) * S + RACE;

export function roundTimes(n: number): RoundTimes {
  let start = 0;
  for (let k = 1; k < n; k++) start += roundMs(k);
  const train = start + R.build[n - 1] * S, handIn = train + R.train * S, freeze = handIn + R.room.handIn * S;
  const go = freeze + R.room.lead * S, raceEnd = go + RACE, standings = raceEnd + R.hold * S;
  return { start, train, handIn, freeze, go, raceEnd, standings, next: standings + R.nextAfter * S };
}

/** From here on the match is over (the last round's final standings, which stay until the host starts another). */
export const matchOverMs = (): number => roundTimes(R.count).standings;

/** The round and phase at time t (ms from the match's start; before it counts as round 1's build), and when it ends. */
export function phaseAt(t: number): { round: number; phase: RoomPhase; end: number } {
  if (t >= matchOverMs()) return { round: R.count, phase: 'over', end: Infinity };
  for (let n = 1; n <= R.count; n++) {
    const r = roundTimes(n);
    if (t >= r.next) continue;
    const steps: [RoomPhase, number][] = [['build', r.train], ['train', r.handIn], ['handIn', r.freeze], ['countdown', r.go], ['race', r.raceEnd], ['hold', r.standings], ['standings', r.next]];
    for (const [phase, end] of steps) if (t < end) return { round: n, phase, end };
  }
  return { round: R.count, phase: 'over', end: Infinity };
}

/** The first round a player who joined at time t (ms from the match's start) plays: the next build to start after it. */
export function firstRound(t: number): number {
  for (let n = 1; n <= R.count; n++) if (t <= roundTimes(n).start) return n;
  return R.count + 1; // too late for this match: watch it to the end
}
