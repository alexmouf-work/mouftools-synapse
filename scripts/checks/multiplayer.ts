// Multiplayer check (B8), headless Chromium against a local stand-in for Supabase (scripts/checks/standin.ts, the same
// functions as supabase/schema.sql), the dev server built with its URL and anon key through Vite `define`:
// - Multiplayer opens the card: a name is needed; a bad code is refused; Create a room gives a 4-letter code and the
//   lobby; a second player joins with the code; both lobbies list both players (the host marked).
// - Each builds and trains in match mode (no popup, the fixed budget, from scratch = Node) and hands the brain in.
// - A room on a landscape phone fits; Leave room. 98 more players join the first room from Node (CPU brains), so the room is full at 100; a 101st is refused.
// - The host starts the race: on both clients the same race (hash = Node runRace of the frozen entries and seed), Go
//   at the same moment (the server's clock), 100 cars on the map, at most MAX_RIVALS others drawn in 3-D and they are
//   the nearest to your car (a brain past the match limit is left out by every client); the results table = Node; each client's result reaches the room; Back to room.
// - The page bundle carries the anon key and the project URL only; the service role key never reaches the browser.
// Reports the race's compute time in the page (100 brains × 120 s). Console clean. Screenshots → out/multiplayer/.
//   npx tsx scripts/checks/multiplayer.ts
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer } from 'vite';
import cpuData from '../../src/assets/cpu/brains.json';
import { CONFIG } from '../../src/common/config';
import { genomeHash, genomeToJSON, zeroGenome } from '../../src/common/sim/brain';
import { energyRefusal } from '../../src/common/sim/energy';
import { cpuBrains } from '../../src/common/sim/cpu';
import { runRace } from '../../src/common/sim/match';
import { defaultSpec, type BrainSpec, type Genome } from '../../src/common/sim/spec';
import { InlineExecutor } from '../../src/common/train/episodes';
import { runPhase } from '../../src/common/train/phase';
import { MAX_RIVALS } from '../../src/client/render/drive';
import { parse, SAVE_KEY } from '../../src/client/ui/designer/store';
import { fixtureBrain } from './fixture';
import { startStandin } from './standin';

const OUT = 'out/multiplayer';
const T = 300_000;
const HZ = CONFIG.tick.hz;
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const SERVICE = 'service-role-sentinel-do-not-ship';
const BIG: BrainSpec = { v: 2, senses: { boundary: 7, landmark: 5, hd: 8, grid: 6, speed: 1 }, layers: Array.from({ length: 4 }, () => ({ n: 8, fn: 'tanh' as const })) };
let fails = 0;
const check = (cond: boolean, what: string) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (!cond) fails++; };

async function main() {
  mkdirSync(OUT, { recursive: true });
  const si = await startStandin();
  process.env.SUPABASE_PROJECT_URL = si.url;
  process.env.SUPABASE_ANON_KEY = si.key;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE;
  const hostBrain = (await runPhase(new InlineExecutor(), defaultSpec(), 7, { T })).final;
  const guestBrain = (await runPhase(new InlineExecutor(), defaultSpec(), 8, { T })).final;
  const cpu = cpuBrains(cpuData).map((b) => b.genome);

  const server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
  await server.listen();
  const addr = server.httpServer?.address();
  if (!addr || typeof addr === 'string') throw new Error('no server address');
  const base = `http://127.0.0.1:${addr.port}/`;
  let browser: Browser;
  try { browser = await chromium.launch({ args: ARGS }); } catch { browser = await chromium.launch({ executablePath: CHROMIUM, args: ARGS }); }
  const errors: string[] = [];
  async function open(query: string, w = 1440, h = 900): Promise<Page> {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    await fixtureBrain(ctx);
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(base);
    await page.evaluate(() => localStorage.setItem('synapse.notice', '2'));
    await page.goto(base + query);
    await page.waitForSelector('#title:not([hidden])');
    return page;
  }
  const room = (p: Page) => p.evaluate(() => JSON.parse(JSON.stringify(window.__room ?? null)) as { me: { code: string; player: string; host: boolean } | null; state: { players: { id: string; name: string; ready: boolean }[]; race_no: number; race_seed: number | null } | null; shown: boolean; error: string; handedIn: boolean });
  // as a string: the bundler's name helper isn't defined inside the page
  const race = (p: Page) => p.evaluate(`(() => { const r = window.__race; return r ? { state: r.state, kind: r.kind, me: r.me, hash: r.hash, names: r.names, results: r.results, t: r.t, end: r.end, frames: r.frames, go: r.go, goEpoch: performance.timeOrigin + r.goAt, computeMs: r.computeMs, drawn: r.drawn(), dots: r.dots() } : null; })()`) as Promise<{
    state: string; kind: string; me: number; hash: string; names: string[]; results: { name: string; place: number }[]; t: number; end: number; frames: number; go: boolean; goEpoch: number; computeMs: number; drawn: number[][]; dots: number;
  } | null>;

  try {
    // 1. the card; a bad code; create; join
    const host = await open(`?seed=7&T=${T}`);
    await host.click('#toMatch');
    check(await host.locator('#mpDlg').evaluate((d) => (d as HTMLDialogElement).open) && /Up to 100 players/.test(await host.locator('#mpDlg').innerText()), 'Multiplayer opens the card: create a room or join one, up to 100 players');
    await host.click('#mpCreate');
    check((await room(host)).error === 'Choose a name first.' && !(await room(host)).me, 'a name is needed first');
    await host.fill('#mpName', 'Host');
    await host.fill('#mpCode', 'ZZZZ');
    await host.click('#mpJoin');
    await host.waitForFunction(() => window.__room?.error === 'no such room', null, { timeout: 10_000 }).catch(() => undefined);
    check((await room(host)).error === 'no such room', `joining a code with no room is refused (${(await room(host)).error})`);
    await host.click('#mpCreate');
    await host.waitForFunction(() => window.__room?.shown === true, null, { timeout: 10_000 });
    const code = (await room(host)).me!.code;
    check(/^[A-Z]{4}$/.test(code) && (await host.locator('#lbCode').innerText()) === code && (await room(host)).me!.host, `Create a room: code ${code}, the lobby, you are the host`);
    const guest = await open(`?seed=8&T=${T}`);
    await guest.click('#toMatch');
    await guest.fill('#mpName', 'Guest');
    await guest.fill('#mpCode', code.toLowerCase());
    await guest.click('#mpJoin');
    await guest.waitForFunction(() => window.__room?.shown === true, null, { timeout: 10_000 });
    await host.waitForFunction(() => (window.__room?.state?.players.length ?? 0) === 2, null, { timeout: 10_000 });
    const list = await host.locator('#lbList').innerText();
    check(/Host \(you\) · host/.test(list) && /Guest/.test(list) && (await guest.locator('#lbStart').isHidden()), `both in the room (host's list: ${list.replace(/\n/g, ' | ')}); only the host can start`);
    await host.screenshot({ path: `${OUT}/lobby.png` });
    // the lobby on a landscape phone: the card on screen, clear of the rail
    const phone = await open('', 844, 390);
    await phone.click('#toMatch'); await phone.fill('#mpName', 'Phone'); await phone.click('#mpCreate');
    await phone.waitForFunction(() => window.__room?.shown === true && (window.__room.state?.players.length ?? 0) === 1, null, { timeout: 10_000 });
    const fit = await phone.evaluate(`(() => { const c = document.getElementById('lobbyCard').getBoundingClientRect(), r = document.querySelector('#title .rail').getBoundingClientRect();
      return c.top >= 0 && c.left >= 0 && c.right <= innerWidth && c.bottom <= r.top + 0.5 && document.documentElement.scrollWidth <= innerWidth; })()`);
    check(fit === true, '844×390: the lobby card on screen and clear of the rail');
    await phone.screenshot({ path: `${OUT}/lobby-844x390.png` });
    await phone.click('#lbLeave');
    check(await phone.locator('#menuCard').isVisible() && await phone.locator('#lobbyCard').isHidden(), 'Leave room: back to the title');
    await phone.context().close();

    // 2. both train in match mode and hand their brains in
    for (const [p, g] of [[host, hostBrain], [guest, guestBrain]] as const) {
      await p.click('#lbBuild');
      check(await p.evaluate(() => document.body.classList.contains('match')) && await p.locator('.app').isVisible(), 'Build and train: the designer in match mode');
      await p.click('#train');
      await p.waitForFunction(() => window.__training?.state === 'done', null, { timeout: 300_000 });
      const sv = parse(await p.evaluate((k) => localStorage.getItem(k), SAVE_KEY)).saved;
      check(genomeHash(sv.genome) === genomeHash(g) && (await p.locator('#tvRace').innerText()) === 'Hand in', 'trained from scratch on the budget = Node; the training view offers Hand in');
      await p.click('#tvRace');
      await p.waitForFunction(() => window.__room?.shown === true && window.__room.handedIn, null, { timeout: 10_000 });
    }
    await host.waitForFunction(() => window.__room?.state?.players.every((x) => x.ready) === true, null, { timeout: 10_000 });
    check(true, 'both brains in; the lobby says so');

    // 3. fill the room from Node: 98 more, then the 101st is refused
    for (let k = 0; k < 98; k++) {
      const tok = `bot-token-${String(k).padStart(32, '0')}`;
      const r = si.rpc('join_room', { p_code: code, p_name: `Bot ${k + 1}`, p_token: tok }) as { player: string };
      // the first bot hands in a brain past the match limit: every client leaves it out of the race the same way
      si.rpc('submit_brain', { p_player: r.player, p_token: tok, p_brain: k === 0 ? genomeToJSON(zeroGenome(BIG)) : genomeToJSON(cpu[k % cpu.length]) });
    }
    let full = '';
    try { si.rpc('join_room', { p_code: code, p_name: 'One too many', p_token: 'x'.repeat(32) }); } catch (e) { full = (e as Error).message; }
    check(full === 'room full', `a room holds 100 players; the 101st is refused (${full})`);
    await guest.waitForFunction(() => window.__room?.state?.players.length === 100, null, { timeout: 10_000 });
    check((await guest.locator('#lbCount').innerText()) === '100 of 100 players', 'the lobby counts 100 of 100 players');

    // 4. the host starts: the same race on both, Go together
    await host.click('#lbStart');
    await Promise.all([host, guest].map((p) => p.waitForFunction(() => (window.__race?.frames ?? 0) > 1, null, { timeout: 60_000 })));
    const rm = si.rooms.get(code)!, entries = JSON.parse(rm.entries!) as { id: string; name: string; brain: string }[];
    const racing = entries.filter((e) => energyRefusal((JSON.parse(e.brain) as Genome).spec, 'match') === null);
    const node = runRace(racing.map((e) => JSON.parse(e.brain) as Genome), rm.raceSeed!);
    const [h, g] = [(await race(host))!, (await race(guest))!];
    check(entries.length === 100 && racing.length === 99 && h.names.length === 99 && h.hash === node.hash && g.hash === node.hash, `100 entries, the one past the limit left out; both clients' race hash ${h.hash} / ${g.hash} = Node ${node.hash}`);
    check(h.me === 0 && g.me === 1 && h.names[1] === 'Guest', `each client drives its own car (host car ${h.me}, guest car ${g.me})`);
    check(Math.abs(h.goEpoch - g.goEpoch) < 150 && Math.abs(h.goEpoch - rm.startAt!) < 150, `Go at the same moment on both (${Math.round(h.goEpoch - g.goEpoch)} ms apart, ${Math.round(h.goEpoch - rm.startAt!)} ms from the server's)`);
    console.log(`     race compute in the page: host ${h.computeMs.toFixed(0)} ms, guest ${g.computeMs.toFixed(0)} ms (100 brains × 120 s)`);
    await host.waitForFunction(() => window.__race?.go === true, null, { timeout: 30_000 });
    await host.evaluate(() => window.__race!.seek(25));
    await host.waitForFunction((f) => (window.__race?.frames ?? 0) > f + 1, (await race(host))!.frames, { timeout: 30_000 });
    const r = (await race(host))!;
    // the nearest others to your car at the time of the frame read, by Node's recordings
    // (a car put back by the wrong-way reset on tick j + 1 jumps there when the tick lands: no glide)
    const posAt = (k: number) => { const c = node.cars[k].rec, kf = r.t * HZ - 1, j = Math.floor(kf), u = c.wrong[j + 1] >= CONFIG.match.wrongWayTicks ? 0 : kf - j; return [c.x[j] + (c.x[j + 1] - c.x[j]) * u, c.y[j] + (c.y[j + 1] - c.y[j]) * u]; };
    const me0 = posAt(0), d2 = node.cars.map((_, k) => { const p = posAt(k); return k === 0 ? Infinity : (p[0] - me0[0]) ** 2 + (p[1] - me0[1]) ** 2; });
    const want = node.cars.map((_, k) => k).sort((a, b) => d2[a] - d2[b] || a - b).slice(0, MAX_RIVALS).sort((a, b) => a - b);
    const got = r.drawn.slice(1).map((p) => p[4]);
    check(r.drawn.length === 1 + MAX_RIVALS && JSON.stringify(got) === JSON.stringify(want) && r.dots === 99, `at ${r.t.toFixed(1)} s: ${MAX_RIVALS} others drawn in 3-D, the nearest to your car (${got.join(' ')}); 99 dots on the map`);
    await host.screenshot({ path: `${OUT}/race-100.png` });

    // 5. results on both, = Node; results reach the room; Back to room
    for (const p of [host, guest]) await p.evaluate(() => window.__race!.seek(1e9));
    await Promise.all([host, guest].map((p) => p.waitForFunction(() => window.__race?.state === 'results', null, { timeout: 30_000 })));
    const rows = await host.$$eval('#rcRows tr td:nth-child(2)', (td) => td.map((d) => d.textContent));
    check(rows.length === 99 && JSON.stringify(rows) === JSON.stringify(node.ranking.map((k) => racing[k].name)), `results: 99 rows in Node's order (${rows.slice(0, 3).join(', ')} …)`);
    await host.screenshot({ path: `${OUT}/results-100.png` });
    // 99 rows: the table scrolls inside the panel; the title and Back stay on screen without scrolling
    const lay = async (p: Page) => p.evaluate(`(() => {
      const on = (id) => { const q = document.getElementById(id).getBoundingClientRect(); return q.width > 0 && q.top >= 0 && q.bottom <= innerHeight && q.left >= 0 && q.right <= innerWidth; };
      const sc = document.getElementById('rcScroll'), dist = [...document.querySelectorAll('#rcRows td:nth-child(4)')].map((d) => d.textContent);
      return { pinned: on('rcResults') && on('rcResT') && on('rcBack'), scrolls: sc.scrollHeight > sc.clientHeight + 50, page: document.documentElement.scrollHeight <= innerHeight, neg: dist.filter((d) => d.startsWith('-')).length };
    })()`) as Promise<{ pinned: boolean; scrolls: boolean; page: boolean; neg: number }>;
    for (const [p, who] of [[host, 'host'], [guest, 'guest']] as const) {
      const l = await lay(p);
      check(l.pinned && l.scrolls && l.page && l.neg === 0, `${who}: 99 results, the table scrolls and the title and Back stay on screen (pinned ${l.pinned}, scrolls ${l.scrolls}); no distance below 0`);
    }
    await host.$eval('#rcScroll', (e) => { e.scrollTop = e.scrollHeight; });
    const end = await lay(host);
    check(end.pinned, 'scrolled to the last row, Back is still on screen');
    await host.screenshot({ path: `${OUT}/results-100-scrolled.png` });
    await host.waitForFunction(() => true);
    await new Promise((res) => setTimeout(res, 1000));
    const res = si.players.filter((p) => p.name === 'Host' || p.name === 'Guest').map((p) => p.result ? JSON.parse(p.result) as { place: number } : null);
    check(res.every((x) => x !== null) && res[0]!.place === node.ranking.indexOf(0) + 1, `each client's result reached the room (host ${res[0]?.place}, guest ${res[1]?.place})`);
    await host.click('#rcBack');
    check(await host.locator('#lobbyCard').isVisible() && await host.locator('#arena').isHidden(), 'Back to room: the lobby');
    await host.screenshot({ path: `${OUT}/lobby-after.png` });

    // 6. the keys: the page carries the URL and the anon key (from define), never the service role key
    // in dev the defines reach the page through Vite's env module (the production build replaces them in the code)
    const src = await (await host.request.get(`${base}@vite/env`)).text();
    const tree = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? tree(`${d}/${e.name}`) : /\.(ts|css|json)$/.test(e.name) ? [`${d}/${e.name}`] : []));
    const anyService = ['vite.config.ts', ...tree('src')].some((f) => /SERVICE_ROLE/.test(readFileSync(f, 'utf8')));
    check(src.includes(JSON.stringify(si.key)) && src.includes(JSON.stringify(si.url)) && !src.includes(SERVICE) && !anyService,
      `the page gets the URL and anon key through define (${src.includes(JSON.stringify(si.key))}, ${src.includes(JSON.stringify(si.url))}), never the service role key (${!src.includes(SERVICE)}); neither the build config nor src reads it (${!anyService})`);
    // the one expected error: the browser logs the refused join of a code with no room (HTTP 400)
    const refused = errors.filter((e) => /status of 400/.test(e)), rest = errors.filter((e) => !/status of 400/.test(e));
    check(refused.length === 1 && rest.length === 0, `console clean but for the refused join${rest.length ? ': ' + rest.join(' | ') : ''} (${refused.length} × 400)`);
  } finally {
    await browser.close();
    await server.close();
    await si.close();
  }
  if (fails) { console.error(`multiplayer: ${fails} check(s) failed`); process.exit(1); }
  console.log(`multiplayer: all checks passed; screenshots in ${OUT}/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
