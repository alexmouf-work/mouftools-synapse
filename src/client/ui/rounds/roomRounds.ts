// Multiplayer on the same timed 5 rounds as vs CPU (match-flow v2 plan §M2). The host's Start match fixes the match's
// start on the server's clock; every phase follows at a fixed time after it (common/schedule.ts), so every client runs
// the same phases from that one time, with no buttons: build (60 s in round 1, then 20 s) in the designer under the
// round's budget; train 20 s from fresh weights (it stops where it got to and keeps the best so far); at the train
// phase's end the brain is handed in; the server freezes the round's entries as the race's countdown begins, 3 s
// later; every client fetches them, computes the race (deterministic: the same race everywhere) and counts down to
// the server's Go; the race's 30 s; then 8 s of standings (this round's signed distance and the total, as vs CPU; a
// player with nothing in has 0 m). After round 5 the final standings stay, with Play again (back to the lobby, where
// the host can change the settings and start the next match) and Main menu. Each round's track follows the room's map
// setting (tracks-v2 T2), locked while the match is on, so every client derives the same track.
// A player who joins mid-match watches (the lobby, then the round's race) until the next round's build.
//
// One ticker (every 100 ms) compares the server's time (net/rooms.ts serverNow) with the schedule and moves the
// match on; the phase timers only show the time left. In checks, a phase timer's skipTo moves this client's view of
// the server's clock on as far (the check moves the stand-in's clock as much), so the phases follow.
import { CONFIG } from '../../../common/config';
import { derive } from '../../../common/rng';
import { firstRound, phaseAt, roundTimes } from '../../../common/schedule';
import { defaultGenome, genomeToJSON, zeroGenome } from '../../../common/sim/brain';
import { energyRefusal } from '../../../common/sim/energy';
import { NEW_EACH_ROUND, ROUND_RACE, roundTrackSeed, runRace, type MapSetting, type RaceResult } from '../../../common/sim/match';
import { validateGenome, type Genome } from '../../../common/sim/spec';
import { win } from '../../audio/music';
import { roundEntries, serverNow, shiftClock, submitResult, submitRoundBrain, type Entry, type Me, type RoomPlayer } from '../../net/rooms';
import { hideArena, showArena } from '../arena';
import type { Saved } from '../designer/store';
import { onPhaseSkip, retimePhase, startPhaseTimer, stopPhaseTimer, type PhaseOptions } from '../phaseTimer';
import { leaveRace, newRaceSeed, openRace } from '../race/raceView';
import { leaveTraining, openTraining, prewarmTraining, stopTraining } from '../training/trainingView';
import { matchStarter, ordinal, showStandings, WARM_AFTER_MS } from './rounds';

const R = CONFIG.rounds;
const TICK_MS = 100;
/** Entries not frozen yet (a request a moment early): ask again this soon. */
const RETRY_MS = 300;

/** A match as the lobby saw it start, with the room's map (settings are locked while it is on). */
export interface RoomMatchInfo { me: Me; matchNo: number; seed: number; at: number; map: MapSetting }

/** What a room's match asks of the page (main.ts routes the views; lobby.ts the room). */
export interface RoomViews {
  /** The designer in match mode on this brain, held to this round's budget. */
  build(genome: Genome, limit: number): void;
  /** The designer and the lobby go (training or the race takes the screen). */
  away(): void;
  /** The build phase is over: Train with the design as it stands (designer.timeUp). */
  timeUp(): void;
  /** Joined mid-match: the lobby, saying so, until the round's race. */
  watch(text: string): void;
  /** The room's players now (for the standings: who sat a round out). */
  players(): RoomPlayer[];
  /** Main menu (asks "Leave the room?" first). */
  menu(): void;
  /** The final standings' Play again: back to the lobby (the host starts the next match there). */
  again(): void;
}

type Step = 'wait' | 'build' | 'train' | 'handIn' | 'race' | 'standings' | 'over';
interface RoundRace { entries: Entry[]; ok: Entry[]; genomes: Genome[]; result: RaceResult | null }
interface RM {
  info: RoomMatchInfo;
  /** The first round you play (an earlier one you watch); 6: watching to the end. */
  first: number;
  round: number; step: Step;
  /** The brain as built this round, the Saved it trains as, and what training gave. */
  genome: Genome; saved: Saved | null; trained: Genome | null; built: boolean;
  /** Handed in this round; asked the designer to Train; a fetch of the entries in flight. */
  handed: boolean; asked: boolean; fetching: boolean;
  trainSeed: number;
  /** Each round's frozen entries and race, and each player's signed distance in it (by player id). */
  races: Map<number, RoundRace>; dists: Map<number, Map<string, number>>;
  names: Map<string, string>;
  /** The last round whose standings show. */
  shown: number;
  /** Each round's standings as shown (names, best total first), for checks. */
  standings: string[][];
  /** Main-thread ms each round's race took to compute. */
  computeMs: number[];
  /** When the countdown showing ends (ms from the match's start): every tick holds it to the server's clock. */
  until: number;
  timer: number;
}
let M: RM | null = null;
let V: RoomViews;

const $ = (id: string): HTMLElement => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`roomRounds: #${id} missing`);
  return e;
};
const designerHost = () => document.querySelector<HTMLElement>('.app .rulebar')!;
const camHost = () => $('camTop');
const lobbyHost = () => document.querySelector<HTMLElement>('#mpLobby .mp-bar')!;
const label = (n: number, what: string) => `Round ${n} of ${R.count} · ${what}`;
/** ms from the match's start, on the server's clock. */
const rel = (m: RM) => serverNow() - m.info.at;
/** Seconds from now to a time in the match (ms from its start). */
const secsTo = (m: RM, t: number) => Math.max(0, (t - rel(m)) / 1000);
const noop = () => undefined;
/** A countdown to time `until` in the match (ms from its start), kept to the server's clock by the ticker. */
function countdown(m: RM, until: number, o: Omit<PhaseOptions, 'seconds' | 'onZero'>): void {
  m.until = until;
  startPhaseTimer({ ...o, seconds: secsTo(m, until), onZero: noop });
}
/** The standings show in the race view's panel: the arena up if no race is showing (nobody raced this round). */
const raceArena = () => { if ($('arena').hidden || $('raceOverlay').hidden) showArena('race'); };

export const inRoomMatch = (): boolean => M !== null;

/** Start following a match (the lobby saw it start; a new one replaces the last). */
export function startRoomMatch(views: RoomViews, info: RoomMatchInfo): void {
  abortRoomMatch();
  V = views;
  const m: RM = {
    info, first: firstRound(info.me.joined - info.at), round: 0, step: 'wait', genome: defaultGenome(), saved: null, trained: null, built: false,
    handed: false, asked: false, fetching: false, trainSeed: newRaceSeed(), races: new Map(), dists: new Map(), names: new Map(), shown: 0, standings: [], computeMs: [], until: 0, timer: 0,
  };
  M = m;
  onPhaseSkip((ms) => { if (M === m) shiftClock(ms); });
  m.timer = window.setInterval(tick, TICK_MS);
  tick();
}

/** Stop following the match now (Main menu, removed from the room): every timer and view it runs stops. */
export function abortRoomMatch(): void {
  if (!M) return;
  const m = M;
  M = null;
  clearInterval(m.timer);
  onPhaseSkip(null);
  stopPhaseTimer();
  leaveTraining(); leaveRace();
}

function tick(): void {
  const m = M;
  if (!m) return;
  retimePhase(secsTo(m, m.until));
  const p = phaseAt(rel(m));
  if (p.phase === 'over') { if (m.step !== 'over') finalStandings(m); return; }
  if (p.round > m.round) enterRound(m, p.round);
  switch (p.phase) {
    case 'build': break;
    case 'train':
      // watching from the lobby: the build is over, now count the training down
      if (m.step === 'wait' && m.until !== roundTimes(m.round).handIn) countdown(m, roundTimes(m.round).handIn, { label: label(m.round, 'Train'), red: 0, pulse: 0, upText: 'Race', upMs: 0, host: lobbyHost() });
      // the build timer's 0: Train with the design as it stands (the designer waits if it's over the budget)
      if (m.step === 'build' && !m.asked) { m.asked = true; V.timeUp(); }
      break;
    case 'handIn':
      if (m.step === 'build') m.step = 'handIn'; // never trained (over the budget): nothing in, 0 m this round
      else if (m.step === 'train') { m.step = 'handIn'; if (m.trained) handIn(m); else stopTraining(); }
      break;
    default: // the countdown, the race, the hold and the standings: the frozen entries, then the race
      if (m.step === 'wait' || m.step === 'build' || m.step === 'train' || m.step === 'handIn') fetchRace(m, m.round);
      if (p.phase === 'standings' && m.step === 'race' && rel(m) >= roundTimes(m.round).standings + 1000) standings(m, m.round);
  }
}

/** Round n begins for this client: build it (a round you play) or watch it from the lobby. */
function enterRound(m: RM, n: number): void {
  stopPhaseTimer(); leaveTraining(); leaveRace(); hideArena();
  m.round = n; m.trained = null; m.saved = null; m.handed = false; m.asked = false; m.fetching = false;
  const t = roundTimes(n);
  if (n < m.first) {
    m.step = 'wait';
    V.watch(m.first <= R.count ? `A match is on (round ${n} of ${R.count}). You join at round ${m.first}'s build; watch until then.` : `A match is on (round ${n} of ${R.count}). Watch it; you're in the next one.`);
    const ph = phaseAt(rel(m));
    countdown(m, ph.phase === 'build' ? t.train : t.handIn, { label: label(n, ph.phase === 'build' ? 'Build' : 'Train'), red: 0, pulse: 0, upText: 'Race', upMs: 0, host: lobbyHost() });
    return;
  }
  // the design carries over from the round before; the weights start fresh every round (match-flow v2 §2)
  m.genome = m.built ? zeroGenome(m.genome.spec) : matchStarter(); // a fresh random starter for your first round
  m.built = true;
  m.step = 'build';
  V.build(m.genome, R.budgets[n - 1]);
  countdown(m, t.train, { label: label(n, 'Build'), red: 10, host: designerHost() });
  // the round's training view gets ready while you build (workers, scene, shaders)
  setTimeout(() => { if (M === m && m.round === n && m.step === 'build') prewarmTraining({ n, seed: m.trainSeed }); }, WARM_AFTER_MS);
}

/** The designer's Train (the build timer at 0): training to the end of the train phase, from fresh weights. */
export function roomTrain(saved: Saved): void {
  const m = M;
  if (!m || m.step !== 'build') return;
  const n = m.round, t = roundTimes(n);
  m.step = 'train'; m.genome = saved.genome; m.saved = saved; m.trained = null;
  V.away();
  countdown(m, t.handIn, { label: label(n, 'Train'), red: 5, upMs: 300, host: camHost() });
  // training done (the whole budget, or stopped at the phase's end): that brain is final, so it goes in now
  const done = (next: Saved) => {
    if (M !== m || m.round !== n || m.trained) return;
    m.trained = next.genome;
    handIn(m);
  };
  openTraining(saved, 0, 0, { save: noop, back: noop, drive: noop, round: { n, seed: m.trainSeed, done } }, true)
    .catch((e) => { console.error(e); done(saved); });
}

/** Training is done (or stopped at the train phase's end): hand in that brain for this round; once more if it fails. */
function handIn(m: RM, again = true): void {
  if (m.handed || !m.trained) return;
  m.handed = true;
  const n = m.round;
  submitRoundBrain(m.info.me, m.info.matchNo, n, genomeToJSON(m.trained)).catch((e) => {
    console.warn('room: brain not handed in', e);
    if (!again || M !== m || m.round !== n || rel(m) > roundTimes(n).freeze - 500) return;
    setTimeout(() => { if (M === m && m.round === n) { m.handed = false; handIn(m, false); } }, 300);
  });
}

/** A round's entries that race: valid brains within the round's budget, in join order (the same on every client). */
export function racing(entries: Entry[], round: number): { ok: Entry[]; genomes: Genome[] } {
  const ok: Entry[] = [], genomes: Genome[] = [];
  for (const e of entries) {
    try {
      const g = JSON.parse(e.brain) as Genome;
      validateGenome(g);
      if (energyRefusal(g.spec, R.budgets[round - 1])) continue;
      ok.push(e); genomes.push(g);
    } catch { /* not a brain: left out (0 m), the same on every client */ }
  }
  return { ok, genomes };
}
/** Round n's race seed (as vs CPU's), and its track under the room's map. */
export const roomRaceSeed = (matchSeed: number, n: number): number => derive(matchSeed >>> 0, 0x50d5, n);
export const roomTrackSeed = (matchSeed: number, n: number, map: MapSetting = NEW_EACH_ROUND): number => roundTrackSeed(roomRaceSeed(matchSeed, n), map);

/** Round n's race: compute it from the frozen entries (recording your car), keep each player's distance. */
function computeRace(m: RM, n: number, entries: Entry[], mine: string | null): RoundRace {
  const { ok, genomes } = racing(entries, n), me = mine === null ? -1 : ok.findIndex((e) => e.id === mine);
  const c0 = performance.now();
  const result = genomes.length ? runRace(genomes, roomRaceSeed(m.info.seed, n), (k) => k === me, ROUND_RACE, roomTrackSeed(m.info.seed, n, m.info.map)) : null;
  m.computeMs[n - 1] = performance.now() - c0;
  const d = new Map<string, number>();
  for (const e of entries) { m.names.set(e.id, e.name); d.set(e.id, 0); }
  ok.forEach((e, k) => d.set(e.id, result!.cars[k].dist));
  const rr = { entries, ok, genomes, result };
  m.races.set(n, rr); m.dists.set(n, d);
  return rr;
}

/** Fetch round n's frozen entries (again shortly if not frozen yet), then show its race. */
function fetchRace(m: RM, n: number): void {
  if (m.fetching) return;
  m.fetching = true;
  roundEntries(m.info.me.code, m.info.matchNo, n).then((entries) => {
    if (M !== m || m.round !== n) return;
    if (!entries) { setTimeout(() => { m.fetching = false; }, RETRY_MS); return; }
    showRace(m, n, entries);
  }).catch((e) => { console.warn('room: entries not fetched', e); setTimeout(() => { m.fetching = false; }, RETRY_MS); });
}

function showRace(m: RM, n: number, entries: Entry[]): void {
  if (m.step === 'race' || m.step === 'standings') return;
  const rr = computeRace(m, n, entries, m.info.me.player);
  m.step = 'race';
  stopPhaseTimer(); leaveTraining(); V.away();
  if (!rr.result) return; // nobody in: the standings come at their time
  const t = roundTimes(n), me = rr.ok.findIndex((e) => e.id === m.info.me.player);
  openRace({
    kind: 'room', title: `${label(n, 'Race')} · Room ${m.info.me.code}`, names: rr.ok.map((e) => e.name), genomes: rr.genomes, me,
    raceSeed: rr.result.raceSeed, goAt: performance.now() + (t.go - rel(m)), raceNo: n, len: ROUND_RACE, result: rr.result,
  }, {
    back: noop,
    go: () => { if (M === m && m.round === n && m.step === 'race') countdown(m, t.raceEnd, { label: label(n, 'Race'), red: 10, upText: 'Finish', host: camHost() }); },
    ended: () => { if (M === m && m.round === n) standings(m, n); },
  }).catch((e) => console.error(e));
}

/** Rounds this client didn't see (joined mid-match): fetch their entries and run them (the same races, without drawing). */
async function fill(m: RM, upTo: number): Promise<void> {
  for (let k = 1; k <= upTo; k++) {
    if (m.dists.has(k)) continue;
    const e = await roundEntries(m.info.me.code, m.info.matchNo, k).catch(() => null);
    if (M !== m) return;
    if (e) computeRace(m, k, e, null);
  }
}

/** The standings after round n: every player in it (a player with nothing in has 0 m), best total first. */
function rowsAfter(m: RM, n: number): { id: string; name: string; dist: number; total: number }[] {
  const ids = new Map<string, string>();
  for (let k = 1; k <= n; k++) for (const e of m.races.get(k)?.entries ?? []) ids.set(e.id, e.name);
  const start = m.info.at + roundTimes(n).start;
  for (const p of V.players()) if (p.joined <= start && !ids.has(p.id)) ids.set(p.id, p.name);
  if (m.first <= n && !ids.has(m.info.me.player)) ids.set(m.info.me.player, m.info.me.name);
  const rows = [...ids].map(([id, name]) => {
    let total = 0;
    for (let k = 1; k <= n; k++) total += m.dists.get(k)?.get(id) ?? 0;
    return { id, name, dist: m.dists.get(n)?.get(id) ?? 0, total };
  });
  // best total, then this round's distance, then by name (unique in a room): the same order on every client
  return rows.sort((a, b) => b.total - a.total || b.dist - a.dist || (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));
}

function standings(m: RM, n: number): void {
  if (m.shown >= n || n >= R.count) { if (n >= R.count) finalStandings(m); return; }
  m.shown = n; m.step = 'standings';
  stopPhaseTimer();
  void fill(m, n).then(() => {
    if (M !== m || m.round !== n || m.step !== 'standings') return;
    const rows = rowsAfter(m, n);
    m.standings[n - 1] = rows.map((r) => r.name);
    raceArena();
    showStandings(label(n, 'Standings'), n, rows.map((r) => ({ name: r.name, dist: r.dist, total: r.total, you: r.id === m.info.me.player })));
    report(m, n, rows);
    countdown(m, roundTimes(n).next, { label: `Round ${n + 1} of ${R.count} in`, red: 0, pulse: 0, upText: 'Build!', upMs: 300, host: camHost() });
  });
}

/** After round 5: the final standings stay, with Play again (back to the lobby) and Main menu, for everyone. */
function finalStandings(m: RM): void {
  if (m.step === 'over') return;
  const n = R.count;
  m.step = 'over'; m.shown = n;
  stopPhaseTimer(); leaveTraining();
  void fill(m, n).then(() => {
    if (M !== m) return;
    const rows = rowsAfter(m, n), you = rows.findIndex((r) => r.id === m.info.me.player) + 1;
    m.standings[n - 1] = rows.map((r) => r.name);
    raceArena();
    const title = you === 0 ? 'Final standings' : you === 1 ? 'You won the match!' : `Final standings: you finished ${ordinal(you)} of ${rows.length}`;
    showStandings(title, n, rows.map((r) => ({ name: r.name, dist: r.dist, total: r.total, you: r.id === m.info.me.player })));
    report(m, n, rows);
    const again = $('rcAgain') as HTMLButtonElement, back = $('rcBack');
    again.textContent = 'Play again'; again.hidden = false; again.disabled = false;
    back.textContent = 'Main menu'; back.hidden = false;
    again.onclick = () => V.again();
    back.onclick = () => V.menu();
    if (you === 1) win();
  });
}

/** Your result in the round, as the privacy policy says (place and distance). */
function report(m: RM, n: number, rows: { id: string; dist: number; total: number }[]): void {
  const i = rows.findIndex((r) => r.id === m.info.me.player);
  if (i < 0 || !m.races.get(n)?.entries.some((e) => e.id === m.info.me.player)) return;
  submitResult(m.info.me, JSON.stringify({ match: m.info.matchNo, round: n, place: i + 1, dist: Math.round(rows[i].dist), total: Math.round(rows[i].total) }))
    .catch((e) => console.warn('room: result not sent', e));
}

// for checks (Playwright): the room's match as this client follows it
declare global {
  interface Window {
    __roomMatch?: {
      on: boolean; matchNo: number; seed: number; at: number; first: number; round: number; step: Step | 'none';
      /** The room's map for this match and each round's track seed (tracks-v2 T2). */
      map: MapSetting | null; tracks: number[];
      /** The server's clock as this client has it, ms from the match's start. */
      t: number;
      handed: boolean; trained: Genome | null; hashes: string[]; standings: string[][]; computeMs: number[];
      /** Each round's distances so far, by player name. */
      dists: Record<string, number>[];
    };
  }
}
Object.defineProperty(window, '__roomMatch', {
  get: () => {
    const m = M;
    if (!m) return { on: false, matchNo: 0, seed: 0, at: 0, first: 0, round: 0, step: 'none', map: null, tracks: [], t: 0, handed: false, trained: null, hashes: [], standings: [], computeMs: [], dists: [] };
    const dists = Array.from({ length: R.count }, (_, k) => Object.fromEntries([...(m.dists.get(k + 1) ?? new Map<string, number>())].map(([id, d]) => [m.names.get(id) ?? id, d])));
    return {
      on: true, matchNo: m.info.matchNo, seed: m.info.seed, at: m.info.at, first: m.first, round: m.round, step: m.step, t: rel(m),
      map: m.info.map, tracks: Array.from({ length: R.count }, (_, k) => roomTrackSeed(m.info.seed, k + 1, m.info.map)), handed: m.handed, trained: m.trained,
      hashes: Array.from({ length: R.count }, (_, k) => m.races.get(k + 1)?.result?.hash ?? ''), standings: m.standings, computeMs: m.computeMs, dists,
    };
  },
});
