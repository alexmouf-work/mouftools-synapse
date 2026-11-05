// vs CPU as a 5-round match (docs/plans/2026-11-05-rounds.md, match-flow-v2.md): each round builds (60 s in round 1,
// from a fresh random starter; 20 s after, upgrading the same design within that round's budget), trains for 20 s (the
// round's budget T, from fresh weights each round; at 20 s it stops where it got to), then races nine CPU players for
// 30 s on a new track. Only the timers move it on (match-flow v2 plan, 2026-11-05): no Train, Skip or Next round. The
// score is the total signed distance; after each race the standings show this race's distance and the running total
// for 8 s, then the next build starts. After round 5 the final standings, with Play again or Main menu; the winner
// music plays if you lead (Play again goes back to the settings screen). Every phase has its big countdown
// (ui/phaseTimer.ts) at the top centre. The settings screen (ui/cpuSettings, tracks-v2 T2) gives your name, which you
// race under, and the map: each round's track is roundTrackSeed of its race seed under that map.
import { CONFIG } from '../../../common/config';
import { defaultGenome } from '../../../common/sim/brain';
import { energyRefusal } from '../../../common/sim/energy';
import { CPU_NAMES } from '../../../common/sim/cpu';
import { NEW_EACH_ROUND, roundTrackSeed, type MapSetting, type RaceResult } from '../../../common/sim/match';
import type { Genome } from '../../../common/sim/spec';
import { derive } from '../../../common/rng';
import { win } from '../../audio/music';
import { hideArena } from '../arena';
import { starterGenome, type Saved } from '../designer/store';
import { startPhaseTimer, stopPhaseTimer } from '../phaseTimer';
import { fmtKm, leaveRace, newRaceSeed, openRace, roundSetup, tableRows } from '../race/raceView';
import { leaveTraining, openTraining, stopTraining } from '../training/trainingView';
import { zeroGenome } from '../../../common/sim/brain';

const R = CONFIG.rounds;
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
 * The round's standings in the race view's results panel (rows already in order, best total first): at most 10 rows,
 * places 1–3 and those nearest you as the sidebar lists them (principal 2026-11-05); Play again / Main menu are hidden
 * here (the final standings show them).
 */
export function showStandings(title: string, round: number, rows: StandingsRow[]): void {
  $('rcResT').textContent = title;
  $('rcHead').innerHTML = `<tr><th>Place</th><th>Name</th><th>Round ${round}</th><th>Total</th></tr>`;
  $('rcRows').innerHTML = tableRows(rows.length, rows.findIndex((r) => r.you), (i) => { const r = rows[i]; return `<tr class="${r.you ? 'you' : ''}"><td>${i + 1}</td><td>${esc(r.name)}</td><td>${fmtKm(r.dist)}</td><td>${fmtKm(r.total)}</td></tr>`; });
  $('rcAgain').hidden = true; $('rcBack').hidden = true;
  $('rcResults').hidden = false;
  $('rcScroll').scrollTop = 0;
}

/**
 * Round 1's brain in every vs CPU or Multiplayer match (tracks-v2 plan, "A fresh random brain at the start of every
 * game"): a new random starter from a fresh crypto seed (starterSpec: 2–6 inputs, one at least a boundary vector cell,
 * 3 tanh), untrained like every new brain, drawn again until it fits round 1's budget. Nothing comes from the sandbox
 * brain or an earlier match. Checks: `?starter=default` (dev server only) starts from defaultSpec(), the fixture
 * their Node runs use.
 */
export function matchStarter(): Genome {
  if (import.meta.env.DEV && new URLSearchParams(location.search).get('starter') === 'default') return defaultGenome();
  for (let k = 0; k < 64; k++) {
    const g = starterGenome();
    if (!energyRefusal(g.spec, R.budgets[0])) return g;
  }
  return defaultGenome(); // never in practice (tests/unit: every starter of 2000 seeds fits)
}

/** What the match asks of the page (main.ts routes the views). */
export interface MatchViews {
  /** The designer in match mode on this brain, held to this round's budget. */
  build(genome: Genome, limit: number): void;
  /** The designer goes (training or the race takes the screen). */
  away(): void;
  /** The build timer ran out: Train with the design as it stands (designer.timeUp). */
  timeUp(): void;
  /** Back to the title (the final standings' Main menu). */
  title(): void;
  /** The final standings' Play again: back to the settings screen. */
  again(): void;
}

type Phase = 'build' | 'train' | 'race' | 'standings' | 'over';
interface Match {
  seed: number; trainSeed: number; round: number; phase: Phase;
  /** The players' names (you first, under the name you gave) and the map (each round's track). */
  names: string[]; map: MapSetting;
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
  const last = m.dists[m.dists.length - 1] ?? m.names.map(() => 0);
  return m.names.map((_, k) => k).sort((a, b) => m.total[b] - m.total[a] || last[b] - last[a] || a - b);
}

/** A round's race seed (its grid, and its track under "New track each round"). */
const raceSeedOf = (m: Match, n: number): number => derive(m.seed >>> 0, 0x50d5, n);
/** A round's track seed under the match's map. */
const trackOfRound = (m: Match, n: number): number => roundTrackSeed(raceSeedOf(m, n), m.map);

/**
 * Start a match: `name` (yours; the settings screen requires one) and `map`. Checks: `seed` fixes the race seeds;
 * `raceWith` skips straight to round `round`'s race with that brain.
 */
export function startMatch(views: MatchViews, o: { seed?: number; round?: number; raceWith?: Saved; name?: string; map?: MapSetting } = {}): void {
  abortMatch();
  V = views;
  const round = Math.max(1, Math.min(R.count, o.round ?? 1));
  M = {
    seed: o.seed ?? newRaceSeed(), trainSeed: newRaceSeed(), round, phase: 'build', names: [o.name || 'You', ...CPU_NAMES], map: o.map ?? NEW_EACH_ROUND,
    genome: o.raceWith?.genome ?? matchStarter(), saved: o.raceWith ?? null, trained: null, dists: [], total: new Array<number>(CPU_NAMES.length + 1).fill(0), hash: [],
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
  openRace(roundSetup(saved, m.round, raceSeedOf(m, m.round), { name: m.names[0], trackSeed: trackOfRound(m, m.round) }), {
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
  showStandings(final ? (you === 1 ? 'You won the match!' : `Final standings: you finished ${ord(you)} of ${m.names.length}`) : `Round ${m.round} of ${R.count} · Standings`,
    m.round, ord0.map((k) => ({ name: m.names[k], dist: d[k], total: m.total[k], you: k === 0 })));
  // only the timers move a match on (match-flow v2 §1): no Next round; after round 5, Play again / Main menu
  const again = $('rcAgain'), back = $('rcBack');
  again.textContent = 'Play again';
  back.textContent = 'Main menu';
  back.hidden = !final; again.hidden = !final;
  if (final) {
    again.onclick = () => { leaveRace(); hideArena(); M = null; V.again(); };
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
    __match?: {
      phase: Phase | 'none'; round: number; dists: number[][]; total: number[]; hash: string[]; standings: string[]; seed: number; trainSeed: number; trained: Genome | null;
      /** The players' names, the map and each round's track seed (tracks-v2 T2). */
      names: string[]; map: MapSetting | null; tracks: number[];
    };
  }
}
Object.defineProperty(window, '__match', {
  get: () => (M
    ? { phase: M.phase, round: M.round, dists: M.dists, total: M.total, hash: M.hash, standings: order(M).map((k) => M!.names[k]), seed: M.seed, trainSeed: M.trainSeed, trained: M.trained,
      names: M.names, map: M.map, tracks: Array.from({ length: R.count }, (_, k) => trackOfRound(M!, k + 1)) }
    : { phase: 'none', round: 0, dists: [], total: [], hash: [], standings: [], seed: 0, trainSeed: 0, trained: null, names: [], map: null, tracks: [] }),
});
