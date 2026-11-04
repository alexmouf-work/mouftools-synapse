// Production check (S5): build with `vite build`, serve dist/ with `vite preview` (static, SPA fallback, like
// Vercel) and run the real app at the real budget in headless Chromium (SwiftShader):
// workbench loads; Train (seed 7, T = CONFIG.train.T) finishes with the same phase hash as Node; render smoke on the
// training view; Drive: distance increases, drive hash = Node runDrive, render smoke, bloom audit on fixed frames;
// an unknown path falls back to the app; the dev-only /bench page is not in the build; console clean.
//   npx tsx scripts/checks/preview.ts
import { existsSync } from 'node:fs';
import { chromium, type Browser } from 'playwright';
import { build, preview } from 'vite';
import { CONFIG } from '../../src/common/config';
import { starterSpec } from '../../src/common/sim/brain';
import { runDrive } from '../../src/common/sim/race';
import { phaseSeeds, runPhase } from '../../src/common/train/phase';
import { NodePool } from '../sim/nodePool';

const SEED = 7;
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
let fails = 0;
const check = (cond: boolean, what: string) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (!cond) fails++; };

async function main() {
  await build({ logLevel: 'warn' });
  check(existsSync('dist/index.html') && !existsSync('dist/bench'), 'vite build: dist/index.html, no dev-only bench page');
  const pool = new NodePool(4);
  const node = await runPhase(pool, starterSpec(), SEED, {});
  await pool.close();
  const nodeDrive = runDrive(node.final, phaseSeeds(SEED, 0).unseenTrack);

  const server = await preview({ preview: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
  const addr = server.httpServer.address();
  if (!addr || typeof addr === 'string') throw new Error('no preview address');
  const base = `http://127.0.0.1:${addr.port}/`;
  let browser: Browser;
  try { browser = await chromium.launch({ args: ARGS }); } catch { browser = await chromium.launch({ executablePath: CHROMIUM, args: ARGS }); }
  const errors: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${base}?seed=${SEED}&T=500000`);
    check(await page.locator('#net').isVisible(), 'workbench loads from the production build');
    await page.click('#train');
    await page.waitForFunction(() => (window.__training?.frames ?? 0) > 2, null, { timeout: 120_000 });
    const pr = await page.evaluate(() => window.__training!.probe!());
    check(pr.mean > 30 && pr.sd > 5, `render smoke (training): mean luminance ${pr.mean.toFixed(1)}, spread ${pr.sd.toFixed(1)}`);
    await page.waitForFunction(() => window.__training?.state === 'done', null, { timeout: 900_000 });
    const st = await page.evaluate(() => ({ hash: window.__training!.hash, T: window.__training!.T, ms: window.__training!.ms }));
    check(st.T === CONFIG.train.T, `?T= is ignored in production (T = ${st.T})`);
    check(st.hash === node.hash, `phase hash ${st.hash} = Node ${node.hash} (${((st.ms ?? 0) / 1000).toFixed(1)} s with the view open)`);
    await page.click('#tvDrive');
    await page.waitForFunction(() => (window.__drive?.frames ?? 0) > 3, null, { timeout: 120_000 });
    await page.waitForFunction(() => window.__drive?.go === true, null, { timeout: 30_000 }); // the countdown holds the car until Go
    const d0 = await page.evaluate(() => window.__drive!.distance);
    await page.waitForTimeout(3000);
    const d = await page.evaluate(() => ({ hash: window.__drive!.hash, distance: window.__drive!.distance }));
    check(d.distance > d0 + 1, `drive: distance increases (${d0.toFixed(0)} → ${d.distance.toFixed(0)} m)`);
    check(d.hash === nodeDrive.hash, `drive hash ${d.hash} = Node replay ${nodeDrive.hash}`);
    const dp = await page.evaluate(() => window.__drive!.probe!());
    check(dp.mean > 30 && dp.sd > 5, `render smoke (drive): mean luminance ${dp.mean.toFixed(1)}, spread ${dp.sd.toFixed(1)}`);
    const aus = await page.evaluate(() => [2, 20, 45].map((t) => window.__drive!.auditAt(t)));
    check(aus.every((a) => a.over === 0), `bloom audit on fixed frames: max ${Math.max(...aus.map((a) => a.max)).toFixed(2)}`);
    await page.goto(`${base}some/deep/link`);
    check(await page.locator('#net').isVisible(), 'unknown path falls back to the app (SPA)');
    await page.close();
    check(errors.length === 0, `console clean${errors.length ? ': ' + errors.join(' | ') : ''}`);
  } finally {
    await browser.close();
    await new Promise<void>((r) => server.httpServer.close(() => r()));
  }
  if (fails) { console.error(`preview: ${fails} check(s) failed`); process.exit(1); }
  console.log('preview: all checks passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
