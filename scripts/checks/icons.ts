// Icons and web app check: build, then check the favicon, Apple touch icon and manifest are in dist/; the manifest
// names "Synapse", runs standalone and lists 192 and 512 px icons plus a maskable one, each PNG the size it claims;
// every page links the icons and the manifest; and in Chromium the manifest and icons load from the built site.
//   npx tsx scripts/checks/icons.ts
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { build } from 'vite';

const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const PAGES = ['index', 'privacy', 'terms', 'cookies'];
let fails = 0;
const check = (cond: boolean, what: string) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (!cond) fails++; };
/** Width and height from a PNG's IHDR chunk. */
const pngSize = (f: string) => { const b = readFileSync(f); return b.toString('ascii', 1, 4) === 'PNG' ? [b.readUInt32BE(16), b.readUInt32BE(20)] : [0, 0]; };

interface Icon { src: string; sizes: string; type: string; purpose?: string }
async function main() {
  await build({ logLevel: 'warn' });
  for (const f of ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png', 'site.webmanifest']) check(existsSync(`dist/${f}`), `dist/${f}`);
  const [aw, ah] = pngSize('dist/apple-touch-icon.png');
  check(aw === 180 && ah === 180, `apple-touch-icon is 180×180 (${aw}×${ah})`);
  const m = JSON.parse(readFileSync('dist/site.webmanifest', 'utf8')) as { name: string; short_name: string; display: string; start_url: string; icons: Icon[] };
  check(m.name === 'Synapse' && m.short_name === 'Synapse', `manifest name "${m.name}", short name "${m.short_name}"`);
  check(m.display === 'standalone' && m.start_url === '/', `manifest display ${m.display}, start_url ${m.start_url}`);
  for (const ic of m.icons.filter((i) => i.type === 'image/png')) {
    const [w, h] = pngSize(join('dist', ic.src)), [cw, ch] = ic.sizes.split('x').map(Number);
    check(w === cw && h === ch, `${ic.src} is ${ic.sizes} as declared (${w}×${h}, ${ic.purpose ?? 'any'})`);
  }
  check(m.icons.some((i) => i.sizes === '192x192') && m.icons.some((i) => i.sizes === '512x512' && i.purpose !== 'maskable'), 'manifest has 192 and 512 px icons');
  check(m.icons.some((i) => i.purpose === 'maskable'), 'manifest has a maskable icon');
  for (const p of PAGES) {
    const html = readFileSync(`dist/${p}.html`, 'utf8');
    check(['rel="manifest"', 'href="/favicon.svg"', 'href="/favicon.ico"', 'rel="apple-touch-icon"', 'name="apple-mobile-web-app-title" content="Synapse"'].every((s) => html.includes(s)), `${p}.html links the icons and the manifest`);
  }

  const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
  const server = createServer((req, res) => {
    let path = decodeURIComponent((req.url ?? '/').split('?')[0]); if (path === '/') path = '/index.html';
    const f = join('dist', path);
    if (!existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[extname(f)] ?? 'application/octet-stream' }); res.end(readFileSync(f));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address(); if (!addr || typeof addr === 'string') throw new Error('no address');
  const base = `http://127.0.0.1:${addr.port}`;
  let browser: Browser;
  try { browser = await chromium.launch(); } catch { browser = await chromium.launch({ executablePath: CHROMIUM }); }
  try {
    const page = await browser.newPage();
    await page.goto(`${base}/`);
    // plain browser code as a string: tsx would wrap named helpers in a function the page doesn't have
    const got = await page.evaluate(`(async () => {
      function href(sel) { const l = document.querySelector(sel); return l ? l.href : ''; }
      async function ok(u) { return u ? (await fetch(u)).ok : false; }
      const man = href('link[rel="manifest"]');
      const json = man ? await (await fetch(man)).json() : null;
      const icons = json ? await Promise.all(json.icons.map((i) => ok(new URL(i.src, location.href).href))) : [];
      return { manifest: await ok(man), name: json && json.name, svg: await ok(href('link[rel="icon"][type="image/svg+xml"]')), touch: await ok(href('link[rel="apple-touch-icon"]')), icons };
    })()`) as { manifest: boolean; name: string; svg: boolean; touch: boolean; icons: boolean[] };
    check(got.manifest && got.name === 'Synapse', 'browser: the manifest loads and names Synapse');
    check(got.svg && got.touch && got.icons.every(Boolean), 'browser: favicon, touch icon and every manifest icon load');
  } finally { await browser.close(); server.close(); }
  console.log(fails ? `\n${fails} FAILED` : '\nicons: all ok');
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
