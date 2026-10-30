// Browser bench (criterion e): serve /bench/ with Vite, run one Starter phase in headless Chromium, report the time
// and check the hash equals the Node run (same code, same split → same bits). Also derives the T that would fit
// 7 s on this machine (largest 0.5M multiple, clamped 1.5M–6M). This container is not the reference desktop; the
// 7 s criterion is confirmed there.
//   npx tsx scripts/checks/bench-browser.ts [--seed 1] [--workers 1,3,4]
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { CONFIG } from '../../src/common/config';
import { starterSpec } from '../../src/common/sim/brain';
import { runPhase } from '../../src/common/train/phase';
import { NodePool } from '../sim/nodePool';

const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const seed = Number(arg('seed', '1'));
const workerList = arg('workers', '1,3,4').split(',').map(Number);
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';

interface Run { ms: number; setupMs: number; hash: string; gens: number; ticks: number }

async function main() {
  const pool = new NodePool(4);
  const node = await runPhase(pool, starterSpec(), seed, { now: () => performance.now() });
  await pool.close();
  const server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
  await server.listen();
  const addr = server.httpServer?.address();
  if (!addr || typeof addr === 'string') throw new Error('bench-browser: no server address');
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  } catch {
    browser = await chromium.launch({ headless: true, executablePath: CHROMIUM, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  }
  const errors: string[] = [];
  let bad = 0;
  const rows: string[] = [];
  let fastest = Infinity, ticksAtFastest = 0;
  try {
    for (const w of workerList) {
      const page = await browser.newPage();
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`http://127.0.0.1:${addr.port}/bench/?seed=${seed}&workers=${w}&runs=2`);
      await page.waitForFunction(() => window.__bench?.done === true, null, { timeout: 300_000 });
      const res = await page.evaluate(() => window.__bench!);
      await page.close();
      if (res.error) throw new Error(`bench page: ${res.error}`);
      const best = res.runs.reduce((a: Run, b: Run) => (b.ms < a.ms ? b : a));
      const same = res.runs.every((r: Run) => r.hash === node.hash);
      if (!same) bad++;
      if (best.ms < fastest) { fastest = best.ms; ticksAtFastest = best.ticks; }
      rows.push(`chrome ${w} worker(s): ${(best.ms / 1000).toFixed(2)} s best of ${res.runs.length} (${res.runs.map((r: Run) => (r.ms / 1000).toFixed(2)).join(', ')}), ${best.gens} gens, hash ${best.hash} ${same ? '= node' : '≠ node ' + node.hash}`);
    }
  } finally {
    await browser.close();
    await server.close();
  }
  const perTick = fastest / ticksAtFastest;
  const fit = Math.floor(7000 / perTick / 500_000) * 500_000;
  const T = Math.max(1_500_000, Math.min(6_000_000, fit));
  console.log(`node 4 workers: ${(node.trainMs / 1000).toFixed(2)} s, hash ${node.hash}`);
  for (const r of rows) console.log(r);
  console.log(`T that fits 7 s here: ${fit.toLocaleString('en')} → clamped ${T.toLocaleString('en')} (config T = ${CONFIG.train.T.toLocaleString('en')}); this machine is not the reference desktop`);
  if (errors.length) { console.error(`console errors:\n${errors.join('\n')}`); bad++; }
  if (bad) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
