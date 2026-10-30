// Drive view browser check (S4), headless Chromium on SwiftShader:
// - Train a tiny T from the workbench, press Drive: the car drives, the distance shown increases, and the drive's
//   hash equals a Node replay of the same genome on the same track seed (runDrive).
// - Render smoke (lit, not uniform), bloom audit (scenery under the threshold), console clean.
// - Cameras switch; New track re-seeds (new hash); Back returns to the workbench, which now offers Drive.
// - A brain that pins itself shows "Stuck against the wall" with the time, and the camera keeps moving (no frozen
//   frame); an over-budget brain shows static. 844×390: panels apart, no horizontal scroll.
// Screenshots → out/s4/.
//   npx tsx scripts/checks/drive.ts
import { mkdirSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer } from 'vite';
import { CONFIG } from '../../src/common/config';
import { addLayer, addNeuron, draftOf, genomeHash, type Draft } from '../../src/common/sim/brain';
import { estimate } from '../../src/common/sim/energy';
import { runDrive } from '../../src/common/sim/race';
import type { Genome } from '../../src/common/sim/spec';
import { InlineExecutor } from '../../src/common/train/episodes';
import { phaseSeeds, runPhase } from '../../src/common/train/phase';
import { starterSpec } from '../../src/common/sim/brain';
import { parse, SAVE_KEY, serialize } from '../../src/client/ui/workbench/store';

const OUT = 'out/s4';
const T = 1_000_000;
const SEED = 7;
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
let fails = 0;
const check = (cond: boolean, what: string) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (!cond) fails++; };

/** A brain that turns hard left at full power: it pins itself on the wall within a second or two. */
const pinned: Genome = {
  spec: { v: 1, layers: 1, nodes: [], conns: ['o:fl', 'o:rl', 'o:fr', 'o:rr'].map((to) => ({ from: 'i:bias', to })) },
  w: [0.3, 0.3, 1, 1],
};

async function main() {
  mkdirSync(OUT, { recursive: true });
  const trained = (await runPhase(new InlineExecutor(), starterSpec(), SEED, { T })).final;
  const firstTrack = phaseSeeds(SEED, 0).unseenTrack;
  const node = runDrive(trained, firstTrack);
  // a mid-corner moment for the chase screenshot: the car on the tightest bend it reaches in the first 40 s
  let corner = 200, best = 0;
  for (let k = 100; k < 800; k++) { const c = Math.abs(node.track.curv[locateNear(node, k)]); if (c > best) { best = c; corner = k; } }
  // over budget: the trained brain plus eleven idle tanh neurons (upkeep only: line 1 filled, a second line of four)
  let over: Draft = draftOf(trained, 4);
  const grow = (r: ReturnType<typeof addNeuron>) => { if (!r.ok) throw new Error(r.reason); over = r.draft; };
  for (let k = 0; k < 7; k++) grow(addNeuron(over, 1, 'tanh'));
  grow(addLayer(over, 'tanh'));
  for (let k = 0; k < 3; k++) grow(addNeuron(over, 2, 'tanh'));
  if (estimate(over.genome.spec).total <= CONFIG.budget[0]) throw new Error('over-budget test brain is not over budget');

  const server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
  await server.listen();
  const addr = server.httpServer?.address();
  if (!addr || typeof addr === 'string') throw new Error('no server address');
  const base = `http://127.0.0.1:${addr.port}/`;
  let browser: Browser;
  try { browser = await chromium.launch({ args: ARGS }); } catch { browser = await chromium.launch({ executablePath: CHROMIUM, args: ARGS }); }
  const errors: string[] = [];
  async function open(query: string, w = 1440, h = 900, mobile = false, save?: Genome): Promise<Page> {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    if (save) {
      await page.goto(base);
      await page.evaluate(([k, v]) => localStorage.setItem(k, v), [SAVE_KEY, serialize({ name: 'Test brain', draft: draftOf(save), train: { seed: null, phases: 0 } })]);
    }
    await page.goto(base + query);
    return page;
  }
  const drive = (page: Page) => page.evaluate(() => { const d = window.__drive; return d ? { ...d, probe: undefined, bloomAudit: undefined, seek: undefined, setCam: undefined, camPos: undefined } : null; });
  const waitFrames = (page: Page, n = 3) => page.waitForFunction((x) => (window.__drive?.frames ?? 0) > x, n, { timeout: 120_000 });

  try {
    // 1. train a tiny T, then Drive from the finished training view
    let page = await open(`?seed=${SEED}&T=${T}&view=train`);
    await page.waitForFunction(() => window.__training?.state === 'done', null, { timeout: 300_000 });
    const sv = parse(await page.evaluate((k) => localStorage.getItem(k), SAVE_KEY)).saved;
    check(genomeHash(sv.draft.genome) === genomeHash(trained), 'trained brain saved (= Node run)');
    await page.click('#tvDrive');
    await waitFrames(page);
    let d = await drive(page);
    check(d?.trackSeed === firstTrack, `drives the unseen track of its training run (${d?.trackSeed})`);
    check(d?.hash === node.hash, `drive hash ${d?.hash} = Node replay ${node.hash}`);
    const d0 = d?.distance ?? 0;
    await page.waitForTimeout(3000);
    d = await drive(page);
    check((d?.distance ?? 0) > d0 + 1, `distance shown increases (${d0.toFixed(0)} → ${(d?.distance ?? 0).toFixed(0)} m)`);
    const pr = await page.evaluate(() => window.__drive!.probe!());
    check(pr.mean > 30 && pr.sd > 5, `render smoke: mean luminance ${pr.mean.toFixed(1)}, spread ${pr.sd.toFixed(1)}`);
    const au = await page.evaluate(() => window.__drive!.bloomAudit!());
    check(au.over === 0, `bloom audit: ${(au.over * 100).toFixed(3)}% of non-glow pixels over the threshold (max ${au.max.toFixed(2)})`);
    // chase mid-corner, broadcast, showroom
    await page.evaluate((s) => window.__drive!.seek(s), corner / 20 - 0.6);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/chase-corner.png` });
    for (const [cam, file] of [['tv', 'broadcast'], ['orbit', 'showroom']] as const) {
      await page.click(`#driveOverlay [data-cam="${cam}"]`);
      await page.waitForTimeout(1800);
      check((await drive(page))?.cam === cam, `camera switches to ${cam}`);
      await page.screenshot({ path: `${OUT}/${file}.png` });
    }
    // new track
    await page.click('#dvNew');
    await page.waitForFunction((s) => window.__drive && window.__drive.trackSeed !== s, firstTrack, { timeout: 60_000 });
    await waitFrames(page);
    d = await drive(page);
    check(d?.hash !== node.hash && d?.hash === runDrive(trained, d!.trackSeed).hash, `New track re-seeds (${d?.trackSeed}); its hash matches Node too`);
    // back to the workbench: Drive is offered for a trained brain
    await page.click('#dvBack');
    check(await page.locator('.app').isVisible() && await page.locator('#drive').isVisible(), 'Back to workbench; the workbench shows Drive for the trained brain');
    await page.context().close();
    page = await open('');
    check(!(await page.locator('#drive').isVisible()), 'an untrained Starter has no Drive button');
    await page.context().close();

    // 2. stuck
    page = await open(`?view=drive&track=12345`, 1440, 900, false, pinned);
    await waitFrames(page);
    await page.evaluate(() => window.__drive!.seek(20));
    await page.waitForFunction(() => window.__drive?.stuck === true, null, { timeout: 60_000 });
    await page.waitForTimeout(600);
    const note = await page.locator('#dvStuck').innerText();
    const c0 = await page.evaluate(() => window.__drive!.camPos());
    await page.waitForTimeout(1500);
    const c1 = await page.evaluate(() => window.__drive!.camPos());
    const moved = Math.hypot(c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]);
    check(/Stuck against the wall since \d+:\d\d/.test(note), `stuck note: "${note}"`);
    check(moved > 0.3, `camera keeps moving round the stuck car (${moved.toFixed(2)} m in 1.5 s): not a frozen frame`);
    await page.screenshot({ path: `${OUT}/stuck.png` });
    await page.context().close();

    // 3. over budget
    page = await open(`?view=drive&track=${firstTrack}`, 1440, 900, false, over.genome);
    await waitFrames(page);
    await page.evaluate(() => window.__drive!.seek(6));
    await page.waitForFunction(() => (window.__drive?.noise ?? 0) > 0, null, { timeout: 60_000 });
    await page.waitForTimeout(800);
    check(await page.locator('#dvStatic').isVisible(), `over budget: static shown (${await page.locator('#dvStatic').innerText()})`);
    await page.screenshot({ path: `${OUT}/over-budget.png` });
    await page.context().close();

    // 4. landscape phone
    page = await open(`?view=drive&track=${firstTrack}`, 844, 390, true, trained);
    await waitFrames(page);
    await page.evaluate((s) => window.__drive!.seek(s), corner / 20 - 0.6);
    await page.waitForTimeout(1200);
    const lay = await page.evaluate(() => {
      const a = document.querySelector('.dv-status')!.getBoundingClientRect(), b = document.querySelector('.dv-brain')!.getBoundingClientRect();
      return { overlap: a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, fits: a.bottom <= innerHeight };
    });
    check(!lay.overlap && lay.sw <= lay.cw && lay.fits, `844×390: panels apart and on screen, no horizontal scroll`);
    await page.screenshot({ path: `${OUT}/drive-844x390.png` });
    await page.context().close();

    check(errors.length === 0, `console clean${errors.length ? ': ' + errors.join(' | ') : ''}`);
  } finally {
    await browser.close();
    await server.close();
  }
  if (fails) { console.error(`drive: ${fails} check(s) failed`); process.exit(1); }
  console.log(`drive: all checks passed; screenshots in ${OUT}/`);
}

/** Nearest centreline sample to the recorded car at tick k (brute force; checks only). */
function locateNear(run: ReturnType<typeof runDrive>, k: number): number {
  const t = run.track, x = run.rec.x[k], y = run.rec.y[k];
  let bi = 0, bd = Infinity;
  for (let i = 0; i < t.n; i++) { const d = (t.px[i] - x) ** 2 + (t.py[i] - y) ** 2; if (d < bd) { bd = d; bi = i; } }
  return bi;
}

main().catch((e) => { console.error(e); process.exit(1); });
