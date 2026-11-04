// The race countdown "5, 4, 3, 2, 1, Go" (docs/plans/2026-11-04-sound.md). Once audio is unlocked it follows the music
// clock, whichever toggles are off: the numbers come every two beats and Go lands on the drop (music.startRace). Locked
// (no gesture yet), the same spacing runs on a plain timer. Times are performance.now() milliseconds of when each is heard and shown.
import { ctxToPerf, running } from './audio';
import { BEAT, setMode, startRace } from './music';

export interface Countdown {
  /** When 5, 4, 3, 2 and 1 show. */
  at: number[];
  /** When Go shows: the race starts here. */
  go: number;
  /** True if it follows the music. */
  music: boolean;
}

const LEAD_MS = 300; // plain timer: 5 shows this soon after the request

export function raceCountdown(): Countdown {
  if (running()) {
    const r = startRace();
    if (r) return { at: r.ticks.map(ctxToPerf), go: ctxToPerf(r.go), music: true };
  }
  setMode('race');
  const start = performance.now() + LEAD_MS, step = 2 * BEAT * 1000;
  return { at: [0, 1, 2, 3, 4].map((i) => start + i * step), go: start + 5 * step, music: false };
}
