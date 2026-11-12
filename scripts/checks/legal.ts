// Legal check: the privacy policy and terms are MOUFTOOLS-wide, at mouftools.com (principal 2026-11-12). Build, then serve
// dist/ with vercel.json's redirects and rewrites applied (a small stand-in for Vercel's router: exact sources and the
// catch-all), and check in headless Chromium that /privacy, /terms and /cookies (and their .html forms) redirect to the
// Synapse sections of the shared pages, other paths still fall back to the app, the first-visit notice shows, links the
// policy, goes once dismissed and stays gone, the title rail links both pages, no cookies are set, console clean.
//   npx tsx scripts/checks/legal.ts
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { build } from 'vite';

const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const PRIVACY = 'https://mouftools.com/privacy#synapse', TERMS = 'https://mouftools.com/terms#synapse';
const SLUGS: [string, string][] = [['/privacy', PRIVACY], ['/cookies', PRIVACY], ['/terms', TERMS]];
let fails = 0;
const check = (cond: boolean, what: string) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (!cond) fails++; };

interface Rule { source: string; destination: string; permanent?: boolean }
const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as { redirects?: Rule[]; rewrites: Rule[] };
const matches = (src: string, path: string) => (src.includes('(') ? new RegExp(`^${src}$`).test(path) : src === path);
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.png': 'image/png' };

async function main() {
  await build({ logLevel: 'warn' });
  check(['privacy', 'terms', 'cookies'].every((p) => !existsSync(`dist/${p}.html`)), 'no legal pages of its own in dist/ (they live at mouftools.com)');

  // a stand-in for Vercel: redirects, then a real file, then rewrites (first match wins)
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const red = vercel.redirects?.find((r) => matches(r.source, path));
    if (red) { res.writeHead(red.permanent ? 308 : 307, { Location: red.destination }); res.end(); return; }
    let file = path === '/' ? '/index.html' : path;
    if (!existsSync(join('dist', file)) || file.endsWith('/')) {
      const rew = vercel.rewrites.find((r) => matches(r.source, path));
      file = rew ? rew.destination : file;
    }
    const full = join('dist', file);
    if (!existsSync(full)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[extname(full)] ?? 'application/octet-stream' });
    res.end(readFileSync(full));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  const base = `http://127.0.0.1:${addr.port}`;

  for (const [slug, to] of SLUGS) for (const path of [slug, `${slug}.html`]) {
    const r = await fetch(`${base}${path}`, { redirect: 'manual' });
    check(r.status === 307 && r.headers.get('location') === to, `${path} redirects to ${to}`);
  }

  let browser: Browser;
  try { browser = await chromium.launch(); } catch { browser = await chromium.launch({ executablePath: CHROMIUM }); }
  const errors: string[] = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto(`${base}/`);
    await page.waitForSelector('#notice', { timeout: 10000 });
    check(await page.locator(`#notice a[href="${PRIVACY}"]`).count() === 1, 'first visit: the notice shows, linking the privacy policy');
    const links = await page.$$eval('#title .rail .legal-links a', (as) => as.map((a) => a.getAttribute('href')));
    check(JSON.stringify(links) === JSON.stringify([PRIVACY, TERMS]), `title rail links: ${links.join(' ')}`);
    const nb = await page.locator('#notice').boundingBox();
    check(!!nb && Math.abs(nb.y + nb.height - 800) < 1, 'notice sits at the bottom of the screen');

    await page.locator('#notice button').click();
    check(await page.locator('#notice').count() === 0, 'OK dismisses the notice');
    await page.goto(`${base}/`); await page.waitForTimeout(800);
    check(await page.locator('#notice').count() === 0, 'dismissed notice stays gone on the next visit');
    check(await page.evaluate(() => localStorage.getItem('synapse.notice')) === '3', 'dismissal remembered in local storage (synapse.notice = 3, the notice version since the name and the chosen track)');
    // a returning visitor who dismissed the notice before the name and track were stored (version 2) sees it again
    await page.evaluate(() => localStorage.setItem('synapse.notice', '2'));
    await page.goto(`${base}/`);
    check(await page.locator('#notice').count() === 1 && /your name, your chosen track/.test(await page.locator('#notice').innerText()), 'a visitor who dismissed version 2 sees the notice again (it now names the name and the chosen track)');
    await page.locator('#notice button').click();
    const r = await page.goto(`${base}/some/unknown/path`);
    check(r?.status() === 200 && await page.locator('.app').count() === 1, 'an unknown path still falls back to the app');
    check((await ctx.cookies()).length === 0, 'no cookies set');
    await ctx.close();
  } finally {
    await browser.close();
    server.close();
  }
  check(errors.length === 0, `console clean${errors.length ? ': ' + errors.join(' | ') : ''}`);
  console.log(fails ? `\n${fails} FAILED` : '\nlegal: all ok');
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
