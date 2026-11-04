// Training view browser check (S3), headless Chromium on SwiftShader:
// - Train from the designer (the generations popup, default 100) finishes; the saved genome hash changes; the phase hash equals the Node run's.
// - 1 vs 4 workers (and the default pool) → the same hash; training the same saved brain twice → the same result.
// - Train again continues from the saved weights (carry, next phase) and matches Node; Stop leaves the brain as it was.
// - Ghost capacity ≥ population; render smoke: the frame is lit and not uniform (no black bloom frame); console clean.
// - The story: gen 1 first, chosen generations in order, ending on the final one, then the champion's lap (finale);
//   bloom audit: no scenery pixel above the bloom threshold (only lights, strips, pads and lamps glow).
// - 844×390: no horizontal scroll and the two panels do not overlap.
// Screenshots → out/s3/ (full T: gen-1 crashes, mid story and the champion's lap at 1440×900; 844×390).
//   npx tsx scripts/checks/training.ts
import { mkdirSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer } from 'vite';
import { CONFIG } from '../../src/common/config';
import { defaultGenome, genomeHash } from '../../src/common/sim/brain';
import { defaultSpec } from '../../src/common/sim/spec';
import { InlineExecutor } from '../../src/common/train/episodes';
import { runPhase } from '../../src/common/train/phase';
import { parse, SAVE_KEY } from '../../src/client/ui/designer/store';

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
    let page = await open(`?seed=${SEED}&T=${T}`);
    await train(page);
    await page.waitForFunction(() => (window.__training?.frames ?? 0) > 2, null, { timeout: 120_000 });
    const pr = await page.evaluate(() => window.__training!.probe!());
    check(pr.mean > 30 && pr.sd > 5, `render smoke: mean luminance ${pr.mean.toFixed(1)}, spread ${pr.sd.toFixed(1)} (${pr.w}×${pr.h})`);
    await waitState(page, 'done');
    let s = await status(page);
    let sv = await saved(page);
    check(s?.hash === node1.hash, `browser phase hash ${s?.hash} = Node ${node1.hash} (${s?.workers} workers)`);
    check(genomeHash(sv.genome) !== starterHash && genomeHash(sv.genome) === genomeHash(node1.final), 'trained genome saved; hash changed from the untrained starting brain and equals Node\'s');
    check(sv.train.seed === SEED && sv.train.phases === 1, `training history saved (seed ${sv.train.seed}, phases ${sv.train.phases})`);
    check((s?.ghostCapacity ?? 0) >= CONFIG.train.population, `ghost capacity ${s?.ghostCapacity} ≥ population ${CONFIG.train.population}`);
    check(s?.webgl === true && (s?.frames ?? 0) > 0, `3-D view drew ${s?.frames} frames (${s?.quality} quality)`);
    const snapshot = await page.evaluate((k) => localStorage.getItem(k), SAVE_KEY);

    // 2. back to the workbench, then Train again: carry, next phase
    await page.click('#tvBack');
    check(await page.locator('.app').isVisible() && !(await page.locator('#trainView').isVisible()), 'Back to workbench shows the designer');
    await train(page);
    await waitState(page, 'running', 60_000);
    await waitState(page, 'done');
    s = await status(page);
    sv = await saved(page);
    check(s?.start === 'carry' && s?.phase === 1 && s?.hash === node2.hash, `Train again continues from the saved weights (carry, run 2), hash ${s?.hash} = Node ${node2.hash}`);
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

    // 4. Stop keeps the brain as it was
    page = await open(`?seed=${SEED}&view=train`);
    await page.waitForFunction(() => (window.__training?.gen ?? 0) >= 2, null, { timeout: 120_000 });
    await page.click('#tvStop');
    await waitState(page, 'stopped', 120_000);
    check(genomeHash((await saved(page)).genome) === starterHash, 'Stop: the brain keeps its weights (still the untrained starting brain)');
    await page.context().close();

    // 5. landscape phone
    page = await open(`?seed=${SEED}&view=train`, 844, 390, true);
    await page.waitForFunction(() => (window.__training?.shownGen ?? 0) > 0, null, { timeout: 120_000 });
    await page.waitForTimeout(1300);
    const lay = await page.evaluate(() => {
      const a = document.querySelector('.tv-status')!.getBoundingClientRect(), b = document.querySelector('.tv-graph')!.getBoundingClientRect();
      const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      return { overlap, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, fits: a.bottom <= innerHeight && b.top >= 0 };
    });
    check(!lay.overlap && lay.sw <= lay.cw && lay.fits, `844×390: panels apart and on screen, no horizontal scroll (${lay.sw} ≤ ${lay.cw})`);
    await page.screenshot({ path: `${OUT}/training-844x390.png` });
    check((await status(page))?.state === 'running', '844×390 screenshot taken mid-training');
    await page.context().close();

    // 6. the story at the real T, with screenshots
    page = await open(`?seed=${SEED}&view=train`);
    const seen: number[] = [];
    const watch = setInterval(() => {
      page.evaluate(() => window.__training?.shownGen ?? 0).then((g) => { if (g && seen[seen.length - 1] !== g) seen.push(g); }).catch(() => {});
    }, 150);
    await page.waitForFunction(() => window.__training?.shownGen === 1, null, { timeout: 120_000 });
    await page.waitForTimeout(1300); // gen 1 a little way in: the first crashes
    await page.screenshot({ path: `${OUT}/gen1-crashes.png` });
    // bloom audit on fixed frames (seek + snapped camera), so a pass means pass
    const a1 = await page.evaluate(() => window.__training!.auditAt!(1.0));
    check(a1.over === 0, `bloom audit, gen ${a1.gen} at 1.0 s: ${(a1.over * 100).toFixed(3)}% of non-glow pixels over the threshold (max ${a1.max.toFixed(2)})`);
    await page.waitForFunction(() => { const s = window.__training!; return s.shownGen > 1 && !s.finale && s.shownGen < s.gen; }, null, { timeout: 300_000 });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/story-mid.png` });
    const mid = await status(page);
    await waitState(page, 'done');
    await page.waitForFunction(() => window.__training?.finale === true, null, { timeout: 300_000 });
    await page.waitForTimeout(3500);
    await page.screenshot({ path: `${OUT}/champion-loop.png` });
    const fin = await page.evaluate(() => [1, 4, 8, 12, 16, 20].map((t) => window.__training!.auditAt!(t)));
    check(fin.every((a) => a.finale && a.over === 0), `bloom audit, finale at 1/4/8/12/16/20 s: over ${fin.map((a) => (a.over * 100).toFixed(3) + '%').join(' ')} (max ${Math.max(...fin.map((a) => a.max)).toFixed(2)})`);
    clearInterval(watch);
    s = await status(page);
    const story = s?.story ?? [];
    console.log(`     story recorded ${story.join(', ')}; on screen ${seen.join(' → ')}; mid shot gen ${mid?.shownGen}; done in ${((s?.ms ?? 0) / 1000).toFixed(1)} s`);
    check(seen[0] === 1 && seen.every((g, k) => k === 0 || g > seen[k - 1]) && seen[seen.length - 1] === s?.gen && seen.length >= 4,
      `story plays gen 1 first, then later generations in order, ending on the final gen ${s?.gen}`);
    check(story.length >= 4 && story[0] === 1, `story generations recorded by count: ${story.join(', ')}`);
    check(s?.finale === true, 'finished state loops the champion with its generation (never an empty road)');
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
