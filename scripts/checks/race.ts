// vs CPU check (B7), headless Chromium on SwiftShader:
// - Title → vs CPU opens the designer in match mode: a design past 100% flat out can't train (says why); Train goes
//   straight to training (no generations popup) on the fixed budget (a small ?T= here), from scratch: the saved brain
//   = Node's run of the same design, seed and budget; training ends with Race and Back (no Drive, no Keep training).
// - Race: ten cars on the grid two by two behind the line where the sim puts them (= Node gridCar), the players listed
//   in grid order, the countdown 5…1 Go, every car drawn in 3-D and on the map; the race hash, the ranking and each
//   car's place on screen at 20 s = Node runRace; render smoke; bloom audits on the grid and mid-race; Skip → results
//   (place, name, time, distance in Node's order); Race again draws a new race; Back returns to the match designer.
// - A race the player wins (the strongest CPU brain as your brain, on a race seed where you finish first): the winner
//   music plays as you cross the line.
// - 844×390: the status panel, the map and the results on screen and apart, no sideways scroll. Console clean.
// Screenshots → out/race/.
//   npx tsx scripts/checks/race.ts
import { mkdirSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer } from 'vite';
import cpuData from '../../src/assets/cpu/brains.json';
import { CONFIG } from '../../src/common/config';
import { genomeHash, zeroGenome } from '../../src/common/sim/brain';
import { CPU_NAMES, cpuBrains } from '../../src/common/sim/cpu';
import { gridCar, runRace } from '../../src/common/sim/match';
import { defaultSpec, type BrainSpec, type Genome } from '../../src/common/sim/spec';
import { InlineExecutor } from '../../src/common/train/episodes';
import { runPhase } from '../../src/common/train/phase';
import { NO_TRAINING, parse, SAVE_KEY, serialize } from '../../src/client/ui/designer/store';
import { fixtureBrain } from './fixture';

const OUT = 'out/race';
const T = 300_000;
const SEED = 7;
const RACE = 5;
const HZ = CONFIG.tick.hz;
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
let fails = 0;
const check = (cond: boolean, what: string) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (!cond) fails++; };
const BIG: BrainSpec = { v: 2, senses: { boundary: 7, landmark: 5, hd: 8, grid: 6, speed: 1 }, layers: Array.from({ length: 4 }, () => ({ n: 8, fn: 'tanh' as const })) };

async function main() {
  mkdirSync(OUT, { recursive: true });
  const cpu = cpuBrains(cpuData).map((b) => b.genome);
  const trained = (await runPhase(new InlineExecutor(), defaultSpec(), SEED, { T })).final;
  const node = runRace([trained, ...cpu], RACE);
  // a race the strongest CPU brain wins when it is yours (search the first race seeds)
  const strong = cpu[cpu.length - 1];
  let WIN = -1;
  for (let s = 1; s <= 60 && WIN < 0; s++) if (runRace([strong, ...cpu], s).ranking[0] === 0) WIN = s;
  check(WIN > 0, `a race seed where the strongest brain, raced as yours, wins: ${WIN}`);

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
  const race = (page: Page) => page.evaluate(`(() => { const r = window.__race; return r ? { state: r.state, raceSeed: r.raceSeed, hash: r.hash, names: r.names, slots: r.slots, results: r.results, place: r.place, won: r.won, t: r.t, end: r.end, frames: r.frames, go: r.go, countdownSeen: r.countdownSeen, listed: r.listed(), drawn: r.drawn(), dots: r.dots() } : null; })()`) as Promise<{
    state: string; raceSeed: number; hash: string; names: string[]; slots: number[]; results: { name: string; place: number; finish: number | null; prog: number }[];
    place: number; won: boolean; t: number; end: number; frames: number; go: boolean; countdownSeen: string[]; listed: string[]; drawn: number[][]; dots: number;
  } | null>;
  const frames = async (page: Page, n = 2) => { const f = (await race(page))?.frames ?? 0; await page.waitForFunction((x) => (window.__race?.frames ?? 0) > x, f + n - 1, { timeout: 60_000 }); };
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

  try {
    // 1. the match designer refuses a design past the limit
    let page = await open('');
    await page.click('#toCpu');
    check(await page.locator('.app').isVisible() && await page.evaluate(() => document.body.classList.contains('match')), 'vs CPU opens the designer in match mode');
    await page.evaluate((g) => window.__designer!.load(g), zeroGenome(BIG));
    await page.click('#train');
    await page.waitForTimeout(300);
    const toast = await page.locator('#toast').innerText();
    check(!(await page.locator('#trainDlg').evaluate((d) => (d as HTMLDialogElement).open)) && await page.locator('#arena').isHidden() && /races allow 100%/.test(toast),
      `a design past 100% flat out can't train in vs CPU ("${toast}")`);
    await page.context().close();

    // 2. Train: no popup, the fixed budget, from scratch = Node; ends with Race and Back
    page = await open(`?seed=${SEED}&T=${T}&race=${RACE}`);
    await page.click('#toCpu');
    await page.click('#train');
    await page.waitForFunction(() => window.__training?.state === 'running' || window.__training?.state === 'done', null, { timeout: 30_000 });
    check(!(await page.locator('#trainDlg').evaluate((d) => (d as HTMLDialogElement).open)), 'Train opens no generations popup in vs CPU');
    await page.waitForFunction(() => window.__training?.state === 'done', null, { timeout: 300_000 });
    const tr = await page.evaluate(() => ({ T: window.__training!.T, start: window.__training!.start, phase: window.__training!.phase, temp: window.__training!.temperature }));
    const sv = parse(await page.evaluate((k) => localStorage.getItem(k), SAVE_KEY)).saved;
    check(genomeHash(sv.genome) === genomeHash(trained) && tr.start === 'fresh' && tr.phase === 0 && tr.temp === 0 && tr.T === T,
      `trained from scratch on the budget (T ${tr.T}, ${tr.start}, phase ${tr.phase}, temperature ${tr.temp}): saved brain = Node's run`);
    const btn = await page.evaluate(() => ['tvRace', 'tvBack', 'tvDrive', 'tvAgain'].map((id) => !(document.getElementById(id) as HTMLElement).hidden));
    check(btn[0] && btn[1] && !btn[2] && !btn[3], 'training ends with Race and Back (no Drive, no Keep training)');
    await page.screenshot({ path: `${OUT}/trained.png` });

    // 3. the grid, the players, the countdown
    await page.click('#tvRace');
    await page.waitForFunction(() => (window.__race?.frames ?? 0) > 1, null, { timeout: 60_000 });
    let r = (await race(page))!;
    check(r.raceSeed === RACE && r.hash === node.hash, `race hash ${r.hash} = Node runRace ${node.hash}`);
    check(JSON.stringify(r.names) === JSON.stringify(['You', ...CPU_NAMES]), `ten players: ${r.names.join(', ')}`);
    check(JSON.stringify(r.results.map((x) => x.name)) === JSON.stringify(node.ranking.map((k) => r.names[k])), `ranking = Node: ${r.results.map((x) => x.name).join(' > ')}`);
    if (!r.go) {
      const bySlot = r.names.map((n, k) => [r.slots[k], n] as const).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
      check(JSON.stringify(r.listed) === JSON.stringify(bySlot) && (await page.locator('#rcListH').innerText()) === 'GRID', `before Go the players are listed in grid order: ${r.listed.join(', ')}`);
      const gridOk = r.drawn.length === 10 && r.drawn.every((p, k) => { const g = gridCar(node.track, node.cars[k].slot); return near(p[0], g.x) && near(p[2], -g.y); });
      const vis = r.drawn.filter((p) => p[3] === 1).length;
      check(gridOk && vis >= 8 && r.drawn[0][3] === 1, `ten cars on the grid, each where the sim puts its slot (two by two behind the line); ${vis} drawn (a car under the chase camera is not)`);
      await page.screenshot({ path: `${OUT}/grid.png` });
      const ga = await page.evaluate(() => window.__race!.auditAt(0));
      check(ga.over === 0, `bloom audit on the grid: ${ga.over} over (max ${ga.max.toFixed(2)})`);
    } else check(false, 'the race view opened before Go (the grid could not be checked)');
    await page.waitForFunction(() => window.__race?.go === true, null, { timeout: 60_000 });
    r = (await race(page))!;
    check(r.countdownSeen.slice(0, 6).join(' ') === '5 4 3 2 1 Go', `countdown: ${r.countdownSeen.join(' ')}`);

    // 4. mid-race: every car where Node has it, the standings, the map, the picture
    await page.evaluate(() => window.__race!.seek(20));
    await frames(page, 2);
    r = (await race(page))!;
    // where Node's recording has each car at the playback time of the frame read (between two recorded ticks)
    const posOk = r.drawn.every((p, k) => {
      const c = node.cars[k].rec, kf = r.t * HZ - 1, j = Math.floor(kf), u = kf - j, b = j + 1;
      return near(p[0], c.x[j] + (c.x[b] - c.x[j]) * u) && near(p[2], -(c.y[j] + (c.y[b] - c.y[j]) * u));
    });
    check(posOk && r.dots === 10 && r.t >= 20, `at ${r.t.toFixed(2)} s every car is drawn where Node's race has it, and ten dots on the map`);
    check((await page.locator('#rcListH').innerText()) === 'STANDINGS' && [...r.listed].sort().join() === [...r.names].sort().join(), `standings at 20 s: ${r.listed.join(', ')}`);
    await page.screenshot({ path: `${OUT}/race-20s.png` });
    const pr = await page.evaluate(() => window.__race!.probe!());
    check(pr.mean > 20 && pr.sd > 8, `render smoke: mean ${pr.mean.toFixed(1)}, spread ${pr.sd.toFixed(1)}`);
    for (const t of [10, 45]) {
      const a = await page.evaluate((x) => window.__race!.auditAt(x), t);
      check(a.over === 0, `bloom audit at ${t} s: ${a.over} over (max ${a.max.toFixed(2)})`);
    }

    // 5. results
    await page.click('#rcSkip');
    await page.waitForFunction(() => window.__race?.state === 'results', null, { timeout: 30_000 });
    const rows = await page.$$eval('#rcRows tr', (trs) => trs.map((t) => [...t.querySelectorAll('td')].map((d) => d.textContent ?? '')));
    const goal = CONFIG.match.laps * node.track.len;
    const want = node.ranking.map((k, i) => [String(i + 1), r.names[k], node.cars[k].finish !== null ? `${Math.floor(node.cars[k].finish! / HZ / 60)}:${((node.cars[k].finish! / HZ) % 60).toFixed(2).padStart(5, '0')}` : '–', `${((node.cars[k].finish !== null ? goal : node.cars[k].prog) / 1000).toFixed(2)} km`]);
    check(JSON.stringify(rows) === JSON.stringify(want), `results: ${rows.map((x) => x.join(' ')).join(' | ')}`);
    await page.screenshot({ path: `${OUT}/results.png` });

    // 6. Race again: a new race; Back: the match designer
    await page.click('#rcAgain');
    await page.waitForFunction((h) => window.__race && window.__race.hash !== h && window.__race.frames > 1, node.hash, { timeout: 60_000 });
    r = (await race(page))!;
    check(r.raceSeed !== RACE && r.state !== 'results', `Race again: a new race (seed ${r.raceSeed}, ${await page.locator('#rcResults').isHidden() ? 'results hidden' : 'results showing'})`);
    await page.click('#rcLeave');
    check(await page.locator('.app').isVisible() && await page.locator('#arena').isHidden() && await page.evaluate(() => document.body.classList.contains('match')), 'Back returns to the designer, still vs CPU');
    await page.context().close();

    // 7. a win plays the winner music as you cross the line
    const nw = runRace([strong, ...cpu], WIN), fin = nw.cars[0].finish! / HZ;
    page = await open(`?view=race&race=${WIN}`, 1440, 900, strong);
    await page.waitForFunction(() => (window.__race?.frames ?? 0) > 1, null, { timeout: 60_000 });
    await page.evaluate(() => { window.__race!.hold = true; }); // the music may take a while to decode: stay before the line
    await page.click('#rcState');
    await page.waitForFunction(() => window.__audio?.ready === true && (window.__audio?.winnerS ?? 0) > 0, null, { timeout: 60_000 });
    r = (await race(page))!;
    check(r.place === 1 && r.hash === nw.hash, `you win race ${WIN} (hash = Node), finishing at ${fin.toFixed(2)} s`);
    await page.evaluate((x) => window.__race!.seek(x), fin - 0.5);
    await frames(page, 2);
    const before = (await race(page))!.won;
    await page.evaluate((x) => { window.__race!.hold = false; window.__race!.seek(x); }, fin + 0.05);
    await frames(page, 2);
    await page.waitForFunction(() => window.__audio?.phrase === 'winner', null, { timeout: 5000 }).catch(() => undefined);
    const after = await page.evaluate(() => ({ won: window.__race!.won, phrase: window.__audio!.phrase }));
    check(!before && after.won && after.phrase === 'winner', `the winner music starts as you cross the line first (before: ${before}, after: ${after.won}, ${after.phrase})`);
    await page.screenshot({ path: `${OUT}/win.png` });
    await page.context().close();

    // 8. landscape phone: panels apart and on screen, results fit
    page = await open(`?view=race&race=${RACE}`, 844, 390, trained);
    await page.waitForFunction(() => (window.__race?.frames ?? 0) > 1, null, { timeout: 60_000 });
    const lay = (a: string, b: string) => page.evaluate(`(() => {
      const A = document.querySelector('${a}').getBoundingClientRect(), B = document.querySelector('${b}').getBoundingClientRect();
      const on = (q) => q.left >= 0 && q.top >= 0 && q.right <= innerWidth && q.bottom <= innerHeight;
      return !(A.left < B.right && B.left < A.right && A.top < B.bottom && B.top < A.bottom) && on(A) && on(B) && document.documentElement.scrollWidth <= document.documentElement.clientWidth;
    })()`) as Promise<boolean>;
    check(await lay('.rc-status', '.rc-mini'), '844×390: status panel and map on screen and apart, no sideways scroll');
    await page.screenshot({ path: `${OUT}/race-844x390.png` });
    await page.click('#rcSkip');
    await page.waitForFunction(() => window.__race?.state === 'results', null, { timeout: 30_000 });
    check(await page.evaluate(() => { const q = document.getElementById('rcResults')!.getBoundingClientRect(); return q.top >= 0 && q.bottom <= innerHeight && q.left >= 0 && q.right <= innerWidth; }), '844×390: the results fit on screen');
    await page.screenshot({ path: `${OUT}/results-844x390.png` });
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
