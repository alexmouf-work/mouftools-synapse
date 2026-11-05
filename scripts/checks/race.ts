// vs CPU check (B7; rounds plan and sidebar plan 2026-11-05), headless Chromium on SwiftShader:
// - Title → vs CPU starts a 5-round match in the designer: "Round 1 of 5 · Build" counting from 60, top centre, in the
//   vs CPU yellow, at least Train's row tall; the energy bar's full scale is round 1's budget (20%) and a design past it
//   can't train (says why); red in the last 10 s; a pulse and a tick on the effects bus in the last 5; at 0 "Time's up",
//   then Train starts itself with the design as it stands (jumped ahead with __phase.skipTo).
// - Train: no popup and no buttons, "Round 1 of 5 · Train" from 10 (red under 5), the fixed budget (a small ?T= here)
//   from the starting brain: the trained brain = Node's run of the same design, seed and budget; the generation shows
//   in the timer as "gen n" (nothing overlaps the timer); the race starts when the 10 s are up. Without ?T= a round
//   spends the game's budget, T = the full-skill CPU's (all of it; generations and time reported).
// - Race: ten cars on the grid two by two behind the line where the sim puts them (= Node gridCar), listed in grid
//   order, the countdown 5…1 Go, then "Round 1 of 5 · Race" from 30; the race hash, the ranking by signed distance and
//   each car's place on screen at 20 s = Node runRace (30 s, no laps); the sidebar a quarter of the width with the
//   status, the racers list and the map; your live brain in the camera's corner; render smoke; bloom audits.
// - Standings after the race: this race's signed distance and the total per player, = Node, best total first; "Round 2
//   of 5 in" counting 8; Next round → round 2's build: 20 s, the budget 28%, the brain carried over (= the trained one).
// - The last round (round 5, a race straight from ?view=race with the strongest round-5 CPU brain as yours, on a seed
//   where you lead): the final standings, "You won the match!", Play again and Back, and the winner music.
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
import { gridCar, raceTrackSeed, ROUND_RACE, runRace } from '../../src/common/sim/match';
import { Runner } from '../../src/common/sim/race';
import { derive } from '../../src/common/rng';
import { biasIndex, defaultSpec, OUTPUTS, type BrainSpec, type Genome } from '../../src/common/sim/spec';
import { generateTrack } from '../../src/common/sim/track';
import { InlineExecutor } from '../../src/common/train/episodes';
import { runPhase } from '../../src/common/train/phase';
import { NO_TRAINING, SAVE_KEY, serialize } from '../../src/client/ui/designer/store';
import { fixtureBrain } from './fixture';

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
const NAMES = ['You', ...CPU_NAMES];

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
    await page.evaluate(([k, v]) => { localStorage.setItem('synapse.notice', '2'); if (v) localStorage.setItem(k, v); },
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
  const standingsRows = (page: Page) => page.$$eval('#rcRows tr', (trs) => trs.map((t) => [...t.querySelectorAll('td')].map((d) => d.textContent ?? '')));

  try {
    // 1. the round 1 build: the timer, the budget, a design past it
    let page = await open(`?seed=${SEED}&T=${T}&race=${MATCH}`);
    await page.click('#toCpu');
    const m0 = await page.evaluate(() => window.__match!);
    let bt = await pt(page);
    const lay0 = await page.evaluate(() => { const a = document.querySelector('.app')!.getBoundingClientRect(), t = document.querySelector('.app .top')!.getBoundingClientRect(); return { cx: (a.left + a.right) / 2, topBottom: t.bottom, row: t.height, appTop: a.top, appH: a.height }; });
    check(m0.phase === 'build' && m0.round === 1 && bt.state === 'running' && bt.shown && bt.label === 'Round 1 of 5 · Build' && bt.text === '60' && bt.bg === 'rgb(255, 194, 26)' && !bt.red
      && Math.abs(bt.cx - lay0.cx) < 2 && bt.top >= lay0.topBottom - 0.5 && (bt.top - lay0.appTop) / lay0.appH < 0.2 && bt.h >= lay0.row,
      `vs CPU starts round 1 of 5 in the designer: "${bt.label}" ${bt.text}, vs CPU yellow, top centre under the top bar, ${bt.h.toFixed(0)} px tall (Train's row ${lay0.row.toFixed(0)} px)`);
    const alloc = await page.locator('#aBrain').innerText();
    check(/ of 20%$/.test(alloc) && JSON.stringify(await page.evaluate(() => window.__designer!.spec())) === JSON.stringify(defaultSpec()), `round 1 starts from the starting brain; the energy bar's full scale is round 1's budget ("Brain ${alloc}")`);
    await page.screenshot({ path: `${OUT}/build-60.png` });
    await page.evaluate((g) => window.__designer!.load(g), zeroGenome(BIG));
    await page.click('#train');
    await page.waitForTimeout(300);
    const toast = await page.locator('#toast').innerText();
    check(await page.evaluate(() => window.__match!.phase === 'build') && await page.locator('#arena').isHidden() && /this round allows 20%/.test(toast), `a design past round 1's budget can't train ("${toast}")`);
    await page.evaluate((g) => window.__designer!.load(g), defaultGenome());
    await page.evaluate(() => window.__phase!.skipTo(9.5));
    bt = await pt(page);
    check(bt.text === '10' && bt.red && bt.bg === 'rgb(217, 70, 91)' && !bt.pulse, `the last 10 s: red (${bt.text}, ${bt.bg}), no pulse yet`);
    await page.screenshot({ path: `${OUT}/build-red.png` });
    const p5 = await page.evaluate(() => { window.__phase!.skipTo(4.5); return { pulse: window.__phase!.pulse, text: window.__phase!.text, sfx: window.__audio!.liveSfx, audio: window.__audio!.state }; });
    check(p5.text === '5' && p5.pulse && (p5.audio !== 'running' || p5.sfx > 0), `the last 5 s: pulses, and ticks on the effects bus (audio ${p5.audio}, ${p5.sfx} effect sounding)`);
    await page.evaluate(() => window.__phase!.skipTo(0.2));
    await page.waitForFunction(() => window.__phase?.state === 'up', null, { timeout: 5000 });
    const up = await page.evaluate(() => ({ text: window.__phase!.text, designer: !(document.querySelector('.app') as HTMLElement).hidden }));
    await page.screenshot({ path: `${OUT}/build-up.png` });
    check(up.text === 'Time’s up' && up.designer, `at 0: "${up.text}" over the designer`);

    // 2. training: started by the timer, 10 s, no buttons; the trained brain = Node
    await page.waitForFunction(() => window.__training?.state === 'running' || window.__training?.state === 'done', null, { timeout: 30_000 });
    const tr = await page.evaluate(() => ({ T: window.__training!.T, start: window.__training!.start, phase: window.__training!.phase, popup: (document.getElementById('trainDlg') as HTMLDialogElement).open,
      btns: ['tvStop', 'tvRace', 'tvBack', 'tvDrive', 'tvAgain'].filter((id) => !(document.getElementById(id) as HTMLElement).hidden), menu: !(document.getElementById('tvMenu') as HTMLElement).hidden }));
    bt = await pt(page);
    check(!tr.popup && tr.T === T && tr.start === 'fresh' && tr.phase === 0 && tr.btns.length === 0 && tr.menu && bt.label === 'Round 1 of 5 · Train' && Number(bt.text) <= 10 && Number(bt.text) >= 8,
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
    check(tmid.phase === 'train' || tmid.phase === 'race', `training done early: the view holds until the 10 s are up (${tmid.left} s left${tmid.red ? ', red' : ''})`);
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
    const pr = await page.evaluate(() => window.__race!.probe!());
    check(pr.mean > 20 && pr.sd > 8, `render smoke: mean ${pr.mean.toFixed(1)}, spread ${pr.sd.toFixed(1)}`);
    for (const t of [10, 25]) {
      const a = await page.evaluate((x) => window.__race!.auditAt(x), t);
      check(a.over === 0, `bloom audit at ${t} s: ${a.over} over (max ${a.max.toFixed(2)})`);
    }

    // 5. the standings after round 1, then round 2's build with the brain carried over
    await page.click('#rcSkip');
    await page.waitForFunction(() => window.__match?.phase === 'standings', null, { timeout: 30_000 });
    await frames(page, 2);
    const rows = await standingsRows(page), d = node.cars.map((c) => c.dist);
    const ordr = NAMES.map((_, k) => k).sort((a, b) => d[b] - d[a] || a - b);
    const want = ordr.map((k, i) => [String(i + 1), NAMES[k], km(d[k]), km(d[k])]);
    bt = await pt(page);
    check(JSON.stringify(rows) === JSON.stringify(want) && (await page.locator('#rcResT').innerText()) === 'Round 1 of 5 · Standings' && (await page.locator('#rcHead').innerText()).replace(/\s+/g, ' ').trim() === 'PLACE NAME ROUND 1 TOTAL',
      `standings: race and total distance (signed) = Node: ${rows.map((x) => `${x[1]} ${x[3]}`).join(' | ')}`);
    check(bt.label === 'Round 2 of 5 in' && Number(bt.text) <= 8 && (await page.locator('#rcAgain').innerText()) === 'Next round' && await page.locator('#rcBack').isHidden(), `"${bt.label}" ${bt.text}, and Next round`);
    await page.screenshot({ path: `${OUT}/standings.png` });
    await page.click('#rcAgain');
    await page.waitForFunction(() => window.__match?.phase === 'build' && window.__match.round === 2, null, { timeout: 10_000 });
    bt = await pt(page);
    const g2 = await page.evaluate(() => window.__designer!.genome());
    check(bt.label === 'Round 2 of 5 · Build' && Number(bt.text) <= 20 && Number(bt.text) >= 19 && /of 28%$/.test(await page.locator('#aBrain').innerText()) && genomeHash(g2) === genomeHash(trained),
      `Next round: "${bt.label}" ${bt.text}, the budget 28%, and the brain is the one round 1 trained (weights carried over)`);
    // an upgrade keeps the trained weights: one more boundary cell
    await page.click('#tray [data-s="boundary"]');
    const g3 = await page.evaluate(() => window.__designer!.genome());
    check(g3.spec.senses.boundary === 2 && g3.w.slice(0, 3).some((x) => x !== 0), 'an upgrade (another wall cell) keeps the trained weights; the new cell\'s start at 0');
    await page.screenshot({ path: `${OUT}/build-round2.png` });
    await page.click('#toTitle');
    await page.click('#lvGo');
    check(await page.locator('#title').isVisible() && await page.evaluate(() => window.__phase!.state === 'off' && window.__match!.phase === 'none'), 'Main menu → Leave: back to the title, the match and its timer gone');
    await page.context().close();

    // 5b. without ?T= a round trains on the game's budget: T = the full-skill CPU's budget (CONFIG.train.T), all of it
    page = await open(`?seed=${SEED}&race=${MATCH}`);
    await page.click('#toCpu');
    await page.evaluate(() => window.__phase!.skipTo(0.1));
    await page.waitForFunction(() => window.__training?.state === 'running', null, { timeout: 30_000 });
    const real0 = await page.evaluate(() => ({ T: window.__training!.T, gens: window.__training!.generations }));
    await page.waitForFunction(() => window.__training?.state === 'done', null, { timeout: 300_000 });
    const real = await page.evaluate(() => ({ gen: window.__training!.gen, used: window.__training!.ticksUsed, ms: window.__training!.ms ?? 0, workers: window.__training!.workers }));
    check(real0.T === CONFIG.train.T && real0.T === rounds[0][8].budget && real.used >= 0.97 * real0.T && real.gen >= 50,
      `a round's training (no ?T): T ${real0.T.toLocaleString('en')} = the full-skill CPU's budget; ${real.gen} generations (estimate ${real0.gens}), ${real.used.toLocaleString('en')} car-ticks, ${(real.ms / 1000).toFixed(1)} s on ${real.workers} workers here (SwiftShader container)`);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/train-full-T.png` });
    await page.context().close();

    // 6. the last round, which you lead: the final standings and the winner music
    const nw = runRace([strong, ...cpu5], raceSeedOf(WIN, 5), undefined, ROUND_RACE);
    page = await open(`?view=race&race=${WIN}&round=5`, 1440, 900, strong);
    await page.waitForFunction(() => (window.__race?.frames ?? 0) > 1, null, { timeout: 60_000 });
    r = (await race(page))!;
    check(r.hash === nw.hash && r.place === 1, `round 5's race (hash = Node), you first`);
    await page.click('#rcState').catch(() => undefined);
    await page.waitForFunction(() => window.__audio?.ready === true && (window.__audio?.winnerS ?? 0) > 0, null, { timeout: 60_000 });
    await page.click('#rcSkip');
    await page.waitForFunction(() => window.__match?.phase === 'over', null, { timeout: 30_000 });
    await page.waitForFunction(() => window.__audio?.phrase === 'winner', null, { timeout: 5000 }).catch(() => undefined);
    const fin = await page.evaluate(() => ({ t: document.getElementById('rcResT')!.textContent, again: document.getElementById('rcAgain')!.textContent, back: document.getElementById('rcBack')!.textContent, backOn: !(document.getElementById('rcBack') as HTMLElement).hidden, phrase: window.__audio!.phrase, timer: window.__phase!.state }));
    check(fin.t === 'You won the match!' && fin.again === 'Play again' && fin.back === 'Back' && fin.backOn && fin.timer === 'off', `the final standings: "${fin.t}", Play again and Back (no next-round timer)`);
    check(fin.phrase === 'winner', `the winner music plays (${fin.phrase})`);
    await frames(page, 2);
    await page.screenshot({ path: `${OUT}/final.png` });
    await page.click('#rcBack');
    check(await page.locator('#title').isVisible(), 'Back from the final standings: the title');
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
    await page.click('#rcSkip');
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
    await page.click('#rcSkip');
    await page.waitForFunction(() => window.__match?.phase === 'standings', null, { timeout: 30_000 });
    check(await page.evaluate(`(() => { const on = (id) => { const q = document.getElementById(id).getBoundingClientRect(); return q.width > 0 && q.top >= 0 && q.bottom <= innerHeight && q.left >= 0 && q.right <= innerWidth; }; return on('rcResults') && on('rcAgain'); })()`) as boolean, '844×390: the standings fit on screen, Next round on it');
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
