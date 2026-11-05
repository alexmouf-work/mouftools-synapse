// Multiplayer check (B8), headless Chromium against a local stand-in for Supabase (scripts/checks/standin.ts, the same
// functions as supabase/schema.sql), the dev server built with its URL and anon key through Vite `define`:
// - B9 flow: Multiplayer opens its screen (one room-code field); the fourth letter checks the room: a code with no room
//   says so and selects the letters; Create a room → the name screen ("Your room is ready…", the code, 0 in): spaces
//   collapsed, the counter, the chip preview → Go in → the lobby, you the host. A guest types the code (lower case) →
//   the name screen (1 player in); the host's name in any case is refused there, and by the server; another name → in.
//   Both lobbies show both chips (fitting their text, apart; yours marked); only the host has Start match.
// - A third player on a landscape phone: the lobby fits; the host taps their chip → "Remove Phone" → they are out, on
//   the code screen saying so (a player's tap on a chip does nothing); the name is free again; Leave room → the title.
// - 98 more players join the first room from Node, so the room is full at 100; a 101st is refused. 100 chips:
//   scattered in the field on a desktop; in rows on a short screen (the field scrolls). Two leave again.
// - Timed rounds (match-flow v2 §M2), jumped ahead with __phase.skipTo (the stand-in's clock moved as far): the host's
//   Start match → round 1's build on both from the server's clock (60 s, no Train button); Train starts itself at 0
//   (no buttons); at the train phase's end each hands in its best brain; a brain for a later round, or after the
//   freeze, is refused; the entries freeze as the countdown begins and every page's race = Node runRace of them (the
//   bots' brains from Node: one past round 1's budget left out by every client, one bot with nothing in at 0 m), Go
//   at the server's moment, at most MAX_RIVALS others drawn in 3-D (the nearest), the sidebar's 10 racers; standings
//   for 8 s = Node (signed, every player, best total first), no buttons; each result reaches the room.
// - A latecomer joins in round 2's build (landscape phone): watches from the lobby with the round's countdown, then the
//   race (no car), standings = everyone's (it ran round 1 from the frozen entries); the server refuses its brain for
//   round 2; in from round 3's build. Main menu asks "Leave the room?" (Stay). Rounds 3–5 with all three; the final
//   standings = Node's totals, Play again for the host only, Main menu for all; Play again starts match 2 on every
//   page; Main menu → Leave: the title, out of the room.
// - The page bundle carries the anon key and the project URL only; the service role key never reaches the browser.
// Reports the race's compute time in the page (100 brains × 120 s). Console clean. Screenshots → out/multiplayer/.
//   npx tsx scripts/checks/multiplayer.ts
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer } from 'vite';
import cpuData from '../../src/assets/cpu/brains.json';
import { CONFIG } from '../../src/common/config';
import { derive } from '../../src/common/rng';
import { roundTimes } from '../../src/common/schedule';
import { genomeToJSON, zeroGenome } from '../../src/common/sim/brain';
import { energyRefusal } from '../../src/common/sim/energy';
import { cpuRounds } from '../../src/common/sim/cpu';
import { ROUND_RACE, runRace, type RaceResult } from '../../src/common/sim/match';
import type { BrainSpec, Genome } from '../../src/common/sim/spec';
import { MAX_RIVALS } from '../../src/client/render/drive';
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
  const room = (p: Page) => p.evaluate(() => JSON.parse(JSON.stringify(window.__room ?? null)) as { me: { code: string; player: string; host: boolean; name: string } | null; state: { players: { id: string; name: string; ready: boolean; host: boolean }[]; race_no: number; race_seed: number | null } | null; shown: boolean; error: string; watching: string; screen: string | null; layout: string; fontPx: number });
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
    check(await guest.locator('#lbHostSide').isHidden() && (await guest.locator('#lbPlayerSide').innerText()).startsWith("You're in") && await host.locator('#lbStart').isEnabled(),
      'only the host has Start match (on with 2 in); the guest sees "You\'re in. Waiting for the host to start"');
    await host.screenshot({ path: `${OUT}/lobby.png` });

    // a third player on a landscape phone; the host removes them; the name is free again; Leave room
    const phone = await open('', 844, 390);
    await phone.click('#toMatch'); await phone.locator('#mpCode').pressSequentially(code); await screenIs(phone, 'name');
    await phone.locator('#mpName').pressSequentially('Phone'); await phone.click('#mpGo'); await screenIs(phone, 'lobby');
    await phone.waitForFunction(() => (window.__room?.state?.players.length ?? 0) === 3, null, { timeout: 10_000 });
    const fit = await phone.evaluate(`(() => { const on = (q) => { const r = (typeof q === 'string' ? document.querySelector(q) : q).getBoundingClientRect(); return r.width > 0 && r.top >= 0 && r.left >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5; };
      return { on: ['#mpLobby .mp-bar', '#lbField', '#mpLobby .mp-foot', '#lbLeave', '#lbCode'].every(on), field: document.getElementById('lbField').clientHeight, side: document.documentElement.scrollWidth <= innerWidth }; })()`) as { on: boolean; field: number; side: boolean };
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

    // 2. fill the room from Node: 98 more, then the 101st is refused; two leave again (room for latecomers)
    const bots: { player: string; tok: string; name: string }[] = [];
    for (let k = 0; k < 98; k++) {
      const tok = `bot-token-${String(k).padStart(32, '0')}`;
      const r = si.rpc('synapse_join_room', { p_code: code, p_name: `Bot ${k + 1}`, p_token: tok }) as { player: string };
      bots.push({ player: r.player, tok, name: `Bot ${k + 1}` });
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
    // the guest plays on a landscape phone from here (three pages drawing races with SwiftShader is slow)
    for (const b of bots.splice(96, 2)) si.rpc('synapse_leave_room', { p_player: b.player, p_token: b.tok });
    await host.waitForFunction(() => window.__room?.state?.players.length === 98, null, { timeout: 10_000 });

    // a latecomer's page waits on the name screen (it goes in during round 2's build); its 3-D stage is made first,
    // by a vs CPU round's race, left from Main menu (SwiftShader takes many seconds to make one, while the server's
    // clock runs on)
    const lateP = await open(`?T=${T}`, 844, 390);
    await lateP.click('#toCpu');
    await lateP.waitForFunction(() => window.__match?.phase === 'build' && window.__phase?.state === 'running', null, { timeout: 15_000 });
    await lateP.evaluate(() => window.__phase!.skipTo(0.2));
    await lateP.waitForFunction(() => window.__training?.state === 'done' && window.__phase?.state === 'running', null, { timeout: 60_000 });
    await lateP.evaluate(() => window.__phase!.skipTo(0.2));
    await lateP.waitForFunction(() => (window.__race?.frames ?? 0) > 1, null, { timeout: 60_000 });
    await lateP.click('#rcMenu'); await lateP.waitForSelector('#leaveDlg[open]'); await lateP.click('#lvGo');
    await lateP.waitForSelector('#title:not([hidden])');
    await lateP.click('#toMatch'); await lateP.locator('#mpCode').pressSequentially(code); await screenIs(lateP, 'name');
    await lateP.locator('#mpName').pressSequentially('Late');

    // 3. the host's Start match: round 1's build on both, from the server's clock (no buttons that train or skip)
    check((await host.locator('#lbStart').innerText()) === 'Start match' && await host.locator('#lbStart').isEnabled() && await host.locator('#lbBuild').count() === 0,
      'the host\'s Start match (no Build your brain: the match builds, trains and races for everyone)');
    await host.click('#lbStart');
    const pages = [host, guest];
    await Promise.all(pages.map((p) => p.waitForFunction(() => window.__roomMatch?.step === 'build' && window.__phase?.state === 'running', null, { timeout: 15_000 })));
    const rm = si.rooms.get(code)!, matchSeed = rm.matchSeed!, matchAt = rm.matchAt!;
    const ph = async (p: Page) => p.evaluate(() => ({ label: window.__phase!.label, left: window.__phase!.left, ms: window.__phase!.ms, state: window.__phase!.state }));
    const b1 = await Promise.all(pages.map(ph));
    const look = async (p: Page) => p.evaluate(`(() => ({ rounds: document.body.classList.contains('rounds'), match: document.body.classList.contains('match'), train: getComputedStyle(document.getElementById('train')).display === 'none', app: !document.querySelector('.app').hidden, mp: document.getElementById('mp').hidden }))()`) as Promise<{ rounds: boolean; match: boolean; train: boolean; app: boolean; mp: boolean }>;
    const lk = await Promise.all(pages.map(look));
    check(b1.every((b) => b.label === 'Round 1 of 5 · Build' && b.left >= 55 && b.left <= 60) && Math.abs(b1[0].ms - b1[1].ms) < 1700 && lk.every((l) => l.rounds && l.match && l.train && l.app && l.mp),
      `Start match: round 1's build on both (${b1.map((b) => `"${b.label}" ${b.left} s`).join(', ')}), the designer in match mode with no Train button`);
    await host.screenshot({ path: `${OUT}/m-build.png` });
    // bots hand in round 1 from Node: Bot 1 a brain past round 1's budget (left out by every client), Bot 2 nothing
    const cpu1 = cpuRounds(cpuData)[0].map((b) => b.genome);
    for (const [k, b] of bots.entries()) {
      if (k === 1) continue;
      si.rpc('synapse_submit_round_brain', { p_player: b.player, p_token: b.tok, p_match_no: 1, p_round: 1, p_brain: genomeToJSON(k === 0 ? zeroGenome(BIG) : cpu1[k % cpu1.length]) });
    }
    let early = '';
    try { si.rpc('synapse_submit_round_brain', { p_player: bots[2].player, p_token: bots[2].tok, p_match_no: 1, p_round: 2, p_brain: '{}' }); } catch (e) { early = (e as Error).message; }
    check(early === 'too early', `a brain for a round not yet begun is refused (${early})`);

    /**
     * Jump the phase timers of these pages to s seconds left, and the stand-in's clock as far (the phases follow it;
     * a larger s holds a phase, moving the clock back). The pages first: a reply in between only re-syncs them.
     */
    const skip = async (ps: Page[], s: number, only?: string) => {
      const left = await ps[0].evaluate((l) => (window.__phase!.state === 'running' && (!l || window.__phase!.label === l) ? window.__phase!.ms : null), only ?? '');
      if (left === null) return;
      await Promise.all(ps.map((p) => p.evaluate((x) => window.__phase!.skipTo(x), s)));
      si.skew += left - s * 1000;
    };
    const step = (ps: Page[], st: string, timeout = 30_000) => Promise.all(ps.map((p) => p.waitForFunction((x) => window.__roomMatch?.step === x, st, { timeout })));
    const label = (ps: Page[], l: string, timeout = 30_000) => Promise.all(ps.map((p) => p.waitForFunction((x) => window.__phase?.label === x && window.__phase.state === 'running', l, { timeout })
      .catch(async (e) => { console.log('     waiting for', l, 'on', await p.evaluate(() => JSON.stringify({ phase: window.__phase, step: window.__roomMatch?.step, round: window.__roomMatch?.round, name: window.__room?.me?.name, t: window.__roomMatch?.t, race: window.__race && { t: window.__race.t, state: window.__race.state, go: window.__race.go } })), 'server', Date.now() + si.skew - matchAt); throw e; })));
    const node: RaceResult[] = [];
    /** Round n's race, as Node computes it from the stand-in's frozen entries. */
    const nodeRound = (n: number) => {
      const entries = JSON.parse(si.rooms.get(code)!.frozen.get(n)!) as { id: string; name: string; brain: string }[];
      const ok = entries.filter((e) => energyRefusal((JSON.parse(e.brain) as Genome).spec, CONFIG.rounds.budgets[n - 1]) === null);
      node[n - 1] = runRace(ok.map((e) => JSON.parse(e.brain) as Genome), derive(matchSeed >>> 0, 0x50d5, n), undefined, ROUND_RACE);
      return { entries, ok, race: node[n - 1] };
    };
    /** Build → train (no buttons) → hand in → the race (= Node on every page) → standings; returns Node's round. */
    const playRound = async (n: number, players: Page[], watchers: Page[], o: { shots?: boolean } = {}) => {
      const all = [...players, ...watchers];
      await label(players, `Round ${n} of 5 · Build`);
      await skip(all, 0.3);
      await label(players, `Round ${n} of 5 · Train`);
      await Promise.all(players.map((p) => p.waitForFunction(() => window.__training?.state === 'running' || window.__training?.state === 'done', null, { timeout: 30_000 })));
      const btn = await Promise.all(players.map((p) => p.evaluate(() => ['tvStop', 'tvBack', 'tvAgain', 'tvDrive', 'tvRace'].filter((id) => !(document.getElementById(id) as HTMLElement).hidden))));
      check(btn.every((b) => b.length === 0), `round ${n}: Train starts itself at the build's 0, "Round ${n} of 5 · Train", no buttons in the training view (${btn.map((b) => b.join('+') || 'none').join(', ')})`);
      if (o.shots) await players[0].screenshot({ path: `${OUT}/m-train.png` });
      await Promise.all(players.map((p) => p.waitForFunction(() => window.__training?.state === 'done', null, { timeout: 60_000 })));
      await skip(all, 0.3);
      await Promise.all(players.map((p) => p.waitForFunction(() => window.__roomMatch?.handed === true, null, { timeout: 15_000 })));
      // handed in before the freeze: the stand-in holds each player's trained brain for this round
      const held = si.rooms.get(code)!.brains.get(n)!;
      const mine = await Promise.all(players.map((p) => p.evaluate(() => ({ me: window.__room!.me!.player, trained: window.__roomMatch!.trained }))));
      check(mine.every((x) => held.get(x.me) === genomeToJSON(x.trained!)), `round ${n}: at the train phase's end each player's best brain so far is handed in (${mine.length} in the room's round ${n})`);
      await Promise.all(all.map((p) => p.waitForFunction(() => window.__roomMatch?.step === 'race', null, { timeout: 30_000 })));
      const nr = nodeRound(n);
      // this round's race on screen (the last round's may still be there a moment): its hash, drawing
      await Promise.all(all.map((p) => p.waitForFunction((hsh) => window.__race?.hash === hsh && (window.__race?.frames ?? 0) > 1, nr.race.hash, { timeout: 30_000, polling: 100 }).catch(() => undefined)));
      const rs = await Promise.all(all.map((p) => race(p)));
      check(rs.every((r) => r!.hash === nr.race.hash), `round ${n}: the entries froze as the countdown began; every page's race hash = Node runRace of them (${nr.ok.length} racing of ${nr.entries.length} in): ${nr.race.hash}`);
      const goServer = matchAt + roundTimes(n).go;
      check(rs.every((r) => Math.abs(r!.goEpoch - (goServer - si.skew)) < 250) && Math.max(...rs.map((r) => r!.goEpoch)) - Math.min(...rs.map((r) => r!.goEpoch)) < 200,
        `round ${n}: Go at the server's moment on every page (${rs.map((r) => Math.round(r!.goEpoch - (goServer - si.skew))).join(', ')} ms off)`);
      let late = '';
      try { si.rpc('synapse_submit_round_brain', { p_player: bots[3].player, p_token: bots[3].tok, p_match_no: 1, p_round: n, p_brain: genomeToJSON(cpu1[0]) }); } catch (e) { late = (e as Error).message; }
      check(late === 'too late', `round ${n}: a brain after the freeze is refused (${late})`);
      return nr;
    };
    /** The race to its end on these pages (its timer skipped, the playback sought), then the standings. */
    const toStandings = async (n: number, all: Page[]) => {
      await label(all, `Round ${n} of 5 · Race`);
      await skip(all, 0.3);
      for (const p of all) await p.evaluate(() => window.__race!.seek(1e9));
      await step(all, n < 5 ? 'standings' : 'over');
      await Promise.all(all.map((p) => p.waitForFunction((k) => (window.__roomMatch?.standings[k - 1]?.length ?? 0) > 0, n, { timeout: 15_000 })));
      if (n === 5) return 0;
      await label(all, `Round ${n + 1} of 5 in`);
      const ms = await all[0].evaluate(() => window.__phase!.ms), want = matchAt + roundTimes(n).next - (Date.now() + si.skew);
      await skip(all, 60); // held while the check reads them
      return ms - want;
    };
    /** Standings after round n as Node has them: every player in it (0 m with nothing in), best total, round, name. */
    const nodeStandings = (n: number, ids: Map<string, string>) => {
      const dist = (k: number, id: string) => { const e = JSON.parse(si.rooms.get(code)!.frozen.get(k)!) as { id: string; brain: string }[]; const ok = e.filter((x) => energyRefusal((JSON.parse(x.brain) as Genome).spec, CONFIG.rounds.budgets[k - 1]) === null); const i = ok.findIndex((x) => x.id === id); return i < 0 ? 0 : node[k - 1].cars[i].dist; };
      return [...ids].map(([id, name]) => { let total = 0; for (let k = 1; k <= n; k++) total += dist(k, id); return { name, d: dist(n, id), total }; })
        .sort((a, b) => b.total - a.total || b.d - a.d || (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));
    };
    const km = (m: number) => { const v = (Math.abs(m) / 1000).toFixed(2); return `${m < 0 && v !== '0.00' ? '−' : ''}${v} km`; };
    const tableOf = (p: Page) => p.$$eval('#rcRows tr', (tr) => tr.map((r) => [...r.querySelectorAll('td')].map((d) => d.textContent ?? '')));

    // round 1: 98 in the room, 97 brains in (Bot 2 none), Bot 1's past the budget: 96 race
    const n1 = await playRound(1, pages, [], { shots: true });
    const [h, g] = [(await race(host))!, (await race(guest))!];
    check(n1.entries.length === 97 && n1.ok.length === 96 && h.names.length === 96 && h.me === 0 && g.me === 1 && h.names[1] === 'Guest',
      `round 1: 97 entries (Bot 2 handed nothing in), Bot 1's brain past round 1's budget left out by every client; each drives its own car (host ${h.me}, guest ${g.me})`);
    const cms = await Promise.all(pages.map((p) => p.evaluate(() => window.__roomMatch!.computeMs[0])));
    console.log(`     race compute in the page: host ${cms[0].toFixed(0)} ms, guest ${cms[1].toFixed(0)} ms (96 brains × 30 s)`);
    await host.waitForFunction(() => window.__race?.go === true, null, { timeout: 30_000 });
    await host.evaluate(() => { window.__race!.hold = true; window.__race!.seek(25); });
    await host.waitForFunction((f) => (window.__race?.frames ?? 0) > f + 1, (await race(host))!.frames, { timeout: 30_000 });
    const r = (await race(host))!;
    // the nearest others to your car at the time of the frame read, by Node's recordings
    // (a car put back by the wrong-way reset on tick j + 1 jumps there when the tick lands: no glide)
    const posAt = (k: number) => { const c = n1.race.cars[k].rec, kf = r.t * HZ - 1, j = Math.floor(kf), u = c.wrong[j + 1] >= CONFIG.match.wrongWayTicks ? 0 : kf - j; return [c.x[j] + (c.x[j + 1] - c.x[j]) * u, c.y[j] + (c.y[j + 1] - c.y[j]) * u]; };
    const me0 = posAt(0), d2 = n1.race.cars.map((_, k) => { const p = posAt(k); return k === 0 ? Infinity : (p[0] - me0[0]) ** 2 + (p[1] - me0[1]) ** 2; });
    const want = n1.race.cars.map((_, k) => k).sort((a, b) => d2[a] - d2[b] || a - b).slice(0, MAX_RIVALS).sort((a, b) => a - b);
    const got = r.drawn.slice(1).map((p) => p[4]);
    const shown = await host.evaluate(() => window.__race!.shown());
    check(shown.filter((x) => x !== '⋯').length === 10 && shown.length <= 11 && shown.includes('Host'), `the sidebar lists 10 racers of 96: places 1–3 and those nearest you (${shown.join(', ')})`);
    check(r.drawn.length === 1 + MAX_RIVALS && JSON.stringify(got) === JSON.stringify(want) && r.dots === 96, `at ${r.t.toFixed(1)} s: ${MAX_RIVALS} others drawn in 3-D, the nearest to your car (${got.join(' ')}); 96 dots on the map`);
    await host.screenshot({ path: `${OUT}/race-100.png` });
    await host.evaluate(() => { window.__race!.hold = false; });
    const st8 = await toStandings(1, pages);
    check(Math.abs(st8) < 400 && roundTimes(1).next - roundTimes(1).standings === 8000, `round 1's race ends: 8 s of standings, counting down to round 2's build on the server's clock (${st8.toFixed(0)} ms off)`);
    const ids1 = new Map<string, string>(si.players.filter((p) => p.room === code).map((p) => [p.id, p.name]));
    const s1 = nodeStandings(1, ids1);
    const t1 = await tableOf(host);
    const st1 = await Promise.all(pages.map((p) => p.evaluate(() => window.__roomMatch!.standings[0])));
    check(t1.length === 98 && JSON.stringify(t1.map((x) => x[1])) === JSON.stringify(s1.map((x) => x.name)) && JSON.stringify(t1.map((x) => x[2])) === JSON.stringify(s1.map((x) => km(x.d))) && JSON.stringify(st1[0]) === JSON.stringify(st1[1]),
      `round 1's standings on both = Node: all 98 players, signed distances, best total first (${s1.slice(0, 3).map((x) => x.name).join(', ')} …); Bot 1 and Bot 2 at ${t1.find((x) => x[1] === 'Bot 2')?.[2]}`);
    const stl = await Promise.all(pages.map(ph));
    check(stl.every((x) => x.label === 'Round 2 of 5 in') && await host.locator('#rcAgain').isHidden() && await host.locator('#rcBack').isHidden(), `the standings count down to round 2, no buttons ("${stl[0].label}")`);
    await new Promise((res) => setTimeout(res, 800));
    const res1 = si.players.filter((p) => p.name === 'Host' || p.name === 'Guest').map((p) => p.result ? JSON.parse(p.result) as { round: number; place: number } : null);
    check(res1.every((x) => x !== null && x.round === 1) && res1[0]!.place === s1.findIndex((x) => x.name === 'Host') + 1, `each player's round result reaches the room (host ${res1[0]?.place}, guest ${res1[1]?.place})`);
    await skip(pages, 8, 'Round 2 of 5 in');
    await host.screenshot({ path: `${OUT}/m-standings.png` });
    // round 2: a latecomer joins during the build and watches (the lobby, then the race) until round 3's build
    await skip(pages, 0.3, 'Round 2 of 5 in');
    await label(pages, 'Round 2 of 5 · Build');
    await lateP.click('#mpGo');
    await lateP.waitForFunction(() => window.__roomMatch?.step === 'wait' && window.__phase?.state === 'running', null, { timeout: 15_000 });
    const lw = await lateP.evaluate(() => ({ w: window.__room!.watching, first: window.__roomMatch!.first, label: window.__phase!.label, lobby: !(document.getElementById('mpLobby') as HTMLElement).hidden }));
    check(lw.lobby && lw.first === 3 && lw.label === 'Round 2 of 5 · Build' && /You join at round 3's build/.test(lw.w), `a player who joins mid-match watches: the lobby says "${lw.w}", round 2's countdown in its bar ("${lw.label}"; first round ${lw.first}; lobby ${lw.lobby})`);
    await lateP.screenshot({ path: `${OUT}/m-late-watch-844x390.png` });
    // the server agrees: a player who joined after round 2's build began has no brain in it
    const lb = si.rpc('synapse_join_room', { p_code: code, p_name: 'Late bot', p_token: 'l'.repeat(32) }) as { player: string };
    let notIn = '';
    try { si.rpc('synapse_submit_round_brain', { p_player: lb.player, p_token: 'l'.repeat(32), p_match_no: 1, p_round: 2, p_brain: genomeToJSON(cpu1[0]) }); } catch (e) { notIn = (e as Error).message; }
    check(notIn === 'not in this round', `the server refuses a latecomer's brain for the round under way (${notIn})`);
    si.rpc('synapse_leave_room', { p_player: lb.player, p_token: 'l'.repeat(32) });
    const n2 = await playRound(2, pages, [lateP]);
    const lr = (await race(lateP))!;
    check(n2.entries.length === 2 && lr.me === -1 && lr.kind === 'room', `round 2: only the two who handed in race (the bots sit out with 0 m); the latecomer watches (car ${lr.me})`);
    await toStandings(2, [...pages, lateP]);
    const st2 = await Promise.all([host, lateP].map((p) => p.evaluate(() => ({ s: window.__roomMatch!.standings[1], d: window.__roomMatch!.dists }))));
    const s2 = nodeStandings(2, ids1);
    check(JSON.stringify(st2[0].s) === JSON.stringify(s2.map((x) => x.name)) && JSON.stringify(st2[1].s) === JSON.stringify(st2[0].s) && JSON.stringify(st2[1].d[0]) === JSON.stringify(st2[0].d[0]) && !st2[1].s.includes('Late'),
      'round 2\'s standings = Node on every page; the latecomer ran round 1 from its frozen entries too, and isn\'t listed before playing');
    await lateP.screenshot({ path: `${OUT}/m-late-standings-844x390.png` });
    await skip([...pages, lateP], 0.3);
    const all3 = [...pages, lateP];
    await label(all3, 'Round 3 of 5 · Build');
    const ll = await look(lateP);
    check(ll.rounds && ll.match && ll.app && ll.mp, 'round 3: the latecomer is in, building in the designer like everyone');
    // Main menu asks first, in a room
    await guest.click('#toTitle');
    await guest.waitForSelector('#leaveDlg[open]');
    const q = await guest.locator('#lvQ').innerText();
    await guest.click('#lvStay');
    check(q === 'Leave the room?' && (await guest.evaluate(() => window.__roomMatch!.step)) === 'build', `Main menu asks "${q}" first; Stay keeps you in the match`);

    // rounds 3–5, all three in; then the final standings
    for (const n of [3, 4, 5]) {
      await playRound(n, all3, []);
      await toStandings(n, all3);
      if (n < 5) await skip(all3, 0.3);
    }
    const fin = await Promise.all(all3.map((p) => p.evaluate(() => ({ s: window.__roomMatch!.standings[4], step: window.__roomMatch!.step, t: document.getElementById('rcResT')!.textContent, again: !(document.getElementById('rcAgain') as HTMLElement).hidden, back: !(document.getElementById('rcBack') as HTMLElement).hidden, backT: document.getElementById('rcBack')!.textContent, timer: window.__phase!.state }))));
    const ids5 = new Map(ids1); ids5.set(si.players.find((p) => p.name === 'Late')!.id, 'Late');
    const s5 = nodeStandings(5, ids5), t5 = await tableOf(host);
    check(fin.every((f) => f.step === 'over' && f.back && f.backT === 'Main menu' && f.timer === 'off' && JSON.stringify(f.s) === JSON.stringify(s5.map((x) => x.name))) && fin[0].again && !fin[1].again && !fin[2].again
      && JSON.stringify(t5.map((x) => x[3])) === JSON.stringify(s5.map((x) => km(x.total))),
      `after round 5: the final standings = Node's totals on every page ("${fin[0].t}"; "${fin[1].t}"), Play again for the host only, Main menu for all`);
    await host.screenshot({ path: `${OUT}/m-final.png` });
    await guest.screenshot({ path: `${OUT}/m-final-guest.png` });

    // Play again: the next match for everyone in the room, the latecomer included from its first build
    await host.click('#rcAgain');
    await Promise.all(all3.map((p) => p.waitForFunction(() => window.__roomMatch?.matchNo === 2 && window.__roomMatch.step === 'build' && window.__phase?.label === 'Round 1 of 5 · Build', null, { timeout: 15_000 })));
    check(si.rooms.get(code)!.matchNo === 2, 'Play again (host): match 2 begins on every page, round 1\'s build');
    // Main menu → Leave the room? → Leave: the title, out of the room
    await guest.click('#toTitle');
    await guest.waitForSelector('#leaveDlg[open]');
    await guest.click('#lvGo');
    await host.waitForFunction(() => !window.__room?.state?.players.some((p) => p.name === 'Guest'), null, { timeout: 10_000 }).catch(() => undefined);
    check(await guest.locator('#menuCard').isVisible() && (await guest.evaluate(() => window.__roomMatch!.on)) === false && !si.players.some((p) => p.name === 'Guest'), 'Leave: back to the title, out of the room and the match');
    await lateP.context().close();

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
