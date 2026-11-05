// Multiplayer check (B8), headless Chromium against a local stand-in for Supabase (scripts/checks/standin.ts, the same
// functions as supabase/schema.sql), the dev server built with its URL and anon key through Vite `define`:
// - B9 flow: Multiplayer opens its screen (one room-code field); the fourth letter checks the room: a code with no room
//   says so and selects the letters; Create a room → the name screen ("Your room is ready…", the code, 0 in): spaces
//   collapsed, the counter, the chip preview → Go in → the lobby, you the host. A guest types the code (lower case) →
//   the name screen (1 player in); the host's name in any case is refused there, and by the server; another name → in.
//   Both lobbies show both chips (fitting their text, apart; yours marked); only the host has Start race.
// - A third player on a landscape phone: the lobby fits; the host taps their chip → "Remove Phone" → they are out, on
//   the code screen saying so (a player's tap on a chip does nothing); the name is free again; Leave room → the title.
// - Each builds and trains in match mode (no popup, the fixed budget, from scratch = Node) and hands the brain in.
// - 98 more players join the first room from Node (CPU brains), so the room is full at 100; a 101st is refused. 100
//   chips: scattered in the field on a desktop; in rows on a short screen (the field scrolls).
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
  const room = (p: Page) => p.evaluate(() => JSON.parse(JSON.stringify(window.__room ?? null)) as { me: { code: string; player: string; host: boolean; name: string } | null; state: { players: { id: string; name: string; ready: boolean; host: boolean }[]; race_no: number; race_seed: number | null } | null; shown: boolean; error: string; handedIn: boolean; screen: string | null; layout: string; fontPx: number });
  const screenIs = (p: Page, sc: string) => p.waitForFunction((x) => window.__room?.screen === x, sc, { timeout: 10_000 });
  // the chips in the field: name, rectangle, whether the text fits, and the field's rectangle (as a string: no bundler helpers in the page)
  const chipsOf = (p: Page) => p.evaluate(`(() => { const f = document.getElementById('lbField'), fr = f.getBoundingClientRect();
    const cs = [...f.querySelectorAll('.chip:not(.leaving)')].map((c) => { const r = c.getBoundingClientRect(); return { name: c.lastChild.textContent, me: c.classList.contains('me'), x: r.left, y: r.top, w: r.width, h: r.height, fits: c.scrollWidth <= c.clientWidth + 1 }; });
    return { chips: cs, field: { x: fr.left, y: fr.top, w: fr.width, h: fr.height, sh: f.scrollHeight, ch: f.clientHeight, sw: f.scrollWidth, cw: f.clientWidth } }; })()`) as Promise<{ chips: { name: string; me: boolean; x: number; y: number; w: number; h: number; fits: boolean }[]; field: { x: number; y: number; w: number; h: number; sh: number; ch: number; sw: number; cw: number } }>;
  const inside = (c: { x: number; y: number; w: number; h: number }, f: { x: number; y: number; w: number; h: number }) => c.x >= f.x - 0.5 && c.y >= f.y - 0.5 && c.x + c.w <= f.x + f.w + 0.5 && c.y + c.h <= f.y + f.h + 0.5;
  const apart = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
  // as a string: the bundler's name helper isn't defined inside the page
  const race = (p: Page) => p.evaluate(`(() => { const r = window.__race; return r ? { state: r.state, kind: r.kind, me: r.me, hash: r.hash, names: r.names, results: r.results, t: r.t, end: r.end, frames: r.frames, go: r.go, goEpoch: performance.timeOrigin + r.goAt, computeMs: r.computeMs, drawn: r.drawn(), dots: r.dots() } : null; })()`) as Promise<{
    state: string; kind: string; me: number; hash: string; names: string[]; results: { name: string; place: number }[]; t: number; end: number; frames: number; go: boolean; goEpoch: number; computeMs: number; drawn: number[][]; dots: number;
  } | null>;

  try {
    // 1. the code screen; a code with no room; create → your name → the lobby; a guest joins with the code; names
    const host = await open(`?seed=7&T=${T}`);
    await host.click('#toMatch');
    await screenIs(host, 'join');
    check(await host.locator('#mpJoinS').isVisible() && await host.locator('#title').isHidden() && /Up to 100 players/.test(await host.locator('#mpJoinS').innerText()) && await host.locator('#mpJoinS button:has-text("Join")').count() === 0,
      'Multiplayer opens its own screen: one room-code field (no Join button), Create a room, up to 100 players');
    await host.locator('#mpCode').pressSequentially('zzzz');
    await host.waitForFunction(() => /^No room/.test(window.__room?.error ?? ''), null, { timeout: 10_000 }).catch(() => undefined);
    const sel = await host.evaluate(() => { const i = document.getElementById('mpCode') as HTMLInputElement; return { v: i.value, a: i.selectionStart, b: i.selectionEnd, ro: i.readOnly }; });
    check((await host.locator('#mpCodeErr').innerText()) === 'No room with that code. Check it with the host.' && sel.v === 'ZZZZ' && sel.a === 0 && sel.b === 4 && !sel.ro && (await room(host)).screen === 'join',
      `the fourth letter checks the room: "${await host.locator('#mpCodeErr').innerText()}", the letters (upper-cased) selected to retype`);
    await host.click('#mpCreate');
    await screenIs(host, 'name');
    const code = await host.locator('#mpNameCode').innerText();
    check(/^[A-Z]{4}$/.test(code) && (await host.locator('#mpNameT').innerText()) === 'Your room is ready. What should we call you?' && (await host.locator('#mpNameN').innerText()) === '0',
      `Create a room: the name screen, its own (room ${code}, 0 players in, "Your room is ready. What should we call you?")`);
    await host.locator('#mpName').pressSequentially('  Host   ');
    const nm = { v: await host.locator('#mpName').inputValue(), n: await host.locator('#mpNameCount').innerText(), pv: await host.locator('#mpPreview').innerText(), go: await host.locator('#mpGo').isEnabled() };
    check(nm.v === 'Host ' && nm.n === '5 / 16' && nm.pv.trim() === 'Host' && nm.go, `spaces collapsed as typed ("${nm.v}", ${nm.n}), "Shows as" the chip "${nm.pv.trim()}", Go in ready`);
    await host.screenshot({ path: `${OUT}/name.png` });
    await host.click('#mpGo');
    await screenIs(host, 'lobby');
    await host.waitForFunction(() => (window.__room?.state?.players.length ?? 0) === 1, null, { timeout: 10_000 });
    const hr = await room(host);
    check(hr.me!.code === code && hr.me!.host && hr.me!.name === 'Host' && (await host.locator('#lbCode').innerText()) === code && await host.locator('#lbStart').isVisible() && hr.state!.players[0].host,
      `Go in: the lobby of room ${code}, you the host (name kept as "${hr.me!.name}")`);
    const guest = await open(`?seed=8&T=${T}`);
    await guest.click('#toMatch');
    await guest.locator('#mpCode').pressSequentially(code.toLowerCase());
    await screenIs(guest, 'name');
    check((await guest.locator('#mpNameCode').innerText()) === code && (await guest.locator('#mpNameT').innerText()) === 'What should we call you?' && (await guest.locator('#mpNameN').innerText()) === '1' && (await guest.locator('#mpNameSub').innerText()) === 'player in',
      'a guest types the code (lower case): straight on to the name screen (1 player in)');
    await guest.locator('#mpName').pressSequentially('HOST');
    check((await guest.locator('#mpNameErr').innerText()) === 'Someone in this room is already called HOST. Try another name.' && !(await guest.locator('#mpGo').isEnabled()), `a name already in the room (any case) is refused: "${await guest.locator('#mpNameErr').innerText()}"`);
    let dup = '';
    try { si.rpc('synapse_join_room', { p_code: code, p_name: ' host ', p_token: 'd'.repeat(32) }); } catch (e) { dup = (e as Error).message; }
    check(dup === 'name taken', `the server refuses it too (${dup}; supabase/schema.sql join_room has the same rule)`);
    await guest.locator('#mpName').fill('');
    await guest.locator('#mpName').pressSequentially('Guest');
    await guest.click('#mpGo');
    await screenIs(guest, 'lobby');
    await host.waitForFunction(() => (window.__room?.state?.players.length ?? 0) === 2, null, { timeout: 10_000 });
    await host.waitForTimeout(500); // the pop-in
    const hc = await chipsOf(host);
    const names = hc.chips.map((c) => c.name).sort().join(', ');
    check(hc.chips.length === 2 && names === 'Guest, Host' && hc.chips.every((c) => c.fits && inside(c, hc.field) && c.w < 200) && apart(hc.chips[0], hc.chips[1]) && hc.chips.find((c) => c.me)?.name === 'Host',
      `both chips pop into the host's field (${names}): each fits its text, apart, inside the field; yours marked`);
    check(await guest.locator('#lbHostSide').isHidden() && (await guest.locator('#lbPlayerSide').innerText()).startsWith("You're in") && !(await host.locator('#lbStart').isEnabled()),
      'only the host has Start race (off until 2 are ready); the guest sees "You\'re in. Waiting for the host to start"');
    await host.screenshot({ path: `${OUT}/lobby.png` });

    // a third player on a landscape phone; the host removes them; the name is free again; Leave room
    const phone = await open('', 844, 390);
    await phone.click('#toMatch'); await phone.locator('#mpCode').pressSequentially(code); await screenIs(phone, 'name');
    await phone.locator('#mpName').pressSequentially('Phone'); await phone.click('#mpGo'); await screenIs(phone, 'lobby');
    await phone.waitForFunction(() => (window.__room?.state?.players.length ?? 0) === 3, null, { timeout: 10_000 });
    const fit = await phone.evaluate(`(() => { const on = (q) => { const r = (typeof q === 'string' ? document.querySelector(q) : q).getBoundingClientRect(); return r.width > 0 && r.top >= 0 && r.left >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5; };
      return { on: ['#mpLobby .mp-bar', '#lbField', '#mpLobby .mp-foot', '#lbBuild', '#lbLeave', '#lbCode'].every(on), field: document.getElementById('lbField').clientHeight, side: document.documentElement.scrollWidth <= innerWidth }; })()`) as { on: boolean; field: number; side: boolean };
    check(fit.on && fit.field >= 180 && fit.side, `844×390: the lobby's header, field (${fit.field} px high) and footer on screen, no sideways scroll`);
    await phone.waitForTimeout(500); // the chips' pop-in
    await phone.screenshot({ path: `${OUT}/lobby-844x390.png` });
    await host.waitForFunction(() => (window.__room?.state?.players.length ?? 0) === 3, null, { timeout: 10_000 });
    await guest.waitForFunction(() => (window.__room?.state?.players.length ?? 0) === 3, null, { timeout: 10_000 });
    await guest.locator('#lbField .chip', { hasText: 'Phone' }).click();
    check(await guest.locator('#lbKick').isHidden(), "a player's tap on another chip offers nothing");
    await host.locator('#lbField .chip', { hasText: 'Phone' }).click();
    check((await host.locator('#lbKick').innerText()) === 'Remove Phone' && await host.locator('#lbKick').isVisible(), 'the host taps a chip: "Remove Phone"');
    await host.screenshot({ path: `${OUT}/remove.png` });
    await host.click('#lbKick');
    await phone.waitForFunction(() => window.__room?.screen === 'join' && window.__room.me === null, null, { timeout: 10_000 }).catch(() => undefined);
    const gone = await phone.locator('#mpCodeErr').innerText();
    await host.waitForFunction(() => (window.__room?.state?.players.length ?? 0) === 2, null, { timeout: 10_000 }).catch(() => undefined);
    check(gone === 'The host removed you from the room.' && (await room(host)).state!.players.length === 2, `removed: Phone is back on the code screen ("${gone}"); the room has 2`);
    await phone.screenshot({ path: `${OUT}/removed-844x390.png` });
    await phone.locator('#mpCode').pressSequentially(code); await screenIs(phone, 'name');
    const kept = await phone.locator('#mpName').inputValue(); // your last name, kept for the tab
    await phone.click('#mpGo');
    await screenIs(phone, 'lobby');
    check(kept === 'Phone' && (await room(phone)).me?.name === 'Phone', `the name is free again: Phone (kept on the name screen: "${kept}") joins once more`);
    await phone.click('#lbLeave');
    await host.waitForFunction(() => (window.__room?.state?.players.length ?? 0) === 2, null, { timeout: 10_000 }).catch(() => undefined);
    check(await phone.locator('#menuCard').isVisible() && await phone.locator('#mp').isHidden() && (await room(host)).state!.players.length === 2, 'Leave room: back to the title, and out of the room');
    await phone.context().close();

    // 2. both train in match mode and hand their brains in
    for (const [p, g] of [[host, hostBrain], [guest, guestBrain]] as const) {
      await p.click('#lbBuild');
      check(await p.evaluate(() => document.body.classList.contains('match')) && await p.locator('.app').isVisible() && await p.locator('#mp').isHidden(), 'Build your brain: the designer in match mode');
      await p.click('#train');
      await p.waitForFunction(() => window.__training?.state === 'done', null, { timeout: 300_000 });
      const sv = parse(await p.evaluate((k) => localStorage.getItem(k), SAVE_KEY)).saved;
      check(genomeHash(sv.genome) === genomeHash(g) && (await p.locator('#tvRace').innerText()) === 'Hand in', 'trained from scratch on the budget = Node; the training view offers Hand in');
      await p.click('#tvRace');
      await p.waitForFunction(() => window.__room?.shown === true && window.__room.handedIn, null, { timeout: 10_000 });
    }
    await host.waitForFunction(() => window.__room?.state?.players.every((x) => x.ready) === true, null, { timeout: 10_000 });
    await host.waitForTimeout(300);
    const filled = await host.evaluate(() => [...document.querySelectorAll('#lbField .chip')].every((c) => c.classList.contains('ready')));
    check(filled && (await host.locator('#lbBuild').innerText()) === 'Brain handed in · Edit' && (await host.locator('#lbStart').innerText()) === 'Start race (2)' && await host.locator('#lbStart').isEnabled(),
      'both brains in: both chips filled, "Brain handed in · Edit", the host\'s Start race (2)');

    // 3. fill the room from Node: 98 more, then the 101st is refused
    for (let k = 0; k < 98; k++) {
      const tok = `bot-token-${String(k).padStart(32, '0')}`;
      const r = si.rpc('synapse_join_room', { p_code: code, p_name: `Bot ${k + 1}`, p_token: tok }) as { player: string };
      // the first bot hands in a brain past the match limit: every client leaves it out of the race the same way
      si.rpc('synapse_submit_brain', { p_player: r.player, p_token: tok, p_brain: k === 0 ? genomeToJSON(zeroGenome(BIG)) : genomeToJSON(cpu[k % cpu.length]) });
    }
    let full = '';
    try { si.rpc('synapse_join_room', { p_code: code, p_name: 'One too many', p_token: 'x'.repeat(32) }); } catch (e) { full = (e as Error).message; }
    check(full === 'room full', `a room holds 100 players; the 101st is refused (${full})`);
    await guest.waitForFunction(() => window.__room?.state?.players.length === 100, null, { timeout: 10_000 });
    check((await guest.locator('#lbCount').innerText()) === '100 / 100', 'the lobby counts 100 / 100');
    await guest.waitForTimeout(600);
    const c100 = await chipsOf(guest), r100 = await room(guest);
    check(c100.chips.length === 100 && r100.layout === 'scatter' && r100.fontPx >= 11 && r100.fontPx <= 17 && c100.chips.every((c) => inside(c, c100.field) && c.fits),
      `100 chips scattered in the field at 1440×900, every one inside it and fitting its text (font ${r100.fontPx.toFixed(1)} px)`);
    await guest.screenshot({ path: `${OUT}/lobby-100.png` });
    await guest.setViewportSize({ width: 844, height: 390 });
    await guest.waitForFunction(() => window.__room?.layout === 'rows', null, { timeout: 5000 }).catch(() => undefined);
    const cr = await chipsOf(guest), rr = await room(guest);
    check(rr.layout === 'rows' && cr.field.sh > cr.field.ch && cr.field.sw <= cr.field.cw + 1 && cr.chips.every((c) => c.fits) && await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `844×390 with 100 in: rows (font ${rr.fontPx.toFixed(1)} px), the field scrolls, no sideways scroll`);
    await guest.screenshot({ path: `${OUT}/lobby-100-844x390.png` });
    await guest.setViewportSize({ width: 1440, height: 900 });

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
    check(await host.locator('#mpLobby').isVisible() && await host.locator('#arena').isHidden(), 'Back to room: the lobby');
    await host.screenshot({ path: `${OUT}/lobby-after.png` });

    // 6. the keys: the page carries the URL and the anon key (from define), never the service role key
    // in dev the defines reach the page through Vite's env module (the production build replaces them in the code)
    const src = await (await host.request.get(`${base}@vite/env`)).text();
    const tree = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? tree(`${d}/${e.name}`) : /\.(ts|css|json)$/.test(e.name) ? [`${d}/${e.name}`] : []));
    const anyService = ['vite.config.ts', ...tree('src')].some((f) => /SERVICE_ROLE/.test(readFileSync(f, 'utf8')));
    check(src.includes(JSON.stringify(si.key)) && src.includes(JSON.stringify(si.url)) && !src.includes(SERVICE) && !anyService,
      `the page gets the URL and anon key through define (${src.includes(JSON.stringify(si.key))}, ${src.includes(JSON.stringify(si.url))}), never the service role key (${!src.includes(SERVICE)}); neither the build config nor src reads it (${!anyService})`);
    // a code with no room is a plain lookup now (room_state answers null), so nothing is refused with an error status
    check(errors.length === 0, `console clean${errors.length ? ': ' + errors.join(' | ') : ''}`);
  } finally {
    await browser.close();
    await server.close();
    await si.close();
  }
  if (fails) { console.error(`multiplayer: ${fails} check(s) failed`); process.exit(1); }
  console.log(`multiplayer: all checks passed; screenshots in ${OUT}/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
