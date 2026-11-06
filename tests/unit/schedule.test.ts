// A Multiplayer match's shared schedule (common/schedule.ts, match-flow v2 plan §M2), and that supabase/schema.sql
// freezes each round's entries at the same moments.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/common/config';
import { firstRound, matchOverMs, phaseAt, roundMs, roundTimes } from '../../src/common/schedule';

const R = CONFIG.rounds;

describe('room schedule', () => {
  it('round 1: build 60 s, train 20 s, hand in, countdown, race 30 s, then 8 s of standings', () => {
    const t = roundTimes(1);
    expect(t).toEqual({ start: 0, train: 60_000, handIn: 80_000, freeze: 83_000, go: 88_000, raceEnd: 118_000, standings: 119_500, next: 127_500 });
    expect(roundTimes(2).start).toBe(127_500);
    expect(roundTimes(2).train - roundTimes(2).start).toBe(20_000);
    expect(roundMs(2)).toBe(87_500);
    expect(matchOverMs()).toBe(roundTimes(3).standings);
    expect(R.count).toBe(3); // match polish §1: three rounds
  });

  it('phaseAt walks every phase in order, round by round, and ends over', () => {
    const seen: string[] = [];
    for (let t = 0; t < matchOverMs() + 5000; t += 250) {
      const p = phaseAt(t), k = `${p.round}:${p.phase}`;
      if (seen[seen.length - 1] !== k) seen.push(k);
      expect(p.end).toBeGreaterThan(t);
    }
    const one = ['build', 'train', 'handIn', 'countdown', 'race', 'hold', 'standings'];
    const want = [1, 2].flatMap((n) => one.map((ph) => `${n}:${ph}`)).concat(one.slice(0, -1).map((ph) => `3:${ph}`), '3:over');
    expect(seen).toEqual(want);
    expect(phaseAt(roundTimes(3).freeze - 1).phase).toBe('handIn');
    expect(phaseAt(roundTimes(3).freeze).phase).toBe('countdown');
  });

  it('joined mid-match: in from the next build', () => {
    expect(firstRound(-5)).toBe(1);
    expect(firstRound(0)).toBe(1);
    expect(firstRound(1)).toBe(2);
    expect(firstRound(roundTimes(2).start)).toBe(2);
    expect(firstRound(roundTimes(2).freeze)).toBe(3);
    expect(firstRound(roundTimes(3).start + 1)).toBe(4);
  });

  it('supabase/schema.sql uses the same numbers (round start, freeze, match over, the round count)', () => {
    const sql = readFileSync('supabase/schema.sql', 'utf8');
    const t1 = roundTimes(1), tail = (roundMs(1) / 1000) - R.build[0], freeze = (t1.freeze - t1.train + R.build[0] * 1000) / 1000 - R.build[0];
    const over = (matchOverMs() - roundTimes(R.count).freeze) / 1000;
    expect(sql).toContain(`array[${R.build.join(',')}]`);
    expect(sql).toContain(`sum(b + ${tail})`);
    expect(sql).toContain(`[p_round] + ${freeze})`);
    expect(sql).toContain(`make_interval(secs => ${over})`);
    expect([tail, freeze, over]).toEqual([67.5, 23, 36.5]);
    expect(sql).toContain(`synapse_round_freeze(p_at, ${R.count}) + make_interval`);
    // every round check, in the tables and the functions, is 1 to the round count
    const checks = [...sql.matchAll(/round (?:not )?between 1 and (\d+)/g)].map((m) => Number(m[1]));
    expect(checks.length).toBeGreaterThanOrEqual(6);
    expect(new Set(checks)).toEqual(new Set([R.count]));
  });
});
