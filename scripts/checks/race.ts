// vs CPU check (B7; rounds plan and sidebar plan 2026-11-05), headless Chromium on SwiftShader:
// - The settings screen (tracks-v2 T2): title → vs CPU opens it, with no designer; your name is required (Start waits
//   for one; 16 characters at most; spaces collapsed), remembered (synapse.name) and filled in next time; Main menu
//   goes back; the map: "New track each round" (the default: each round's race seed's own track), "One family" (a new
//   track of it each round) or "One track" (shuffled; the same track all five rounds), each round's track = Node's
//   roundTrackSeed, and a round's race runs on it. You race under your name.
// - Start match starts a 5-round match in the designer: "Round 1 of 5 · Build" counting from 60, top centre, in the
//   vs CPU yellow, at least Train's row tall; the energy bar's full scale is round 1's budget (20%) and a design past it
//   can't train (says why); red in the last 10 s; a pulse and a tick on the effects bus in the last 5; at 0 "Time's up",
//   then Train starts itself with the design as it stands (jumped ahead with __phase.skipTo).
// - Train: no popup and no buttons, "Round 1 of 5 · Train" from 10 (red under 5), the fixed budget (a small ?T= here)
//   from the starting brain: the trained brain = Node's run of the same design, seed and budget; the generation shows
//   in the timer as "gen n" (nothing overlaps the timer); the race starts when the 20 s are up. Without ?T= a round
//   spends the round's budget, T = the full-skill CPU's (all of it; generations and time reported); at 0 a run still
//   going stops where it got to and keeps the best so far. No Train or Skip button anywhere in vs CPU.
// - Race: ten cars on the grid two by two behind the line where the sim puts them (= Node gridCar), listed in grid
//   order, the countdown 5…1 Go, then "Round 1 of 5 · Race" from 30; the race hash, the ranking by signed distance and
//   each car's place on screen at 20 s = Node runRace (30 s, no laps); the sidebar a quarter of the width with the
//   status, the racers list and the map; your live brain in the camera's corner; render smoke; bloom audits.
// - Standings after the race: this race's signed distance and the total per player, = Node, best total first; "Round 2
//   of 5 in" counting 8 and no buttons → round 2's build: 20 s, the budget 28%, the design carried over with fresh
//   weights (match-flow v2).
// - The last round (round 5, a race straight from ?view=race with the strongest round-5 CPU brain as yours, on a seed
//   where you lead): the final standings, "You won the match!", Play again and Main menu, and the winner music; Play
//   again goes back to the settings screen.
// - The wrong-way reset: each round-1 CPU brain alone from pole on ten race tracks with and without it (it never
//   reverses more than 3 s behind its best point). In the page, a brain that drives backwards: "Wrong way" flashes over
//   your car, the car jumps back (no glide), and its distance in the standings is signed (≤ 0).
// - 844×390: the sidebar, the map and the standings on screen and apart, no sideways scroll. Console clean.
// Screenshots → out/race/.
//   npx tsx scripts/checks/race.ts
import { mkdirSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer } from 'vite';
import cpuData from '../../src/assets/cpu/brains.json';
import { CONFIG } from '../../src/common/config';
import { compile, defaultGenome, genomeHash, zeroGenome } from '../../src/common/sim/brain';
import { CPU_NAMES, cpuRounds } from '../../src/common/sim/cpu';
import { energyRefusal } from '../../src/common/sim/energy';
import { gridCar, raceTrackSeed, recordCar, ROUND_RACE, roundTrackSeed, runRace } from '../../src/common/sim/match';
import { Runner } from '../../src/common/sim/race';
import { derive } from '../../src/common/rng';
import { biasIndex, defaultSpec, OUTPUTS, type BrainSpec, type Genome } from '../../src/common/sim/spec';
import { familyOf, generateTrack } from '../../src/common/sim/track';
import { InlineExecutor } from '../../src/common/train/episodes';
import { runPhase } from '../../src/common/train/phase';
import { NO_TRAINING, SAVE_KEY, serialize } from '../../src/client/ui/designer/store';
import { fixtureBrain, isStarter, STANDINGS_LAYOUT, standingsClear, type StandingsLayout } from './fixture';

const OUT = 'out/race';
const T = 300_000;
const SEED = 7;
const MATCH = 5;
const HZ = CONFIG.tick.hz, R = CONFIG.rounds;
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
let fails = 0;
const check = (cond: boolean, what: string) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (!cond) fails++; };
const BIG: BrainSpec = { v: 2, senses: { boundary: 4, landmark: 0, hd: 0, grid: 0, speed: 0 }, layers: [{ n: 7, fn: 'tanh' }] }; // 23.7%: past round 1's 20%
/** A round's race seed from the match seed (as ui/rounds draws it). */
const raceSeedOf = (match: number, round: number) => derive(match >>> 0, 0x50d5, round);
const km = (m: number) => { const v = (Math.abs(m) / 1000).toFixed(2); return `${m < 0 && v !== '0.00' ? '−' : ''}${v} km`; };
const NAME = 'Tester';
const NAMES = [NAME, ...CPU_NAMES];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const rounds = cpuRounds(cpuData), cpu1 = rounds[0].map((b) => b.genome), cpu5 = rounds[4].map((b) => b.genome);
  // round 1 trains the starting brain from scratch (phase 0 of the match's training seed)
  const trained = (await runPhase(new InlineExecutor(), defaultSpec(), SEED, { T, phase: 0 })).final;
  const node = runRace([trained, ...cpu1], raceSeedOf(MATCH, 1), undefined, ROUND_RACE);
  // a last round you lead: the strongest round-5 CPU brain as yours (search the first match seeds)
  const strong = cpu5[cpu5.length - 1];
  let WIN = -1;
  for (let s = 1; s <= 80 && WIN < 0; s++) if (runRace([strong, ...cpu5], raceSeedOf(s, 5), undefined, ROUND_RACE).ranking[0] === 0) WIN = s;
  check(WIN > 0, `a match seed where the strongest round-5 brain, raced as yours, leads round 5: ${WIN}`);

  // the wrong-way reset: each round-1 CPU brain alone from pole on ten race tracks, without it and with it (30 s)
  const W = CONFIG.match.wrongWayTicks;
  let bounded = true;
  const lines: string[] = [];
  rounds[0].forEach((b) => {
    const net = compile(b.genome), run = new Runner();
    let off = 0, on = 0;
    for (let s = 1; s <= 10; s++) {
      const t = generateTrack(raceTrackSeed(s), CONFIG.match.cars), o = { ticks: R.raceTicks, earlyStop: false };
      off += run.run(net, t, { ...o, start: gridCar(t, 0) }).prog;
      const r = run.run(net, t, { ...o, start: gridCar(t, 0), wrongWay: true });
      on += r.prog;
      bounded &&= r.prog > r.maxProg - (W / HZ) * CONFIG.car.wheelSpeed; // at most 3 s of reversing behind its best point
    }
    lines.push(`${b.name} ${Math.round(off / 10)}→${Math.round(on / 10)} m`);
  });
  check(bounded, `with the reset no CPU brain reverses more than 3 s behind its best point (mean 30 s without → with: ${lines.join(', ')})`);
  // a brain that drives backwards (every wheel's bias at the cap), raced as yours
  const back: Genome = defaultGenome();
  for (const o of OUTPUTS) back.w[biasIndex(back.spec, o.id)] = -CONFIG.brain.weightCap;
  const bw = runRace([back, ...cpu1], raceSeedOf(MATCH, 1), undefined, ROUND_RACE), bwRec = bw.cars[0].rec;
  const bwShow = bwRec.wrong.findIndex((w) => w >= HZ && w < W); // "Wrong way" showing: 1 s of falling progress
  const bwReset = bwRec.wrong.findIndex((w) => w >= W);
  check(bwShow > 0 && bwReset > bwShow && bw.cars[0].dist <= 0, `a backwards brain: falling 1 s at tick ${bwShow}, put back at tick ${bwReset}; ends at ${bw.cars[0].dist.toFixed(1)} m`);

  const server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
  await server.listen();
  const addr = server.httpServer?.address();
  if (!addr || typeof addr === 'string') throw new Error('no server address');
  const base = `http://127.0.0.1:${addr.port}/`;
  let browser: Browser;
  try { browser = await chromium.launch({ args: ARGS }); } catch { browser = await chromium.launch({ executablePath: CHROMIUM, args: ARGS }); }
  const errors: string[] = [];
  async function open(query: string, w = 1440, h = 900, save?: Genome): Promise<Page> {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 900, hasTouch: w < 900 });
    await fixtureBrain(ctx);
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(base);
    await page.evaluate(([k, v]) => { localStorage.setItem('synapse.notice', '3'); if (v) localStorage.setItem(k, v); },
      [SAVE_KEY, save ? serialize({ name: 'Test brain', genome: save, train: NO_TRAINING, trainer: 'evolution' }) : ''] as const);
    await page.goto(base + query);
    return page;
  }
  // as strings: the bundler's name helper isn't defined inside the page
  const race = (page: Page) => page.evaluate(`(() => { const r = window.__race; return r ? { state: r.state, raceSeed: r.raceSeed, hash: r.hash, names: r.names, slots: r.slots, results: r.results, place: r.place, t: r.t, end: r.end, frames: r.frames, go: r.go, countdownSeen: r.countdownSeen, listed: r.listed(), shown: r.shown(), drawn: r.drawn(), dots: r.dots() } : null; })()`) as Promise<{
    state: string; raceSeed: number; hash: string; names: string[]; slots: number[]; results: { name: string; place: number; dist: number }[];
    place: number; t: number; end: number; frames: number; go: boolean; countdownSeen: string[]; listed: string[]; shown: string[]; drawn: number[][]; dots: number;
  } | null>;
  const frames = async (page: Page, n = 2) => { const f = (await race(page))?.frames ?? 0; await page.waitForFunction((x) => (window.__race?.frames ?? 0) > x, f + n - 1, { timeout: 60_000 }); };
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  const pt = (page: Page) => page.evaluate(`(() => {
    const b = document.getElementById('phaseTimer'), q = b.getBoundingClientRect(), cs = getComputedStyle(b);
    return { ...window.__phase, shown: !b.hidden && q.width > 0, cx: (q.left + q.right) / 2, top: q.top, bottom: q.bottom, h: q.height, bg: cs.backgroundColor };
  })()`) as Promise<{ state: string; label: string; left: number; text: string; red: boolean; pulse: boolean; shown: boolean; cx: number; top: number; bottom: number; h: number; bg: string }>;
  /** Title → vs CPU → the settings screen → (your name if it isn't filled in, a map mode) → Start match → round 1's build. */
  const startCpu = async (page: Page, o: { mode?: 'family' | 'track'; family?: string; shuffle?: boolean } = {}) => {
    await page.click('#toCpu');
    await page.waitForSelector('#cpuSet:not([hidden])');
    if (!(await page.locator('#csName').inputValue())) await page.locator('#csName').fill(NAME);
    if (o.mode) {
      await page.click(`#csMap [data-mode="${o.mode}"]`);
      if (o.family) await page.click(`#csMap .tp-card[data-f="${o.family}"]`);
      if (o.shuffle) await page.click(`#csMap .tp-shuf[data-f="${o.family}"]`);
    }
    const map = await page.evaluate(() => window.__cpuSet!.map());
    await page.click('#csStart');
    await page.waitForFunction(() => window.__match?.phase === 'build', null, { timeout: 15_000 });
    return map!;
  };
  const standingsRows = (page: Page) => page.$$eval('#rcRows tr', (trs) => trs.map((t) => [...t.querySelectorAll('td')].map((d) => d.textContent ?? '')));

  try {
    // 0. every match starts on a fresh random brain (tracks-v2 plan): two starts, different valid starters within
    //    round 1's budget; the sandbox brain stays as it was
    {
      const p0 = await open(`?race=${MATCH}`);
      const before = await p0.evaluate((k) => localStorage.getItem(k), SAVE_KEY);
      const starts: Genome[] = [];
      for (let k = 0; k < 4 && (starts.length < 2 || JSON.stringify(starts[0].spec) === JSON.stringify(starts[starts.length - 1].spec)); k++) {
        await startCpu(p0);
        starts.push(await p0.evaluate(() => window.__designer!.genome()));
        await p0.click('#toTitle'); await p0.waitForSelector('#leaveDlg[open]'); await p0.click('#lvGo');
        await p0.waitForSelector('#title:not([hidden])');
      }
      const after = await p0.evaluate((k) => localStorage.getItem(k), SAVE_KEY), a = starts[0], b = starts[starts.length - 1];
      check(JSON.stringify(a.spec) !== JSON.stringify(b.spec) && starts.every((g) => isStarter(g) && energyRefusal(g.spec, CONFIG.rounds.budgets[0]) === null) && before === after && before !== null,
        `a match starts on a fresh random starter: ${starts.length} starts, ${starts.map((g) => Object.entries(g.spec.senses).filter(([, n]) => n).map(([s, n]) => `${n} ${s}`).join(' + ')).join(' | ')}; each valid and within round 1's budget; the sandbox brain untouched`);
      await p0.context().close();
    }

    // 0b. the settings screen (tracks-v2 T2): no designer; a name is required, remembered; Main menu; the map modes
    {
      const ps = await open(`?race=${MATCH}`, 844, 390);
      await ps.click('#toCpu');
      await ps.waitForSelector('#cpuSet:not([hidden])');
      const st0 = await ps.evaluate(() => ({ app: !(document.querySelector('.app') as HTMLElement).hidden, title: !(document.getElementById('title') as HTMLElement).hidden, phase: window.__match!.phase, name: (document.getElementById('csName') as HTMLInputElement).value,
        start: (document.getElementById('csStart') as HTMLButtonElement).disabled, map: window.__cpuSet!.map(), modes: [...document.querySelectorAll('#csMap [data-mode]')].map((b) => `${b.textContent}${b.getAttribute('aria-checked') === 'true' ? '*' : ''}`) }));
      check(!st0.app && !st0.title && st0.phase === 'none' && st0.name === '' && st0.start && st0.map?.mode === 'each' && st0.modes.join(', ') === 'New track each round*, One family, One track',
        `title → vs CPU: the settings screen, no designer and no match yet; no name yet, so Start match waits; Map: ${st0.modes.join(', ')}`);
      const fit = await ps.evaluate(`(() => { const on = (q) => { const r = document.querySelector(q).getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5; };
        return ['#csName', '#csStart', '#csMenu', '#csMap .tp-modes'].every(on) && document.documentElement.scrollWidth <= innerWidth; })()`) as boolean;
      check(fit, '844×390: the name, Main menu, Start match and the map modes on screen, no sideways scroll');
      await ps.locator('#csName').fill('   ');
      const blank = await ps.evaluate(() => ({ v: (document.getElementById('csName') as HTMLInputElement).value, start: (document.getElementById('csStart') as HTMLButtonElement).disabled, why: document.getElementById('csErr')!.textContent }));
      await ps.locator('#csName').fill('');
      await ps.locator('#csName').pressSequentially('Ada   Lovelace Byron King');
      const long = await ps.evaluate(() => ({ v: (document.getElementById('csName') as HTMLInputElement).value, count: document.getElementById('csCount')!.textContent, start: (document.getElementById('csStart') as HTMLButtonElement).disabled }));
      check(blank.v === '' && blank.start && /Type your name/.test(blank.why ?? '') && long.v === 'Ada Lovelace Byr' && long.count === '16 / 16' && !long.start,
        `the name is required: spaces alone don't count ("${blank.why}"); spaces collapse and it stops at 16 ("${long.v}", ${long.count}), then Start match is on`);
      // One family: a new clover each round
      await ps.click('#csMap [data-mode="family"]');
      await ps.click('#csMap .tp-card[data-f="clover"]');
      const fam = await ps.evaluate(() => ({ map: window.__cpuSet!.map()!, shuf: [...document.querySelectorAll('#csMap .tp-shuf')].some((b) => !(b as HTMLElement).hidden), name: document.querySelector('#csMap .tp-name')!.textContent }));
      await ps.screenshot({ path: `${OUT}/settings-family-844x390.png` });
      await ps.locator('#csName').fill('Ada');
      await ps.click('#csStart');
      await ps.waitForFunction(() => window.__match?.phase === 'build', null, { timeout: 15_000 });
      const m1 = await ps.evaluate(() => ({ map: window.__match!.map, tracks: window.__match!.tracks, seed: window.__match!.seed, names: window.__match!.names, stored: localStorage.getItem('synapse.name'), app: !(document.querySelector('.app') as HTMLElement).hidden, set: !(document.getElementById('cpuSet') as HTMLElement).hidden }));
      const want1 = [1, 2, 3, 4, 5].map((n) => roundTrackSeed(raceSeedOf(m1.seed, n), m1.map!));
      check(fam.map.mode === 'family' && fam.map.family === 'clover' && !fam.shuf && m1.map?.mode === 'family' && JSON.stringify(m1.tracks) === JSON.stringify(want1) && m1.tracks.every((x) => familyOf(x) === 'clover') && new Set(m1.tracks).size === 5,
        `"One family" (Clover; no Shuffle): Start match → each round a new clover track (= Node roundTrackSeed: ${m1.tracks.join(', ')})`);
      check(m1.app && !m1.set && m1.names[0] === 'Ada' && m1.stored === 'Ada', `Start match: round 1's build in the designer; you race as "${m1.names[0]}", remembered as synapse.name`);
      await ps.click('#toTitle'); await ps.waitForSelector('#leaveDlg[open]'); await ps.click('#lvGo');
      await ps.waitForSelector('#title:not([hidden])');
      // next time: the name filled in; One track: a shuffled loop for all five rounds; the default's tracks
      await ps.reload();
      await ps.waitForSelector('#title:not([hidden])');
      await ps.click('#toCpu');
      const again = await ps.evaluate(() => ({ name: (document.getElementById('csName') as HTMLInputElement).value, start: (document.getElementById('csStart') as HTMLButtonElement).disabled }));
      await ps.click('#csMap [data-mode="track"]');
      await ps.click('#csMap .tp-card[data-f="loop"]');
      const before = await ps.evaluate(() => window.__cpuSet!.map()!);
      await ps.click('#csMap .tp-shuf[data-f="loop"]');
      const tr = await ps.evaluate(() => ({ map: window.__cpuSet!.map()!, len: document.querySelector('#csMap .tp-len')!.textContent, feat: document.querySelector('#csMap .tp-feat')!.textContent }));
      const tt = generateTrack(tr.map.seed);
      check(again.name === 'Ada' && !again.start && tr.map.mode === 'track' && tr.map.seed !== before.seed && familyOf(tr.map.seed) === 'loop' && tr.len === `${(tt.len / 1000).toFixed(2)} km` && (tr.feat ?? '').length > 0,
        `next visit: "${again.name}" filled in, Start match ready; "One track": Shuffle draws another loop (seed ${tr.map.seed}, ${tr.len}, ${tr.feat})`);
      await ps.screenshot({ path: `${OUT}/settings-track-844x390.png` });
      await ps.click('#csStart');
      await ps.waitForFunction(() => window.__match?.phase === 'build', null, { timeout: 15_000 });
      const m2 = await ps.evaluate(() => ({ tracks: window.__match!.tracks }));
      check(m2.tracks.length === 5 && m2.tracks.every((x) => x === tr.map.seed), `"One track": all five rounds on seed ${tr.map.seed}`);
      await ps.click('#toTitle'); await ps.waitForSelector('#leaveDlg[open]'); await ps.click('#lvGo');
      await ps.click('#toCpu');
      await ps.click('#csMap [data-mode="each"]');
      await ps.click('#csStart');
      await ps.waitForFunction(() => window.__match?.phase === 'build', null, { timeout: 15_000 });
      const m3 = await ps.evaluate(() => ({ tracks: window.__match!.tracks, seed: window.__match!.seed }));
      check(JSON.stringify(m3.tracks) === JSON.stringify([1, 2, 3, 4, 5].map((n) => raceTrackSeed(raceSeedOf(m3.seed, n)))), '"New track each round": each round\'s race seed\'s own track (as before T2)');
      await ps.click('#toTitle'); await ps.waitForSelector('#leaveDlg[open]'); await ps.click('#lvGo');
      await ps.click('#toCpu');
      await ps.click('#csMenu');
      check(await ps.locator('#title').isVisible() && await ps.locator('#cpuSet').isHidden(), 'the settings screen\'s Main menu: back to the title');
      await ps.context().close();
    }

    // 1. the round 1 build: the timer, the budget, a design past it
    let page = await open(`?seed=${SEED}&T=${T}&race=${MATCH}&starter=default`); // the fixture brain, as Node's runs
    await startCpu(page);
    const m0 = await page.evaluate(() => window.__match!);
    let bt = await pt(page);
    const lay0 = await page.evaluate(() => { const a = document.querySelector('.app')!.getBoundingClientRect(), t = document.querySelector('.app .top')!.getBoundingClientRect(); return { cx: (a.left + a.right) / 2, topBottom: t.bottom, row: t.height, appTop: a.top, appH: a.height }; });
    check(m0.phase === 'build' && m0.round === 1 && bt.state === 'running' && bt.shown && bt.label === 'Round 1 of 5 · Build' && bt.text === '60' && bt.bg === 'rgb(255, 194, 26)' && !bt.red
      && Math.abs(bt.cx - lay0.cx) < 2 && bt.top >= lay0.topBottom - 0.5 && (bt.top - lay0.appTop) / lay0.appH < 0.2 && bt.h >= lay0.row,
      `vs CPU starts round 1 of 5 in the designer: "${bt.label}" ${bt.text}, vs CPU yellow, top centre under the top bar, ${bt.h.toFixed(0)} px tall (Train's row ${lay0.row.toFixed(0)} px)`);
    const alloc = await page.locator('#aBrain').innerText();
    check(/ of 20%$/.test(alloc) && JSON.stringify(await page.evaluate(() => window.__designer!.spec())) === JSON.stringify(defaultSpec()), `round 1 starts from the starting brain; the energy bar's full scale is round 1's budget ("Brain ${alloc}")`);
    await page.screenshot({ path: `${OUT}/build-60.png` });
    // the timer grows the rule strip and so shrinks the board without the window resizing: the diagram (and the 3-D
    // symbols drawn at its positions) must re-lay out to the board's new size, or the symbols sit off their circles
    await page.waitForTimeout(300);
    const fitB = await page.evaluate(`(() => { const b = document.getElementById('board'); return { vb: document.getElementById('net').getAttribute('viewBox'), size: '0 0 ' + b.clientWidth + ' ' + b.clientHeight }; })()`) as { vb: string; size: string };
    check(fitB.vb === fitB.size, `the diagram fits the board after the timer grows the rule strip (viewBox ${fitB.vb}, board ${fitB.size})`);
    check(await page.locator('#train').isHidden() && await page.locator('#rcSkip').count() === 0, 'vs CPU: no Train button in the designer and no Skip anywhere (only the timers move a match on)');
    await page.evaluate(() => window.__phase!.skipTo(9.5));
    bt = await pt(page);
    check(bt.text === '10' && bt.red && bt.bg === 'rgb(217, 70, 91)' && !bt.pulse, `the last 10 s: red (${bt.text}, ${bt.bg}), no pulse yet`);
    await page.screenshot({ path: `${OUT}/build-red.png` });
    const p5 = await page.evaluate(() => { window.__phase!.skipTo(4.5); return { pulse: window.__phase!.pulse, text: window.__phase!.text, sfx: window.__audio!.liveSfx, audio: window.__audio!.state }; });
    check(p5.text === '5' && p5.pulse && (p5.audio !== 'running' || p5.sfx > 0), `the last 5 s: pulses, and ticks on the effects bus (audio ${p5.audio}, ${p5.sfx} effect sounding)`);
    // a design past the budget when time runs out: it says why, and training starts as soon as an edit brings it within
    await page.evaluate((g) => window.__designer!.load(g), zeroGenome(BIG));
    await page.evaluate(() => window.__phase!.skipTo(0.2));
    await page.waitForFunction(() => window.__phase?.state === 'up', null, { timeout: 5000 });
    const up = await page.evaluate(() => ({ text: window.__phase!.text, designer: !(document.querySelector('.app') as HTMLElement).hidden }));
    await page.screenshot({ path: `${OUT}/build-up.png` });
    check(up.text === 'Time’s up' && up.designer, `at 0: "${up.text}" over the designer`);
    await page.waitForTimeout(1200);
    const toast = await page.locator('#toast').innerText();
    check(await page.evaluate(() => window.__match!.phase === 'build') && await page.locator('#arena').isHidden() && /this round allows 20%/.test(toast), `a design past round 1's budget doesn't train at 0 ("${toast}")`);
    await page.evaluate((g) => window.__designer!.load(g), defaultGenome());

    // 2. training: started by the timer, 10 s, no buttons; the trained brain = Node
    await page.waitForFunction(() => window.__training?.state === 'running' || window.__training?.state === 'done', null, { timeout: 30_000 });
    const tr = await page.evaluate(() => ({ T: window.__training!.T, start: window.__training!.start, phase: window.__training!.phase, popup: (document.getElementById('trainDlg') as HTMLDialogElement).open,
      btns: ['tvStop', 'tvRace', 'tvBack', 'tvDrive', 'tvAgain'].filter((id) => !(document.getElementById(id) as HTMLElement).hidden), menu: !(document.getElementById('tvMenu') as HTMLElement).hidden }));
    bt = await pt(page);
    check(!tr.popup && tr.T === T && tr.start === 'fresh' && tr.phase === 0 && tr.btns.length === 0 && tr.menu && bt.label === 'Round 1 of 5 · Train' && Number(bt.text) <= 20 && Number(bt.text) >= 17,
      `Train starts itself: no popup, the budget (T ${tr.T}, ${tr.start}, phase ${tr.phase}), "${bt.label}" ${bt.text}, no buttons but Main menu (${tr.btns.join(' ') || 'none'})`);
    // the generation goes into the round's timer as "gen n"; nothing on the camera overlaps the timer
    await page.waitForFunction(() => (window.__training?.shownGen ?? 0) > 0, null, { timeout: 300_000 });
    await page.waitForTimeout(300);
    const gl = await page.evaluate(`(() => {
      const t = document.getElementById('phaseTimer').getBoundingClientRect(), sub = document.getElementById('ptSub');
      const apart = (a, b) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
      const others = [...document.querySelectorAll('#trainOverlay .tv-cam > *')].filter((e) => e.offsetParent && e.textContent.trim() !== '').map((e) => e.getBoundingClientRect());
      return { sub: sub.hidden ? '' : sub.textContent, big: document.getElementById('tvBig').textContent, shown: window.__training.shownGen, clear: others.every((r) => apart(t, r)) };
    })()`) as { sub: string; big: string; shown: number; clear: boolean };
    check(gl.sub === `gen ${gl.shown}` && gl.big === '' && gl.clear, `while the round's timer shows, the generation is in it ("${gl.sub}"), not under it; nothing on the camera overlaps the timer`);
    await page.waitForFunction(() => window.__training?.state === 'done', null, { timeout: 300_000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/train.png` });
    const tmid = await page.evaluate(() => ({ phase: window.__match!.phase, left: window.__phase!.left, red: window.__phase!.red, trained: window.__match!.trained }));
    check(tmid.trained !== null && genomeHash(tmid.trained) === genomeHash(trained), `the trained brain = Node's run of the same design, seed and budget (${genomeHash(trained)})`);
    check(tmid.phase === 'train' || tmid.phase === 'race', `training done early: the view holds until the 20 s are up (${tmid.left} s left${tmid.red ? ', red' : ''})`);
    await page.evaluate(() => window.__phase?.state === 'running' && window.__phase.skipTo(0.2));

    // 3. the race: grid, countdown, then 30 s
    await page.waitForFunction(() => window.__match?.phase === 'race' && (window.__race?.frames ?? 0) > 1, null, { timeout: 60_000 });
    let r = (await race(page))!;
    check(r.raceSeed === raceSeedOf(MATCH, 1) && r.hash === node.hash, `race hash ${r.hash} = Node runRace (30 s, round 1's CPU brains) ${node.hash}`);
    check(JSON.stringify(r.names) === JSON.stringify(NAMES), `ten players: ${r.names.join(', ')}`);
    check(JSON.stringify(r.results.map((x) => x.name)) === JSON.stringify(node.ranking.map((k) => NAMES[k])), `ranking by signed distance = Node: ${r.results.map((x) => x.name).join(' > ')}`);
    if (!r.go) {
      const bySlot = r.names.map((n, k) => [r.slots[k], n] as const).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
      check(JSON.stringify(r.listed) === JSON.stringify(bySlot) && (await page.locator('#rcListH').innerText()) === 'GRID', `before Go the players are listed in grid order: ${r.listed.join(', ')}`);
      const gridOk = r.drawn.length === 10 && r.drawn.every((p, k) => { const g = gridCar(node.track, node.cars[k].slot); return near(p[0], g.x) && near(p[2], -g.y); });
      check(gridOk && r.drawn[0][3] === 1, 'ten cars on the grid, each where the sim puts its slot (two by two behind the line)');
      await page.screenshot({ path: `${OUT}/grid.png` });
      const ga = await page.evaluate(() => window.__race!.auditAt(0));
      check(ga.over === 0, `bloom audit on the grid: ${ga.over} over (max ${ga.max.toFixed(2)})`);
    } else check(false, 'the race view opened before Go (the grid could not be checked)');
    await page.waitForFunction(() => window.__race?.go === true, null, { timeout: 60_000 });
    r = (await race(page))!;
    bt = await pt(page);
    // (the grid's bloom audit above brings Go forward and takes a while on SwiftShader: the race timer has been running since)
    check(r.countdownSeen.slice(0, 6).join(' ') === '5 4 3 2 1 Go' && bt.label === 'Round 1 of 5 · Race' && Number(bt.text) > 0 && Number(bt.text) <= 30, `countdown ${r.countdownSeen.join(' ')}, then at Go "${bt.label}" (${bt.text} s left now)`);

    // the broadcast camera from Go (follow-a-racer plan): a shot holds at least 3 s unless the car leaves the frame
    const camGo = await page.evaluate(() => window.__race!.cam().mode);
    await page.waitForFunction(() => (window.__race?.t ?? 0) >= 10, null, { timeout: 120_000, polling: 200 });
    const cuts = await page.evaluate(() => window.__race!.cam().cuts);
    const quick = cuts.filter((c, i) => i > 0 && c.why === 'spot' && c.t - cuts[i - 1].t < 3 - 1e-6);
    check(camGo === 'tv' && cuts.length >= 1 && quick.length === 0,
      `the race camera is broadcast after Go; ${cuts.length} shots in the first 10 s, cut ${cuts.map((c) => `${c.why}@${c.t.toFixed(1)}`).join(' ')}: none sooner than 3 s after the last unless the car left the frame`);
    await page.screenshot({ path: `${OUT}/broadcast.png` });

    // 4. mid-race: every car where Node has it, the sidebar, the brain card
    await page.evaluate(() => window.__race!.seek(20));
    await frames(page, 2);
    r = (await race(page))!;
    const posOk = r.drawn.every((p, k) => {
      const c = node.cars[k].rec, kf = r.t * HZ - 1, j = Math.floor(kf), b = j + 1, u = c.wrong[b] >= W ? 0 : kf - j;
      return near(p[0], c.x[j] + (c.x[b] - c.x[j]) * u) && near(p[2], -(c.y[j] + (c.y[b] - c.y[j]) * u));
    });
    check(posOk && r.dots === 10 && r.t >= 20, `at ${r.t.toFixed(2)} s every car is drawn where Node's race has it, and ten dots on the map`);
    const side = await page.evaluate(`(() => {
      const q = (s) => document.querySelector(s).getBoundingClientRect(), side = q('.rc-side'), list = q('#rcList'), map = q('#rcMap'), brain = q('#rcBrainC'), scene = q('#scene');
      const inS = (b) => b.left >= side.left - 0.5 && b.right <= side.right + 0.5 && b.top >= side.top - 0.5 && b.bottom <= side.bottom + 0.5;
      return { w: side.width / innerWidth, list: inS(list), map: inS(map) && map.top >= list.bottom && map.height > 40, brain: brain.width > 0 && Math.abs(brain.right - (innerWidth - 10)) < 1.5 && brain.left > side.right,
        scene: Math.abs(scene.left - side.right) < 1, rows: document.querySelectorAll('#rcList li:not(.gap)').length, lap: document.getElementById('rcLapK').textContent, dist: document.getElementById('rcLap').textContent,
        panel: !!document.querySelector('#raceOverlay > .rc-status') };
    })()`) as { w: number; list: boolean; map: boolean; brain: boolean; scene: boolean; rows: number; lap: string; dist: string; panel: boolean };
    check(Math.abs(side.w - 0.25) < 0.002 && side.list && side.map && side.scene && !side.panel && side.rows === 10, `the sidebar is a quarter of the width: status, the racers list (${side.rows} rows) and the map under it; the camera fills the rest; no floating panel`);
    check(side.brain, 'your live brain in the camera\'s bottom-right corner');
    check(side.lap === 'Distance' && /km$/.test(side.dist) && (await page.locator('#rcListH').innerText()) === 'STANDINGS' && [...r.listed].sort().join() === [...r.names].sort().join(), `a timed race shows your distance (${side.dist}) and the standings`);
    await page.screenshot({ path: `${OUT}/race-20s.png` });

    // following a CPU racer (follow-a-racer plan): its row, then the keyboard, then Back to my car
    await page.evaluate(() => { window.__race!.hold = true; });
    const fr = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#rcList li:not(.gap):not(.you) button')].map((b) => Number(b.dataset.k)));
    const fk = fr[0], fk2 = fr[1];
    await page.click(`#rcList button[data-k="${fk}"]`);
    await frames(page, 3);
    const fol = async () => page.evaluate(`(() => { const r = window.__race, t = r.t; return { k: r.following(), title: r.cardTitle(), vals: r.cardVals(), own: r.ownVals(), look: r.lookOff(), main: r.drawn()[0], t,
      outlined: [...document.querySelectorAll('#rcList li.followed span')].map((e) => e.textContent), you: document.querySelector('#rcList li.you span')?.textContent ?? '', mine: !document.getElementById('rcMine').hidden,
      card: !document.getElementById('rcBrainC').hidden, pos: document.getElementById('rcPos').textContent }; })()`) as Promise<{ k: number; title: string; vals: number[] | null; own: number[] | null; look: number; main: number[]; t: number; outlined: string[]; you: string; mine: boolean; card: boolean; pos: string }>;
    const f1 = await fol();
    // the card's values this frame = Node's replay of that car alone at the same tick
    const replay = (k: number, t: number) => { const rec = recordCar(k === 0 ? trained : cpu1[k - 1], node.track, node.cars[k].slot, ROUND_RACE), nN = compile(k === 0 ? trained : cpu1[k - 1]).nNodes, b = Math.min(Math.floor(t * HZ - 1) + 1, rec.ticks - 1); return Array.from(rec.act.subarray(b * nN, (b + 1) * nN)); };
    const close = (a: number[] | null, b: number[]) => !!a && a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-9);
    check(f1.k === fk && f1.title === `Brain · ${NAMES[fk]}` && close(f1.vals, replay(fk, f1.t)) && JSON.stringify(f1.vals) !== JSON.stringify(f1.own) && f1.main[4] === fk && f1.look < 3
      && JSON.stringify(f1.outlined) === JSON.stringify([NAMES[fk]]) && f1.you === NAME && f1.mine && f1.card && /^\d+(st|nd|rd|th) of 10$/.test(f1.pos),
      `click ${NAMES[fk]}'s row: the camera follows that car (aim ${f1.look.toFixed(2)} m off it), the card reads "${f1.title}" with its brain firing as Node's replay of it, not yours; its row outlined, yours still marked; "Back to my car" shows; Position stays yours (${f1.pos})`);
    await page.screenshot({ path: `${OUT}/follow-cpu.png` });
    await page.focus(`#rcList button[data-k="${fk2}"]`);
    await page.keyboard.press('Space');
    await frames(page, 2);
    const f2 = await fol();
    check(f2.k === fk2 && f2.title === `Brain · ${NAMES[fk2]}`, `keyboard: Space on ${NAMES[fk2]}'s row follows them ("${f2.title}")`);
    await page.click('#rcMine');
    await frames(page, 3);
    const f3 = await fol();
    check(f3.k === 0 && f3.title === 'Brain · live' && close(f3.vals, f3.own ?? []) && f3.main[4] === 0 && !f3.mine && f3.outlined.length === 0 && f3.look < 3,
      '"Back to my car": the camera and the card are yours again, and the button goes');
    await page.evaluate(() => { window.__race!.hold = false; });
    const pr = await page.evaluate(() => window.__race!.probe!());
    check(pr.mean > 20 && pr.sd > 8, `render smoke: mean ${pr.mean.toFixed(1)}, spread ${pr.sd.toFixed(1)}`);
    for (const t of [10, 25]) {
      const a = await page.evaluate((x) => window.__race!.auditAt(x), t);
      check(a.over === 0, `bloom audit at ${t} s: ${a.over} over (max ${a.max.toFixed(2)})`);
    }

    // 5. the standings after round 1, then round 2's build with the brain carried over
    await page.evaluate(() => window.__race!.seek(1e9)); // to the end (vs CPU has no Skip)
    await page.waitForFunction(() => window.__match?.phase === 'standings', null, { timeout: 30_000, polling: 100 });
    // the standings show for 8 s, less than this check's reading and screenshots take on SwiftShader: read the timer,
    // then hold it (a check hook) until the check moves it on
    const st8 = await page.evaluate(() => { const p = window.__phase!, r = { label: p.label, text: p.text, again: !(document.getElementById('rcAgain') as HTMLElement).hidden, back: !(document.getElementById('rcBack') as HTMLElement).hidden }; p.skipTo(600); return r; });
    await frames(page, 2);
    const rows = await standingsRows(page), d = node.cars.map((c) => c.dist);
    const ordr = NAMES.map((_, k) => k).sort((a, b) => d[b] - d[a] || a - b);
    const want = ordr.map((k, i) => [String(i + 1), NAMES[k], km(d[k]), km(d[k])]);
    check(JSON.stringify(rows) === JSON.stringify(want) && (await page.locator('#rcResT').innerText()) === 'Round 1 of 5 · Standings' && (await page.locator('#rcHead').innerText()).replace(/\s+/g, ' ').trim() === 'PLACE NAME ROUND 1 TOTAL',
      `standings: race and total distance (signed) = Node: ${rows.map((x) => `${x[1]} ${x[3]}`).join(' | ')}`);
    check(st8.label === 'Round 2 of 5 in' && Number(st8.text) <= 8 && Number(st8.text) >= 6 && !st8.again && !st8.back, `"${st8.label}" ${st8.text}, and no buttons: the timer moves on`);
    // the panel sits below the round's timer: title and headers on view, your row too
    const sl = await page.evaluate(STANDINGS_LAYOUT) as StandingsLayout;
    await page.setViewportSize({ width: 844, height: 390 });
    await frames(page, 2);
    const slp = await page.evaluate(STANDINGS_LAYOUT) as StandingsLayout;
    await page.screenshot({ path: `${OUT}/standings-844x390.png` });
    await page.setViewportSize({ width: 1440, height: 900 });
    await frames(page, 2);
    check(standingsClear(sl, 10) && standingsClear(slp, 10) && sl.places.join(' ') === '1 2 3 4 5 6 7 8 9 10' && sl.you !== null,
      `vs CPU's standings: all 10 rows (${sl.places.join(' ')}; you ${sl.you}), clear of the round's timer (${sl.gap.toFixed(0)} px below it at 1440×900, ${slp.gap.toFixed(0)} px at 844×390), title and headers on view, nothing scrolls`);
    await page.screenshot({ path: `${OUT}/standings.png` });
    await page.evaluate(() => window.__phase!.skipTo(0.1));
    await page.waitForFunction(() => window.__match?.phase === 'build' && window.__match.round === 2, null, { timeout: 10_000, polling: 100 });
    bt = await pt(page);
    const g2 = await page.evaluate(() => window.__designer!.genome());
    check(bt.label === 'Round 2 of 5 · Build' && Number(bt.text) <= 20 && Number(bt.text) >= 19 && /of 28%$/.test(await page.locator('#aBrain').innerText())
      && JSON.stringify(g2.spec) === JSON.stringify(trained.spec) && g2.w.every((x) => x === 0),
      `after 8 s: "${bt.label}" ${bt.text}, the budget 28%; round 1's design carries over with fresh weights, biases and fields (match-flow v2)`);
    // an upgrade keeps the trained weights: one more boundary cell
    await page.click('#tray [data-s="boundary"]');
    const g3 = await page.evaluate(() => window.__designer!.genome());
    const net3 = compile(g3), dirs = [net3.tune[0], net3.tune[4]];
    check(g3.spec.senses.boundary === 2 && g3.w.every((x) => x === 0) && dirs[0] === -30 && dirs[1] === 30, `an upgrade (another wall cell): still untrained; the wall cells re-spread to the table for two (${dirs.join('°, ')}°)`);
    await page.screenshot({ path: `${OUT}/build-round2.png` });
    await page.click('#toTitle');
    await page.click('#lvGo');
    check(await page.locator('#title').isVisible() && await page.evaluate(() => window.__phase!.state === 'off' && window.__match!.phase === 'none'), 'Main menu → Leave: back to the title, the match and its timer gone');
    await page.context().close();

    // 5b. without ?T= a round trains on the round's budget: T = the full-skill CPU's (CONFIG.rounds.T), all of it if time allows
    page = await open(`?seed=${SEED}&race=${MATCH}&starter=default`);
    await startCpu(page);
    await page.evaluate(() => window.__phase!.skipTo(0.1));
    await page.waitForFunction(() => window.__training?.state === 'running', null, { timeout: 30_000 });
    const real0 = await page.evaluate(() => ({ T: window.__training!.T, gens: window.__training!.generations }));
    await page.waitForFunction(() => window.__training?.state === 'done', null, { timeout: 300_000 });
    const real = await page.evaluate(() => ({ gen: window.__training!.gen, used: window.__training!.ticksUsed, ms: window.__training!.ms ?? 0, workers: window.__training!.workers }));
    check(real0.T === CONFIG.rounds.T && real0.T === rounds[0][8].budget && real.used >= 0.97 * real0.T && real.gen >= 50,
      `a round's training (no ?T): T ${real0.T.toLocaleString('en')} = the full-skill CPU's budget; ${real.gen} generations (estimate ${real0.gens}), ${real.used.toLocaleString('en')} car-ticks, ${(real.ms / 1000).toFixed(1)} s on ${real.workers} workers here (SwiftShader container)`);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/train-full-T.png` });
    await page.context().close();
    // 5c. the hard stop: when the train timer reaches 0, training stops where it got to and keeps the best so far (on
    //     "One track": the round's race runs on the track chosen)
    page = await open(`?seed=${SEED}&race=${MATCH}&starter=default`);
    const one = await startCpu(page, { mode: 'track', family: 'hairpin', shuffle: true });
    await page.evaluate(() => window.__phase!.skipTo(0.1));
    await page.waitForFunction(() => (window.__training?.gen ?? 0) >= 3, null, { timeout: 120_000 });
    await page.evaluate(() => window.__phase!.skipTo(0.1));
    await page.waitForFunction(() => window.__match?.phase === 'race', null, { timeout: 60_000 });
    const hs = await page.evaluate(() => ({ st: window.__training!.state, saved: window.__training!.savedOnStop, gen: window.__training!.gen, trained: window.__match!.trained }));
    check(hs.st === 'stopped' && hs.saved === true && hs.trained !== null && hs.trained.w.some((x) => x !== 0), `time up mid-training: it stops at gen ${hs.gen} with the best so far, and the race starts on time`);
    await page.waitForFunction(() => (window.__race?.frames ?? 0) > 0, null, { timeout: 60_000 });
    const onTrack = await page.evaluate(() => ({ seed: window.__race!.trackSeed, family: window.__race!.family, tracks: window.__match!.tracks }));
    check(one.mode === 'track' && onTrack.seed === one.seed && onTrack.family === 'hairpin' && onTrack.tracks.every((x) => x === one.seed),
      `"One track" (a shuffled hairpin, seed ${one.seed}): round 1's race runs on it (${onTrack.seed}, ${onTrack.family}), and so would every round`);
    await page.context().close();

    // 6. the last round, which you lead: the final standings and the winner music
    const nw = runRace([strong, ...cpu5], raceSeedOf(WIN, 5), undefined, ROUND_RACE);
    page = await open(`?view=race&race=${WIN}&round=5`, 1440, 900, strong);
    await page.waitForFunction(() => (window.__race?.frames ?? 0) > 1, null, { timeout: 60_000 });
    r = (await race(page))!;
    check(r.hash === nw.hash && r.place === 1, `round 5's race (hash = Node), you first`);
    await page.click('#rcState').catch(() => undefined);
    await page.waitForFunction(() => window.__audio?.ready === true && (window.__audio?.winnerS ?? 0) > 0, null, { timeout: 60_000 });
    await page.evaluate(() => window.__race!.seek(1e9));
    await page.waitForFunction(() => window.__match?.phase === 'over', null, { timeout: 30_000 });
    await page.waitForFunction(() => window.__audio?.phrase === 'winner', null, { timeout: 5000 }).catch(() => undefined);
    const fin = await page.evaluate(() => ({ t: document.getElementById('rcResT')!.textContent, again: document.getElementById('rcAgain')!.textContent, back: document.getElementById('rcBack')!.textContent, backOn: !(document.getElementById('rcBack') as HTMLElement).hidden, phrase: window.__audio!.phrase, timer: window.__phase!.state }));
    check(fin.t === 'You won the match!' && fin.again === 'Play again' && fin.back === 'Main menu' && fin.backOn && fin.timer === 'off', `the final standings: "${fin.t}", Play again and Main menu (the match is over; no next-round timer)`);
    check(fin.phrase === 'winner', `the winner music plays (${fin.phrase})`);
    await frames(page, 2);
    await page.screenshot({ path: `${OUT}/final.png` });
    await page.click('#rcAgain');
    await page.waitForSelector('#cpuSet:not([hidden])');
    check(await page.locator('#arena').isHidden() && await page.locator('.app').isHidden() && await page.evaluate(() => window.__match!.phase === 'none'), 'Play again: back to the settings screen (no designer until Start match)');
    await page.click('#csMenu');
    check(await page.locator('#title').isVisible(), 'its Main menu: the title');
    await page.context().close();

    // 7. the wrong-way reset in the page: your backwards car; its distance is signed
    page = await open(`?view=race&race=${MATCH}&round=1`, 1440, 900, back);
    await page.waitForFunction(() => (window.__race?.frames ?? 0) > 1, null, { timeout: 60_000 });
    await page.evaluate(() => { window.__race!.hold = true; });
    r = (await race(page))!;
    check(r.hash === bw.hash && await page.locator('#rcWrong').isHidden(), `backwards brain: race hash = Node ${bw.hash}; no "Wrong way" on the grid`);
    const wrongAt = async (tick: number) => {
      await page.evaluate((x) => window.__race!.seek(x), (tick + 1.5) / HZ);
      await frames(page, 3);
      return page.evaluate(`(() => { const e = document.getElementById('rcWrong'), q = e.getBoundingClientRect(), s = document.getElementById('scene').getBoundingClientRect(); return { on: window.__race.wrongWay, shown: !e.hidden && q.width > 0, x: ((q.left + q.right) / 2 - s.left) / s.width, y: (q.bottom - s.top) / s.height, text: e.textContent, drawn: window.__race.drawn()[0] }; })()`) as Promise<{ on: boolean; shown: boolean; x: number; y: number; text: string; drawn: number[] }>;
    };
    const ww = await wrongAt(bwShow + 5);
    check(ww.on && ww.shown && ww.text === 'Wrong way' && Math.abs(ww.x - 0.5) < 0.1 && ww.y > 0.2 && ww.y < 0.75, `"Wrong way" flashes over your car while it goes backwards (label at ${(ww.x * 100).toFixed(0)}% across the camera, bottom ${(ww.y * 100).toFixed(0)}% down)`);
    await page.screenshot({ path: `${OUT}/wrong-way.png` });
    const pb = await wrongAt(bwReset - 0.499);
    const cm = (a: number, b: number) => Math.abs(a - b) < 0.05;
    check(pb.on && cm(pb.drawn[0], bwRec.x[bwReset]) && cm(pb.drawn[2], -bwRec.y[bwReset]) && bwRec.v[bwReset] === 0, `put back at tick ${bwReset}: drawn where the sim put it (at rest), still flashing "Wrong way"`);
    await page.evaluate(() => { window.__race!.hold = false; });
    await page.evaluate(() => window.__race!.seek(1e9));
    await page.waitForFunction(() => window.__match?.phase === 'standings', null, { timeout: 30_000 });
    const mine = await page.$eval('#rcRows tr.you td:nth-child(3)', (td) => td.textContent);
    check(mine === km(bw.cars[0].dist) && await page.locator('#rcWrong').isHidden(), `standings: your backwards car's distance is signed (${mine}); no "Wrong way" over them`);
    await page.context().close();

    // 8. landscape phone: the sidebar and the standings on screen and apart
    page = await open(`?view=race&race=${MATCH}&round=1`, 844, 390, trained);
    await page.waitForFunction(() => (window.__race?.frames ?? 0) > 1, null, { timeout: 60_000 });
    const lay = await page.evaluate(`(() => {
      const q = (s) => document.querySelector(s).getBoundingClientRect(), on = (b) => b.left >= -0.5 && b.top >= -0.5 && b.right <= innerWidth + 0.5 && b.bottom <= innerHeight + 0.5;
      const side = q('.rc-side'), st = q('.rc-status'), map = q('#rcMap'), brain = q('#rcBrainC');
      return { side: Math.abs(side.width - innerWidth / 4) < 1.5 && on(side), st: on(st), map: on(map) && map.top >= st.bottom - 0.5, apart: brain.left >= side.right, sw: document.documentElement.scrollWidth <= document.documentElement.clientWidth };
    })()`) as { side: boolean; st: boolean; map: boolean; apart: boolean; sw: boolean };
    check(lay.side && lay.st && lay.map && lay.apart && lay.sw, `844×390: the sidebar a quarter wide with the status, list and map on screen; the brain card apart; no sideways scroll (${JSON.stringify(lay)})`);
    await page.screenshot({ path: `${OUT}/race-844x390.png` });
    await page.evaluate(() => window.__race!.seek(1e9));
    await page.waitForFunction(() => window.__match?.phase === 'standings', null, { timeout: 30_000 });
    check(await page.evaluate(`(() => { const on = (id) => { const q = document.getElementById(id).getBoundingClientRect(); return q.width > 0 && q.top >= 0 && q.bottom <= innerHeight && q.left >= 0 && q.right <= innerWidth; }; return on('rcResults') && on('rcResT'); })()`) as boolean, '844×390: the standings fit on screen');
    await page.screenshot({ path: `${OUT}/standings-844x390.png` });
    await page.context().close();

    check(errors.length === 0, `console clean${errors.length ? ': ' + errors.join(' | ') : ''}`);
  } finally {
    await browser.close();
    await server.close();
  }
  if (fails) { console.error(`race: ${fails} check(s) failed`); process.exit(1); }
  console.log(`race: all checks passed; screenshots in ${OUT}/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
