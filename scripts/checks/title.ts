// Title screen check (B2c), headless Chromium: the page opens on the title; Multiplayer (blue) and vs CPU (yellow)
// are disabled with "soon", Sandbox (plain) opens the designer and the designer's wordmark comes back; the rail along
// the foot carries Privacy · Terms · Cookies (resolving) and the music credits, and the designer's rule strip no longer
// does; the storage notice sits below the rail, never over it; an overlap audit of the card, its buttons and the rail
// at 1440×900 and 844×390, light and dark; console clean. Screenshots → out/title/.
//   npx tsx scripts/checks/title.ts
import { mkdirSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer } from 'vite';

const OUT = 'out/title';
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
let fails = 0;
const check = (cond: boolean, what: string) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (!cond) fails++; };

async function main() {
  mkdirSync(OUT, { recursive: true });
  const server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
  await server.listen();
  const addr = server.httpServer?.address();
  if (!addr || typeof addr === 'string') throw new Error('no server address');
  const base = `http://127.0.0.1:${addr.port}/`;
  let browser: Browser;
  try { browser = await chromium.launch({ args: ARGS }); } catch { browser = await chromium.launch({ executablePath: CHROMIUM, args: ARGS }); }
  const errors: string[] = [];
  async function open(w: number, h: number, dark: boolean, notice = false): Promise<Page> {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: dark ? 'dark' : 'light', isMobile: w < 900, hasTouch: w < 900 });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(base);
    if (!notice) { await page.evaluate(() => localStorage.setItem('synapse.notice', '2')); await page.goto(base); }
    await page.waitForSelector('#title:not([hidden])');
    await page.waitForTimeout(300);
    return page;
  }
  const box = (page: Page, sel: string) => page.locator(sel).first().boundingBox();
  const over = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
    a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;

  try {
    // 1. the page opens on the title; the buttons
    let page = await open(1440, 900, false);
    check(await page.locator('#title').isVisible() && !(await page.locator('.app').isVisible()) && !(await page.locator('#arena').isVisible()), 'the page opens on the title screen (not the designer)');
    check((await page.locator('#title h1').innerText()) === 'Synapse' && (await page.locator('#title .tag').innerText()) === 'Build a brain. Train it. Race it.', 'the card: "Synapse", "Build a brain. Train it. Race it."');
    const st = await page.evaluate(() => ['toMatch', 'toCpu', 'toSandbox'].map((id) => {
      const b = document.getElementById(id) as HTMLButtonElement, cs = getComputedStyle(b);
      return { text: b.textContent?.replace(/\s+/g, ' ').trim(), disabled: b.disabled, bg: cs.backgroundColor, accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() };
    }));
    check(st[0].text === 'Multiplayer soon' && st[0].disabled && st[0].bg === 'rgb(47, 111, 222)', `Multiplayer: blue, disabled, "soon" (${st[0].bg})`);
    check(st[1].text === 'vs CPU soon' && st[1].disabled && st[1].bg === 'rgb(255, 194, 26)', `vs CPU: yellow, disabled, "soon" (${st[1].bg})`);
    check(st[2].text === 'Sandbox' && !st[2].disabled && st[2].bg === 'rgba(0, 0, 0, 0)', 'Sandbox: plain, enabled');
    await page.screenshot({ path: `${OUT}/title-1440.png` });

    // 2. the rail: legal links (resolving) and the credits; the designer's rule strip no longer carries them
    const rail = await page.evaluate(() => ({ links: [...document.querySelectorAll('#title .rail .legal-links a')].map((a) => a.getAttribute('href')), text: (document.querySelector('#title .rail') as HTMLElement).innerText }));
    check(JSON.stringify(rail.links) === JSON.stringify(['/privacy', '/terms', '/cookies']) && /Music: DM DOKURO · “Airport Lounge” Kevin MacLeod \(CC BY 4\.0\)/.test(rail.text), `rail: ${rail.links.join(' ')} · ${rail.text.split('\n').pop()}`);
    for (const p of ['privacy', 'terms', 'cookies']) {
      const r = await page.request.get(`${base}${p}.html`);
      check(r.status() === 200 && (await r.text()).includes('<h1'), `/${p} resolves (dev: ${p}.html; the slugs are checked on the production build by check:legal)`);
    }
    check(await page.locator('.rulebar .legal-links').count() === 0, 'the Learning Rule strip has no legal line any more');

    // 3. Sandbox → the designer → the wordmark → the title
    await page.click('#toSandbox');
    check(await page.locator('.app').isVisible() && !(await page.locator('#title').isVisible()) && await page.locator('#net g.cell').count() > 0, 'Sandbox opens the designer');
    await page.click('#toTitle');
    check(await page.locator('#title').isVisible() && !(await page.locator('.app').isVisible()), 'the designer\'s "Synapse" wordmark goes back to the title');
    await page.context().close();

    // 4. overlap audit: card, buttons, rail and the two sound toggles inside the screen and apart; light and dark;
    //    desktop and landscape phone
    for (const [w, h, dark] of [[1440, 900, false], [1440, 900, true], [844, 390, false], [844, 390, true]] as const) {
      page = await open(w, h, dark);
      const card = (await box(page, '#title .card'))!, r = (await box(page, '#title .rail'))!;
      const btns = await Promise.all(['#toMatch', '#toCpu', '#toSandbox'].map((s) => box(page, s)));
      const inside = (b: { x: number; y: number; width: number; height: number }) => b.x >= -0.5 && b.y >= -0.5 && b.x + b.width <= w + 0.5 && b.y + b.height <= h + 0.5;
      const ok = inside(card) && inside(r) && !over(card, r) && btns.every((b) => b && b.x >= card.x - 0.5 && b.x + b.width <= card.x + card.width + 0.5 && b.y + b.height <= card.y + card.height + 0.5)
        && !over(btns[0]!, btns[1]!) && !over(btns[1]!, btns[2]!) && Math.abs(r.y + r.height - h) < 1;
      const mu = (await box(page, '#musicTi'))!, fx = (await box(page, '#sfxTi'))!;
      const togglesOk = inside(mu) && inside(fx) && !over(mu, fx) && !over(mu, card) && !over(fx, card) && !over(mu, r) && !over(fx, r)
        && Math.abs(mu.y - fx.y) < 1 && mu.x < fx.x && Math.abs(mu.width - mu.height) < 0.5;
      check(togglesOk, `${w}×${h}${dark ? ' dark' : ''}: Music and Sound effects toggles side by side, square, on screen, clear of the card and rail`);
      const sw = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
      check(ok && sw, `${w}×${h}${dark ? ' dark' : ''}: card, buttons and rail on screen and apart, the rail along the foot, no sideways scroll`);
      await page.screenshot({ path: `${OUT}/title-${w}${dark ? '-dark' : ''}.png` });
      await page.context().close();
    }

    // 5. the storage notice sits below the rail (it reserves its room), never over it
    page = await open(844, 390, false, true);
    await page.waitForSelector('#notice');
    await page.waitForTimeout(300);
    const nb = (await box(page, '#notice'))!, rb = (await box(page, '#title .rail'))!, cb = (await box(page, '#title .card'))!;
    check(rb.y + rb.height <= nb.y + 0.5 && !over(cb, nb) && !over(cb, rb), `with the notice showing: the rail sits on top of it (rail bottom ${Math.round(rb.y + rb.height)} ≤ notice top ${Math.round(nb.y)}), the card clear of both`);
    await page.screenshot({ path: `${OUT}/title-844-notice.png` });
    await page.context().close();

    check(errors.length === 0, `console clean${errors.length ? ': ' + errors.join(' | ') : ''}`);
  } finally {
    await browser.close();
    await server.close();
  }
  if (fails) { console.error(`title: ${fails} check(s) failed`); process.exit(1); }
  console.log(`title: all checks passed; screenshots in ${OUT}/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
