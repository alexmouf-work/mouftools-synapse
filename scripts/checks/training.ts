// Training view browser check (S3, B6), headless Chromium on SwiftShader:
// - Train from the designer (the generations popup, default 100) finishes; the saved genome hash changes; the phase hash equals the Node run's.
// - Actor-critic (at ×2) and A_RP train in the browser to Node's hash; their Temperature slider is on, with its hint.
// - 1 vs 4 workers (and the default pool) → the same hash; training the same saved brain twice → the same result.
// - Training again continues from the saved weights (carry, next phase) and matches Node.
// - Stop = the generation limit reached there: the best agent so far is saved (= Node stopped at the same generation =
//   Node asked for that many), and Drive, Keep training and Back appear.
// - Layout (1440×900 and 844×390, light and dark, mid-training and at the end): the sidebar on the left at 25vw, the
//   fitness graph over the map in it, the camera filling the rest; the live brain in its bottom-right (min(28%, 300px),
//   4:3, 10 px margins); the
//   generation big and white at the top centre (clamp(40px, 9vh, 88px)); no sideways scroll.
// - Playback: the whole population (64) as ghosts every generation, added in over a few frames with no frame spike; every generation offered; shown strictly in order, never twice, each after the
//   ~2 s minimum and starting further along; then the champion's lap; no main-thread spike preparing a generation.
// - The finish line's flags; bloom audits at the start line (band and flags in view), mid-run and in the finale.
// Screenshots → out/s3/ (mid-training and end, 1440×900 and 844×390, light and dark; gen 1 at the start; champion).
//   npx tsx scripts/checks/training.ts
import { mkdirSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer } from 'vite';
import { CONFIG } from '../../src/common/config';
import { defaultGenome, genomeHash } from '../../src/common/sim/brain';
import { defaultSpec } from '../../src/common/sim/spec';
import { InlineExecutor } from '../../src/common/train/episodes';
import { phaseBudget, runPhase } from '../../src/common/train/phase';
import { parse, SAVE_KEY } from '../../src/client/ui/designer/store';
import { fixtureBrain } from './fixture';

const OUT = 'out/s3';
const T = 1_000_000; // checks use a smaller budget (dev-only ?T=); the screenshots use the real one
const GENS = CONFIG.train.defaultGenerations; // what the popup offers first
const SEED = 7;
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
let fails = 0;
const check = (cond: boolean, what: string) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (!cond) fails++; };

async function main() {
  mkdirSync(OUT, { recursive: true });
  const node1 = await runPhase(new InlineExecutor(), defaultSpec(), SEED, { T, generations: GENS });
  const node2 = await runPhase(new InlineExecutor(), defaultSpec(), SEED, { T, generations: GENS, phase: 1, start: 'carry', genome: node1.final });
  const nodeHot = await runPhase(new InlineExecutor(), defaultSpec(), SEED, { T, generations: GENS, temperature: 1 });
  const nodeAc = await runPhase(new InlineExecutor(), defaultSpec(), SEED, { T, generations: GENS, trainer: 'ac', temperature: 1 });
  const nodeArp = await runPhase(new InlineExecutor(), defaultSpec(), SEED, { T, generations: GENS, trainer: 'arp' });

  const server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
  await server.listen();
  const addr = server.httpServer?.address();
  if (!addr || typeof addr === 'string') throw new Error('no server address');
  const base = `http://127.0.0.1:${addr.port}/`;
  let browser: Browser;
  try { browser = await chromium.launch({ args: ARGS }); } catch { browser = await chromium.launch({ executablePath: CHROMIUM, args: ARGS }); }
  const errors: string[] = [];
  async function open(query: string, w = 1440, h = 900, mobile = false): Promise<Page> {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
    await fixtureBrain(ctx);
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(base + query);
    return page;
  }
  const status = (page: Page) => page.evaluate(() => { const s = window.__training; return s ? { ...s, probe: undefined } : null; });
  const waitState = (page: Page, st: string, ms = 600_000) => page.waitForFunction((x) => window.__training?.state === x, st, { timeout: ms });
  const saved = async (page: Page) => {
    const r = parse(await page.evaluate((k) => localStorage.getItem(k), SAVE_KEY));
    if (r.status === 'corrupt') throw new Error(`saved brain corrupt: ${r.why}`); // 'missing' = an untouched starting brain
    return r.saved;
  };
  const starterHash = genomeHash(defaultGenome());
  const train = async (page: Page) => { await page.click('#train'); await page.click('#tdGo'); };

  try {
    // 1. train from the designer
    let page = await open(`?seed=${SEED}&T=${T}&view=sandbox`);
    await train(page);
    await page.waitForFunction(() => (window.__training?.frames ?? 0) > 2, null, { timeout: 120_000 });
    const pr = await page.evaluate(() => window.__training!.probe!());
    check(pr.mean > 30 && pr.sd > 5, `render smoke: mean luminance ${pr.mean.toFixed(1)}, spread ${pr.sd.toFixed(1)} (${pr.w}×${pr.h})`);
    await waitState(page, 'done');
    let s = await status(page);
    let sv = await saved(page);
    check(s?.hash === node1.hash, `browser phase hash ${s?.hash} = Node ${node1.hash} (${s?.workers} workers)`);
    check(genomeHash(sv.genome) !== starterHash && genomeHash(sv.genome) === genomeHash(node1.final), 'trained genome saved; hash changed from the untrained starting brain and equals Node\'s');
    check(sv.train.seed === SEED && sv.train.phases === 1 && sv.train.temps.join() === '0', `training history saved (seed ${sv.train.seed}, phases ${sv.train.phases}, temperatures ${sv.train.temps.join()})`);
    check((s?.ghostCapacity ?? 0) >= (s?.ghosts ?? 99), `ghost capacity ${s?.ghostCapacity} ≥ the ${s?.ghosts} ghosts a generation records here`);
    check(s?.webgl === true && (s?.frames ?? 0) > 0, `3-D view drew ${s?.frames} frames (${s?.quality} quality)`);
    const snapshot = await page.evaluate((k) => localStorage.getItem(k), SAVE_KEY);

    // 2. back to the workbench, then train again: carry, next phase
    await page.click('#tvBack');
    check(await page.locator('.app').isVisible() && !(await page.locator('#trainView').isVisible()), 'Back to workbench shows the designer');
    await train(page);
    await waitState(page, 'running', 60_000);
    await waitState(page, 'done');
    s = await status(page);
    sv = await saved(page);
    check(s?.start === 'carry' && s?.phase === 1 && s?.hash === node2.hash, `training again continues from the saved weights (carry, run 2), hash ${s?.hash} = Node ${node2.hash}`);
    check(sv.train.phases === 2 && genomeHash(sv.genome) === genomeHash(node2.final), 'second run saved');
    await page.context().close();

    // 3. the same saved brain trained again → same result; 1 and 4 workers → same hash
    for (const w of [1, 4]) {
      page = await open(`?seed=${SEED}&T=${T}&workers=${w}`);
      await page.evaluate(([k, v]) => localStorage.setItem(k, v), [SAVE_KEY, snapshot as string]);
      await page.goto(`${base}?seed=${SEED}&T=${T}&workers=${w}&view=train`);
      await waitState(page, 'done');
      s = await status(page);
      check(s?.workers === w && s?.hash === node2.hash, `retrain of the same saved brain on ${w} worker${w === 1 ? '' : 's'}: hash ${s?.hash} = ${node2.hash}`);
      await page.context().close();
    }

    // 3b. temperature in the Train popup
    page = await open(`?seed=${SEED}&T=${T}&view=sandbox`);
    await page.click('#train');
    const tslider = () => page.evaluate(() => {
      const s = document.getElementById('tSlide') as HTMLInputElement;
      return { min: s.min, max: s.max, step: s.step, value: s.value, disabled: s.disabled, shown: document.getElementById('tVal')!.textContent, hint: document.getElementById('tHint')!.textContent };
    });
    let ts = await tslider();
    check(ts.min === '-2' && ts.max === '2' && ts.step === '0.25' && ts.value === '0' && !ts.disabled && ts.shown === '×1.0' && ts.hint === 'Scales σ, the size of each mutation.',
      `Temperature: range ${ts.min}..${ts.max} step ${ts.step}, default ${ts.value} (${ts.shown}), "${ts.hint}"`);
    const setT = (v: number) => page.evaluate((x) => { const s = document.getElementById('tSlide') as HTMLInputElement; s.value = String(x); s.dispatchEvent(new Event('input', { bubbles: true })); }, v);
    const shownAt: string[] = [];
    for (const v of [-2, -0.75, 2, 1]) { await setT(v); shownAt.push((await tslider()).shown ?? ''); }
    check(shownAt.join(' ') === '×0.25 ×0.59 ×4.0 ×2.0', `the value shown follows the slider (${shownAt.join(', ')})`);
    await page.click('#tdGo');
    await waitState(page, 'done');
    s = await status(page);
    sv = await saved(page);
    check(s?.temperature === 1 && s?.hash === nodeHot.hash && nodeHot.hash !== node1.hash,
      `a run at ×2: hash ${s?.hash} = Node's ×2 run ${nodeHot.hash}, ≠ the ×1 run ${node1.hash}`);
    check(sv.train.temps.join() === '1', `the temperature is recorded in the training history (temps ${sv.train.temps.join()})`);
    await page.click('#tvBack');
    await page.click('#trainers [data-tr="backprop"]');
    await page.click('#train');
    ts = await tslider();
    check(ts.disabled && ts.shown === '—' && ts.hint === 'Backprop copies a teacher, so it has nothing to explore.', `backprop: the slider is off (${ts.shown}, "${ts.hint}")`);
    await page.click('#tdNo');
    await page.context().close();

    // 3c. actor-critic and A_RP (B4) train in the browser exactly as in Node, with the temperature on their exploration
    for (const [id, t, node, hint] of [['ac', 1, nodeAc, 'Scales how much the actor explores.'], ['arp', 0, nodeArp, 'Scales how randomly the units fire while learning.']] as const) {
      page = await open(`?seed=${SEED}&T=${T}&view=sandbox`);
      await page.click(`#trainers [data-tr="${id}"]`);
      await page.click('#train');
      await setT(t);
      ts = await tslider();
      check(!ts.disabled && ts.hint === hint, `${id}: the slider is on ("${ts.hint}", ${ts.shown})`);
      await page.click('#tdGo');
      await waitState(page, 'done');
      s = await status(page);
      sv = await saved(page);
      check(s?.hash === node.hash && sv.trainer === id && sv.train.temps.join() === String(t), `${id} at ×${2 ** t}: hash ${s?.hash} = Node's ${node.hash}; saved with its trainer and temperature`);
      await page.context().close();
    }

    // 4. Stop = the generation limit reached there (B6): the best agent so far is saved, as a run asked for that many
    //    generations would; the generation being evaluated is dropped; Drive and Keep training appear
    page = await open(`?seed=${SEED}&view=train`);
    await page.waitForFunction(() => (window.__training?.gen ?? 0) >= 2, null, { timeout: 120_000 });
    await page.click('#tvStop');
    await waitState(page, 'stopped', 120_000);
    s = await status(page);
    const k = s?.gen ?? 0;
    const nodeStop = await runPhase(new InlineExecutor(), defaultSpec(), SEED, { generations: GENS, stepTicks: (env) => env.worstCase(CONFIG.train.population), stop: (() => { let n = 0; return () => n++ >= k; })() });
    const nodeLimit = await runPhase(new InlineExecutor(), defaultSpec(), SEED, { T: phaseBudget(GENS), generations: k });
    sv = await saved(page);
    check(s?.savedOnStop === true && nodeStop.gens.length === k && genomeHash(sv.genome) === genomeHash(nodeStop.final) && genomeHash(nodeStop.final) === genomeHash(nodeLimit.final) && sv.train.phases === 1,
      `Stop after gen ${k}: the best agent so far is saved (= Node stopped there = Node asked for ${k} generations), phases ${sv.train.phases}`);
    const btn = await page.evaluate(() => ['tvDrive', 'tvAgain', 'tvBack', 'tvStop'].map((id) => !(document.getElementById(id) as HTMLElement).hidden));
    check(btn.join() === 'true,true,true,false' && (await page.locator('#tvAgain').innerText()) === 'Keep training', 'after Stop: Drive, Keep training and Back, as at the end of a run');
    await page.context().close();

    // 5. the layout (light and dark, desktop and landscape phone), mid-training and at the end, with screenshots
    type Box = { x: number; y: number; w: number; h: number };
    interface Lay { W: number; H: number; A: Box; panel: Box; scene: Box; cam: Box; mini: Box; map: Box; graph: Box; big: Box; btns: Box[]; bigText: string; bigSize: number; bigColor: string; sw: number; cw: number; cars: string; halves: number[]; top: number[][]; topOk: boolean }
    // as a string: the bundler's name helper isn't defined inside the page
    const layout = (page: Page) => page.evaluate(`(() => {
      const r = (sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
      const big = document.getElementById('tvBig'), cs = getComputedStyle(big);
      const btns = [...document.querySelectorAll('#trainOverlay .tv-info button')].filter((b) => b.offsetParent).map((b) => { const q = b.getBoundingClientRect(); return { x: q.left, y: q.top, w: q.width, h: q.height }; });
      return {
        W: innerWidth, H: innerHeight, A: r('#arena'), panel: r('#trainOverlay .tv-info'), scene: r('#scene'), cam: r('#trainOverlay .tv-cam'), mini: r('#trainOverlay .tv-brainc'), map: r('#tvMap'), graph: r('#tvGraph'), big: r('#tvBig'), btns,
        bigText: big.textContent, bigSize: parseFloat(cs.fontSize), bigColor: cs.color, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
        cars: document.getElementById('tvCars').textContent,
        halves: [...document.querySelectorAll('#trainOverlay .tv-half')].map((e) => e.getBoundingClientRect().height),
        top: ['#tvMenu', '#musicTv', '#sfxTv'].map((s) => { const q = document.querySelector(s).getBoundingClientRect(); return [q.width, q.height]; }),
        topOk: (() => { const q = (s) => document.querySelector(s).getBoundingClientRect(), row = q('#trainOverlay .side-top'), m = q('#tvMenu'), a = q('#musicTv'), b = q('#sfxTv'), h1 = q('#trainOverlay .tv-half');
          return row.bottom <= h1.top + 0.5 && [m, a, b].every((x) => x.top >= row.top - 0.5 && x.bottom <= row.bottom + 0.5) && m.right + 12 <= a.left && a.right < b.left; })(),
      };
    })()`) as Promise<Lay>;
    const near = (a: number, b: number, d = 1.5) => Math.abs(a - b) <= d;
    const inside = (a: Box, b: Box) => a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.w <= b.x + b.w + 0.5 && a.y + a.h <= b.y + b.h + 0.5;
    const apart = (a: Box, b: Box) => a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
    const judge = (L: Lay, label: string, gen: number) => {
      const pw = 0.25 * L.W, camW = L.W - pw; // the sidebar: a quarter of the width (sidebar plan 2026-11-05)
      // the arena ends above the storage notice while it shows
      const okP = near(L.panel.x, 0) && near(L.panel.w, pw) && near(L.panel.h, L.A.h) && near(L.scene.x, pw) && near(L.scene.x + L.scene.w, L.W) && near(L.cam.x, pw);
      check(okP,
        `${label}: the sidebar is its own section on the left (${Math.round(L.panel.w)} px = 25vw), the camera fills the rest${okP ? '' : ` (panel ${JSON.stringify(L.panel)}, scene ${JSON.stringify(L.scene)}, arena ${JSON.stringify(L.A)})`}`);
      check(near(L.mini.x + L.mini.w, L.W - 10) && near(L.mini.y + L.mini.h, L.A.y + L.A.h - 10) && near(L.mini.w, Math.min(0.28 * camW, 300), 2) && near(L.mini.h / L.mini.w, 0.75, 0.02),
        `${label}: the live brain in the camera's bottom-right (${Math.round(L.mini.w)}×${Math.round(L.mini.h)}, 4:3, 10 px margins)`);
      check(inside(L.map, L.panel) && inside(L.graph, L.panel) && L.map.y >= L.graph.y + L.graph.h - 0.5 && L.map.h > 40 && L.map.w > 0.8 * pw,
        `${label}: the map in the sidebar under the fitness graph (${Math.round(L.map.w)}×${Math.round(L.map.h)})`);
      const want = Math.max(40, Math.min(0.09 * L.H, 88));
      check(L.bigText === String(gen) && near(L.bigSize, want, 0.6) && L.bigColor === 'rgb(255, 255, 255)' && near(L.big.x + L.big.w / 2, pw + camW / 2, 2) && L.big.y >= 0 && apart(L.big, L.mini),
        `${label}: generation ${L.bigText} big and white at the top centre of the camera (${L.bigSize.toFixed(1)} px, want ${want.toFixed(1)})`);
      check(L.btns.length > 0 && L.btns.every((b) => inside(b, L.panel)) && L.sw <= L.cw, `${label}: the panel's buttons inside it; no sideways scroll`);
      check(L.halves.length === 2 && near(L.halves[0], L.halves[1]), `${label}: the fitness graph and the map each take half the sidebar under its top row (${L.halves.map((x) => x.toFixed(0)).join(' / ')} px; match polish §5)`);
      check(L.topOk && L.top.every((b) => b[0] >= 44 && b[1] >= 44), `${label}: Main menu, Music and Sound effects in their own row at the top, at least 44 px (${L.top.map((b) => b.map((x) => x.toFixed(0)).join('×')).join(', ')})`);
    };
    for (const [w, h, dark] of [[1440, 900, false], [1440, 900, true], [844, 390, false], [844, 390, true]] as const) {
      const tag = `${w}x${h}${dark ? '-dark' : ''}`;
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: dark ? 'dark' : 'light', isMobile: w < 900, hasTouch: w < 900 });
      await fixtureBrain(ctx);
      page = await ctx.newPage();
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`${base}?seed=${SEED}&view=train`);
      await page.waitForFunction(() => window.__training?.state === 'running' && window.__training.shownGen > 1, null, { timeout: 300_000 });
      await page.waitForTimeout(400);
      let L = await layout(page);
      s = await status(page);
      judge(L, `${tag} mid-training`, Number(L.bigText));
      await page.screenshot({ path: `${OUT}/mid-${tag}.png` });
      await waitState(page, 'done');
      await page.waitForFunction(() => window.__training?.finale === true, null, { timeout: 300_000 });
      await page.waitForTimeout(1500);
      L = await layout(page);
      s = await status(page);
      judge(L, `${tag} at the end`, s?.shownGen ?? -1);
      check(L.cars === 'champion', `${tag} at the end: the champion's lap (map: ${L.cars})`);
      await page.screenshot({ path: `${OUT}/end-${tag}.png` });
      await ctx.close();
    }

    // 6. the playback at the real T: every generation recorded and offered; shown in order, never twice, each newer
    //    one after the ~2 s minimum, starting further along; then the champion's lap; finish flags; bloom audits
    page = await open(`?seed=${SEED}&view=train`);
    await page.waitForFunction(() => window.__training?.shownGen === 1, null, { timeout: 120_000 });
    // gen 1 from its start: the cars on the line, the chequered band and both flags in view
    const a1 = await page.evaluate(() => [0.1, 0.6].map((t) => window.__training!.auditAt!(t)));
    check(a1.every((a) => a.over === 0 && a.gen === 1), `bloom audit, gen 1 at the start line (0.1, 0.6 s): over ${a1.map((a) => (a.over * 100).toFixed(3) + '%').join(' ')} (max ${Math.max(...a1.map((a) => a.max)).toFixed(2)})`);
    await page.screenshot({ path: `${OUT}/gen1-start.png` });
    s = await status(page);
    check(s?.flags === 2, `the finish line has a chequered flag on a black pole each side (${s?.flags})`);
    const ghosts = s?.ghosts ?? 0, cars = await page.locator('#tvCars').innerText();
    check(ghosts === CONFIG.train.population && (s?.ghostCapacity ?? 0) >= ghosts && cars === `${ghosts} of ${CONFIG.train.population}`,
      `${ghosts} ghosts a generation (the whole population, ${s?.quality} quality), capacity ${s?.ghostCapacity}; map says "${cars}"`);
    await page.waitForFunction(() => { const s = window.__training!; return s.shownGen > 1 && !s.finale && s.state === 'running'; }, null, { timeout: 300_000 });
    const midA = await page.evaluate(() => window.__training!.auditAt!(0.5));
    check(midA.over === 0, `bloom audit, gen ${midA.gen} at 0.5 s: over ${(midA.over * 100).toFixed(3)}% (max ${midA.max.toFixed(2)})`);
    await waitState(page, 'done');
    await page.waitForFunction(() => window.__training?.finale === true, null, { timeout: 300_000 });
    await page.waitForTimeout(3500);
    await page.screenshot({ path: `${OUT}/champion-loop.png` });
    const fin = await page.evaluate(() => [1, 4, 8, 12, 16, 20].map((t) => window.__training!.auditAt!(t)));
    check(fin.every((a) => a.finale && a.over === 0), `bloom audit, finale at 1/4/8/12/16/20 s: over ${fin.map((a) => (a.over * 100).toFixed(3) + '%').join(' ')} (max ${Math.max(...fin.map((a) => a.max)).toFixed(2)})`);
    s = await status(page);
    const log = s?.shown ?? [], story = log.filter((l) => l.offset >= 0), gens = story.map((l) => l.gen), last = log[log.length - 1];
    console.log(`     shown ${log.map((l) => `${l.gen}${l.offset < 0 ? ' (champion)' : `@${l.offset}`}`).join(' → ')}; done in ${((s?.ms ?? 0) / 1000).toFixed(1)} s`);
    check((s?.offered.length ?? 0) === s?.gen && (s?.offered ?? []).every((g, i) => g === i + 1), `every generation recorded its handful and was offered (${s?.offered.length} of ${s?.gen})`);
    check(gens.length >= 3 && gens.every((g, i) => i === 0 || g > gens[i - 1]) && new Set(log.slice(0, -1).map((l) => l.gen)).size === log.length - 1,
      `generations shown strictly in order, none twice: ${gens.join(', ')}`);
    check(story.every((l, i) => i === 0 || l.offset >= story[i - 1].offset) && story[story.length - 1].offset > story[0].offset,
      `each starts further along (offsets ${story.map((l) => l.offset).join(', ')} ticks, never shrinking)`);
    check(story.every((l, i) => i === 0 || l.at - story[i - 1].at >= 1.9), `each newer one after the ~2 s minimum (gaps ${story.slice(1).map((l, i) => (l.at - story[i].at).toFixed(1)).join(', ')} s)`);
    check(gens.some((g) => ![1, 10, 25, 50, GENS].includes(g)), 'not only round-number generations');
    check(last?.offset === -1 && s?.finale === true && gens[gens.length - 1] === s?.gen, `then the champion's lap (gen ${last?.gen}), never generation 1 again`);
    // a loaded machine has the odd slow frame anywhere (a GC pause): compare with the steady frames' 95th percentile and
    // allow 20 ms on top, well under what preparing 64 cars at once on the main thread cost (a 35 ms replay alone)
    const sf = s?.switchFrameMs ?? 99, st = s?.steadyFrameMs ?? 0, p95 = s?.steadyP95Ms ?? 0, lim = Math.max(2 * p95, p95 + 20);
    check(sf <= lim, `no frame spike when a generation's 64 ghosts come in: worst ${sf.toFixed(1)} ms (limit ${lim.toFixed(1)}; steady median ${st.toFixed(1)}, 95th ${p95.toFixed(1)})${sf > lim ? ` (${s?.switchFrames.join(' ')})` : ''}`);
    check((s?.prepMs ?? 99) < 25, `no spike preparing a generation: at most ${(s?.prepMs ?? 0).toFixed(1)} ms of main-thread work (its paths and firing come from the workers)`);
    await page.context().close();

    check(errors.length === 0, `console clean${errors.length ? ': ' + errors.join(' | ') : ''}`);
  } finally {
    await browser.close();
    await server.close();
  }
  if (fails) { console.error(`training: ${fails} check(s) failed`); process.exit(1); }
  console.log(`training: all checks passed; screenshots in ${OUT}/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
