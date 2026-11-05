// vs CPU as a 5-round match (docs/plans/2026-11-05-rounds.md, match-flow-v2.md): each round builds (60 s in round 1,
// from the starting brain; 20 s after, upgrading the same design within that round's budget), trains for 20 s (the
// round's budget T, from fresh weights each round; at 20 s it stops where it got to), then races nine CPU players for
// 30 s on a new track. Only the timers move it on (match-flow v2 plan, 2026-11-05): no Train, Skip or Next round. The
// score is the total signed distance; after each race the standings show this race's distance and the running total
// for 8 s, then the next build starts. After round 5 the final standings, with Play again or Main menu; the winner
// music plays if you lead. Every phase has its big countdown (ui/phaseTimer.ts) at the top centre.
import { CONFIG } from '../../../common/config';
import { defaultGenome } from '../../../common/sim/brain';
import { CPU_NAMES } from '../../../common/sim/cpu';
import type { RaceResult } from '../../../common/sim/match';
import type { Genome } from '../../../common/sim/spec';
import { derive } from '../../../common/rng';
import { win } from '../../audio/music';
import { hideArena } from '../arena';
import type { Saved } from '../designer/store';
import { startPhaseTimer, stopPhaseTimer } from '../phaseTimer';
import { fmtKm, leaveRace, newRaceSeed, openRace, roundSetup } from '../race/raceView';
import { leaveTraining, openTraining, stopTraining } from '../training/trainingView';
import { zeroGenome } from '../../../common/sim/brain';

const R = CONFIG.rounds;
const NAMES = ['You', ...CPU_NAMES];
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`rounds: #${id} missing`);
  return e as T;
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const ord = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

export const ordinal = ord;

/** One standings row: a name, this round's signed distance, the total; `you` marks your row. */
export interface StandingsRow { name: string; dist: number; total: number; you: boolean }
/**
 * The round's standings in the race view's results panel (rows already in order, best total first), opened at the top;
 * Play again / Main menu are hidden here (the final standings show them).
 */
export function showStandings(title: string, round: number, rows: StandingsRow[]): void {
  $('rcResT').textContent = title;
  $('rcHead').innerHTML = `<tr><th>Place</th><th>Name</th><th>Round ${round}</th><th>Total</th></tr>`;
  $('rcRows').innerHTML = rows.map((r, i) => `<tr class="${r.you ? 'you' : ''}"><td>${i + 1}</td><td>${esc(r.name)}</td><td>${fmtKm(r.dist)}</td><td>${fmtKm(r.total)}</td></tr>`).join('');
  $('rcScroll').scrollTop = 0;
  $('rcAgain').hidden = true; $('rcBack').hidden = true;
  $('rcResults').hidden = false;
}

/** What the match asks of the page (main.ts routes the views). */
export interface MatchViews {
  /** The designer in match mode on this brain, held to this round's budget. */
  build(genome: Genome, limit: number): void;
  /** The designer goes (training or the race takes the screen). */
  away(): void;
  /** The build timer ran out: Train with the design as it stands (designer.timeUp). */
  timeUp(): void;
  /** Back to the title (the final standings' Back). */
  title(): void;
}

type Phase = 'build' | 'train' | 'race' | 'standings' | 'over';
interface Match {
  seed: number; trainSeed: number; round: number; phase: Phase;
  /** The brain as it stands (built or trained), and the Saved it trains as (the trainer picked). */
  genome: Genome; saved: Saved | null; trained: Genome | null;
  /** dists[r][k]: car k's signed distance in round r + 1's race; total[k] the sum so far. */
  dists: number[][]; total: number[];
  hash: string[];
}
let M: Match | null = null;
let V: MatchViews;

const designerHost = () => document.querySelector<HTMLElement>('.app .rulebar')!;
const camHost = () => $('camTop');
const label = (m: Match, what: string) => `Round ${m.round} of ${R.count} · ${what}`;

/** Order by total distance (then this race's, then entry order): the standings. */
function order(m: Match): number[] {
  const last = m.dists[m.dists.length - 1] ?? NAMES.map(() => 0);
  return NAMES.map((_, k) => k).sort((a, b) => m.total[b] - m.total[a] || last[b] - last[a] || a - b);
}

/** Start a match. Checks: `seed` fixes the race tracks; `raceWith` skips straight to round `round`'s race with that brain. */
export function startMatch(views: MatchViews, o: { seed?: number; round?: number; raceWith?: Saved } = {}): void {
  abortMatch();
  V = views;
  const round = Math.max(1, Math.min(R.count, o.round ?? 1));
  M = {
    seed: o.seed ?? newRaceSeed(), trainSeed: newRaceSeed(), round, phase: 'build', genome: o.raceWith?.genome ?? defaultGenome(),
    saved: o.raceWith ?? null, trained: null, dists: [], total: NAMES.map(() => 0), hash: [],
  };
  if (o.raceWith) { M.trained = o.raceWith.genome; V.away(); race(); } else build();
}

export const inMatch = (): boolean => M !== null && M.phase !== 'over';

/** Leave the match now (Main menu, after asking): every timer and view it runs stops. */
export function abortMatch(): void {
  stopPhaseTimer();
  if (!M) return;
  if (M.phase === 'train') leaveTraining();
  if (M.phase === 'race' || M.phase === 'standings' || M.phase === 'over') leaveRace();
  M = null;
}

function build(): void {
  const m = M!;
  m.phase = 'build';
  V.build(m.genome, R.budgets[m.round - 1]);
  startPhaseTimer({ label: label(m, 'Build'), seconds: R.build[m.round - 1], red: 10, host: designerHost(), onZero: () => V.timeUp() });
}

/** The designer's Train (pressed, or the build timer at 0): 10 s of training from the brain as built. */
export function matchTrain(saved: Saved): void {
  const m = M;
  if (!m || m.phase !== 'build') return;
  stopPhaseTimer();
  m.phase = 'train'; m.genome = saved.genome; m.saved = saved; m.trained = null;
  V.away();
  let up = false;
  const go = () => { if (M === m && m.phase === 'train' && up && m.trained) race(); };
  // at 0 training stops where it has got to and keeps the best so far, so a slow device still races on time
  startPhaseTimer({ label: label(m, 'Train'), seconds: R.train, red: 5, host: camHost(), onZero: () => { up = true; if (!m.trained) stopTraining(); go(); } });
  const done = (next: Saved) => { if (M !== m || m.phase !== 'train') return; m.trained = next.genome; go(); };
  openTraining(saved, 0, 0, { save: () => undefined, back: () => undefined, drive: () => undefined, round: { n: m.round, seed: m.trainSeed, done } }, true)
    .catch((e) => { console.error(e); done(saved); });
}

function race(): void {
  const m = M!;
  m.phase = 'race';
  stopPhaseTimer();
  leaveTraining();
  const saved: Saved = { ...(m.saved ?? { name: 'vs CPU', train: { seed: null, phases: 0, temps: [] }, trainer: 'evolution' }), genome: m.trained! };
  const raceSeed = derive(m.seed >>> 0, 0x50d5, m.round);
  openRace(roundSetup(saved, m.round, raceSeed), {
    back: () => undefined,
    go: () => { if (M === m && m.phase === 'race') startPhaseTimer({ label: label(m, 'Race'), seconds: R.raceTicks / CONFIG.tick.hz, red: 10, upText: 'Finish', host: camHost(), onZero: () => undefined }); },
    ended: (res) => { if (M === m) standings(res); },
  }).catch((e) => { console.error(e); });
}

function standings(res: RaceResult): void {
  const m = M!;
  stopPhaseTimer();
  const d = res.cars.map((c) => c.dist);
  m.dists.push(d); m.hash.push(res.hash);
  d.forEach((x, k) => { m.total[k] += x; });
  const final = m.round >= R.count, ord0 = order(m), you = ord0.indexOf(0) + 1;
  m.phase = final ? 'over' : 'standings';
  showStandings(final ? (you === 1 ? 'You won the match!' : `Final standings: you finished ${ord(you)} of ${NAMES.length}`) : `Round ${m.round} of ${R.count} · Standings`,
    m.round, ord0.map((k) => ({ name: NAMES[k], dist: d[k], total: m.total[k], you: k === 0 })));
  // only the timers move a match on (match-flow v2 §1): no Next round; after round 5, Play again / Main menu
  const again = $('rcAgain'), back = $('rcBack');
  again.textContent = 'Play again';
  back.textContent = 'Main menu';
  back.hidden = !final; again.hidden = !final;
  if (final) {
    again.onclick = () => { leaveRace(); hideArena(); startMatch(V); };
    back.onclick = () => { leaveRace(); hideArena(); M = null; V.title(); };
    if (you === 1) win();
    return;
  }
  const next = () => {
    if (M !== m || m.phase !== 'standings') return;
    stopPhaseTimer(); leaveRace(); hideArena();
    m.round++; m.genome = zeroGenome(m.trained!.spec); // the design carries over; the weights start fresh next round
    build();
  };
  startPhaseTimer({ label: `Round ${m.round + 1} of ${R.count} in`, seconds: R.nextAfter, red: 0, pulse: 0, upText: 'Build!', upMs: 300, host: camHost(), onZero: next });
}

// for checks (Playwright): the match as it stands
declare global {
  interface Window {
    __match?: { phase: Phase | 'none'; round: number; dists: number[][]; total: number[]; hash: string[]; standings: string[]; seed: number; trainSeed: number; trained: Genome | null };
  }
}
Object.defineProperty(window, '__match', {
  get: () => (M
    ? { phase: M.phase, round: M.round, dists: M.dists, total: M.total, hash: M.hash, standings: order(M).map((k) => NAMES[k]), seed: M.seed, trainSeed: M.trainSeed, trained: M.trained }
    : { phase: 'none', round: 0, dists: [], total: [], hash: [], standings: [], seed: 0, trainSeed: 0, trained: null }),
});
