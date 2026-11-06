// Multiplayer check (B8), headless Chromium against a local stand-in for Supabase (scripts/checks/standin.ts, the same
// functions as supabase/schema.sql), the dev server built with its URL and anon key through Vite `define`:
// - B9 flow: Multiplayer opens its screen (one room-code field); the fourth letter checks the room: a code with no room
//   says so and selects the letters; Create a room → the name screen ("Your room is ready…", the code, 0 in): spaces
//   collapsed, the counter, the chip preview → Go in → the lobby, you the host. A guest types the code (lower case) →
//   the name screen (1 player in); the host's name in any case is refused there, and by the server; another name → in.
//   Both lobbies show both chips (fitting their text, apart; yours marked); only the host has Start match.
// - The host (tracks-v2 T2): a "Host" tag on the host's chip, "Host: <name>" in both headers; the Settings panel, the
//   host's to change and read-only for the guest; max players set to 2 → a third is refused on the code screen ("That
//   room is full (2 players).") and by the server; never below the number in (the server refuses it); back to 100.
// - A third player on a landscape phone: the lobby fits; the host taps their chip → "Remove Phone" → they are out, on
//   the code screen saying so (a player's tap on a chip does nothing); the name is free again; Leave room → the title.
// - 98 more players join the first room from Node, so the room is full at 100; a 101st is refused. 100 chips:
//   scattered in the field on a desktop; in rows on a short screen (the field scrolls). Two leave again.
// - Timed rounds (match-flow v2 §M2), jumped ahead with __phase.skipTo (the stand-in's clock moved as far): the host's
//   Start match → round 1's build on both from the server's clock (60 s, no Train button); Train starts itself at 0
//   (no buttons); each hands in its brain when training is done (at the latest at the train phase's end, the best so
//   far); a brain for a later round, or after the
//   freeze, is refused; the entries freeze as the countdown begins and every page's race = Node runRace of them (the
//   bots' brains from Node: one past round 1's budget left out by every client, one bot with nothing in at 0 m), Go
//   at the server's moment, at most MAX_RIVALS others drawn in 3-D (the nearest), the sidebar's 10 racers; standings
//   for 8 s = Node (signed, every player, best race first: match polish §1), no buttons; each result reaches the room.
// - A latecomer joins in round 2's build (landscape phone): watches from the lobby with the round's countdown, then the
//   race (no car), standings = everyone's (it ran round 1 from the frozen entries); the server refuses its brain for
//   round 2; in from round 3's build. Main menu asks "Leave the room?" (Stay). Round 3, the last, with all three; the
//   final standings = Node's best races, Play again and Main menu for all. The map (tracks-v2 T2): the host set "One track" before
//   the match, so every round's race on every page runs on it; the settings are locked while the match is on (the
//   latecomer's lobby says so; the server refuses a change). Play again → the lobby for each; the settings unlock; the
//   host sets "One family" and starts match 2 on every page (the latecomer from its final standings), on that family.
//   The host leaves: the server hands the room to the player who joined earliest (the guest); then Main menu →
//   Leave: the title, out of the room.
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
import { compile, genomeToJSON, zeroGenome } from '../../src/common/sim/brain';
import { energyRefusal } from '../../src/common/sim/energy';
import { cpuRounds } from '../../src/common/sim/cpu';
import { recordCar, ROUND_RACE, roundTrackSeed, runRace, type MapSetting, type RaceResult } from '../../src/common/sim/match';
import { familyOf } from '../../src/common/sim/track';
import { createHash } from 'node:crypto';
import type { BrainSpec, Genome } from '../../src/common/sim/spec';
import { MAX_RIVALS } from '../../src/client/render/drive';
import { fixtureBrain, STANDINGS_LAYOUT, standingsClear, type StandingsLayout } from './fixture';
import { startStandin } from './standin';

const OUT = 'out/multiplayer';
const T = 300_000;
const HZ = CONFIG.tick.hz, RC = CONFIG.rounds.count; // the match's rounds (3: match polish §1)
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const SERVICE = 'service-role-sentinel-do-not-ship';
const BIG: BrainSpec = { v: 2, senses: { boundary: 7, far: 5, hd: 8, grid: 6, speed: 1 }, layers: Array.from({ length: 4 }, () => ({ n: 8, fn: 'tanh' as const })) };
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
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); if (m.type() === 'warning' && m.text().startsWith('room:')) console.log(`     page warns: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(base);
    await page.evaluate(() => localStorage.setItem('synapse.notice', '3'));
    await page.goto(base + query);
    await page.waitForSelector('#title:not([hidden])');
    return page;
  }
  const room = (p: Page) => p.evaluate(() => JSON.parse(JSON.stringify(window.__room ?? null)) as { me: { code: string; player: string; host: boolean; name: string; token: string } | null; state: { players: { id: string; name: string; host: boolean }[]; race_no: number; race_seed: number | null; max_players: number } | null; shown: boolean; error: string; watching: string; screen: string | null; layout: string; fontPx: number; settings: { max: number; map: MapSetting; locked: boolean; editable: boolean } | null });
  /** The lobby's host marks and settings panel as a page shows them (a string: no bundler helpers in the page). */
  const hostView = (p: Page) => p.evaluate(`(() => ({ tags: [...document.querySelectorAll('#lbField .chip')].filter((c) => c.querySelector('b.tag')).map((c) => c.lastChild.textContent),
    header: document.getElementById('lbHost').getAttribute('aria-label'), headerText: document.getElementById('lbHost').innerText.replace(/\\s+/g, ' ').trim(),
    maxOn: !document.getElementById('lbMax').disabled, max: document.getElementById('lbMax').value, mapBtn: !document.getElementById('lbMapBtn').hidden && !document.getElementById('lbMapBtn').disabled,
    state: document.getElementById('lbSetState').textContent, mapText: document.getElementById('lbMapT').textContent, count: document.getElementById('lbCount').textContent }))()`) as Promise<{ tags: string[]; header: string; headerText: string; maxOn: boolean; max: string; mapBtn: boolean; state: string; mapText: string; count: string }>;
  /** The host's map dialog: a mode, a family card, Shuffle; Done sends it. */
  const setMap = async (p: Page, mode: string, family: string, shuffle: boolean) => {
    await p.click('#lbMapBtn'); await p.waitForSelector('#mapDlg[open]');
    await p.click(`#lbMapPick [data-mode="${mode}"]`);
    await p.click(`#lbMapPick .tp-card[data-f="${family}"]`);
    if (shuffle) await p.click(`#lbMapPick .tp-shuf[data-f="${family}"]`);
    const m = await p.evaluate(`(() => { const e = document.getElementById('lbMapPick'), c = e.querySelector('.tp-card[aria-checked="true"]');
      return { mode: e.dataset.mode, family: c ? c.dataset.f : 'loop', seed: e.dataset.seed ? Number(e.dataset.seed) : 0 }; })()`) as MapSetting;
    await p.click('#mdGo');
    return m;
  };
  const screenIs = (p: Page, sc: string) => p.waitForFunction((x) => window.__room?.screen === x, sc, { timeout: 10_000 });
  // the chips in the field: name, rectangle, whether the text fits, and the field's rectangle (as a string: no bundler helpers in the page)
  const chipsOf = (p: Page) => p.evaluate(`(() => { const f = document.getElementById('lbField'), fr = f.getBoundingClientRect();
    const cs = [...f.querySelectorAll('.chip:not(.leaving)')].map((c) => { const r = c.getBoundingClientRect(); return { name: c.lastChild.textContent, me: c.classList.contains('me'), x: r.left, y: r.top, w: r.width, h: r.height, fits: c.scrollWidth <= c.clientWidth + 1 }; });
    return { chips: cs, field: { x: fr.left, y: fr.top, w: fr.width, h: fr.height, sh: f.scrollHeight, ch: f.clientHeight, sw: f.scrollWidth, cw: f.clientWidth } }; })()`) as Promise<{ chips: { name: string; me: boolean; x: number; y: number; w: number; h: number; fits: boolean }[]; field: { x: number; y: number; w: number; h: number; sh: number; ch: number; sw: number; cw: number } }>;
  const inside = (c: { x: number; y: number; w: number; h: number }, f: { x: number; y: number; w: number; h: number }) => c.x >= f.x - 0.5 && c.y >= f.y - 0.5 && c.x + c.w <= f.x + f.w + 0.5 && c.y + c.h <= f.y + f.h + 0.5;
  const apart = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
  // as a string: the bundler's name helper isn't defined inside the page
  const race = (p: Page) => p.evaluate(`(() => { const r = window.__race; return r ? { state: r.state, kind: r.kind, me: r.me, hash: r.hash, trackSeed: r.trackSeed, names: r.names, results: r.results, t: r.t, end: r.end, frames: r.frames, go: r.go, goEpoch: performance.timeOrigin + r.goAt, computeMs: r.computeMs, drawn: r.drawn(), dots: r.dots() } : null; })()`) as Promise<{
    state: string; kind: string; me: number; hash: string; trackSeed: number; names: string[]; results: { name: string; place: number }[]; t: number; end: number; frames: number; go: boolean; goEpoch: number; computeMs: number; drawn: number[][]; dots: number;
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

    // the host (tracks-v2 T2): the tag, the header, the settings (the host's; read-only for the guest)
    await guest.waitForFunction(() => window.__room?.settings !== null && (window.__room?.state?.players.length ?? 0) === 2, null, { timeout: 10_000 });
    const [hv, gv] = await Promise.all([hostView(host), hostView(guest)]);
    check(hv.tags.join() === 'Host' && gv.tags.join() === 'Host' && hv.header === 'Host: Host' && gv.header === 'Host: Host' && /^HOST Host$/i.test(gv.headerText),
      `the host's chip has the "Host" tag on both pages, and both headers say "${gv.header}"`);
    check(hv.maxOn && hv.mapBtn && hv.max === '100' && !gv.maxOn && !gv.mapBtn && gv.max === '100' && gv.state === 'Set by the host.' && hv.mapText === 'New track each round' && gv.mapText === hv.mapText,
      `Settings: the host can change max players (${hv.max}) and the map ("${hv.mapText}"); the guest sees them read-only ("${gv.state}")`);
    await guest.screenshot({ path: `${OUT}/lobby-guest-settings.png` });
    // max players 2: a third is refused, on the code screen and by the server; never below the number in
    await host.locator('#lbMax').fill('2'); await host.locator('#lbMax').press('Enter');
    await guest.waitForFunction(() => window.__room?.settings?.max === 2, null, { timeout: 10_000 });
    const phone = await open('', 844, 390);
    await phone.click('#toMatch'); await phone.locator('#mpCode').pressSequentially(code);
    await phone.waitForFunction(() => /full/.test(window.__room?.error ?? ''), null, { timeout: 10_000 }).catch(() => undefined);
    const fullMsg = await phone.locator('#mpCodeErr').innerText();
    let full2 = '', below = '';
    try { si.rpc('synapse_join_room', { p_code: code, p_name: 'Third', p_token: 't'.repeat(32) }); } catch (e) { full2 = (e as Error).message; }
    const ht = (await room(host)).me!.token;
    try { si.rpc('synapse_set_settings', { p_code: code, p_token: ht, p_max: 1, p_mode: 'each', p_family: 'loop', p_seed: 0 }); } catch (e) { below = (e as Error).message; }
    await host.locator('#lbMax').fill('1'); await host.locator('#lbMax').press('Enter');
    const clamp = await host.locator('#lbMax').inputValue();
    check(fullMsg === 'That room is full (2 players).' && full2 === 'room full' && (await guest.locator('#lbCount').innerText()) === '2 / 2' && below === 'max players' && clamp === '2' && si.rooms.get(code)!.maxPlayers === 2,
      `max players 2: a third is refused ("${fullMsg}"; the server: ${full2}); the guest's lobby counts 2 / 2; never below the number in (the field stays at ${clamp}; the server: ${below})`);
    await host.locator('#lbMax').fill('100'); await host.locator('#lbMax').press('Enter');
    await host.waitForFunction(() => window.__room?.settings?.max === 100, null, { timeout: 10_000 });
    await phone.locator('#mpCode').fill(''); await phone.locator('#mpCode').pressSequentially(code); await screenIs(phone, 'name');
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
    await lateP.click('#toCpu'); await lateP.locator('#csName').fill('Late'); await lateP.click('#csStart');
    await lateP.waitForFunction(() => window.__match?.phase === 'build' && window.__phase?.state === 'running', null, { timeout: 15_000 });
    await lateP.evaluate(() => window.__phase!.skipTo(0.2));
    await lateP.waitForFunction(() => window.__training?.state === 'done' && window.__phase?.state === 'running', null, { timeout: 60_000 });
    await lateP.evaluate(() => window.__phase!.skipTo(0.2));
    await lateP.waitForFunction(() => (window.__race?.frames ?? 0) > 1, null, { timeout: 60_000 });
    await lateP.click('#rcMenu'); await lateP.waitForSelector('#leaveDlg[open]'); await lateP.click('#lvGo');
    await lateP.waitForSelector('#title:not([hidden])');
    await lateP.click('#toMatch'); await lateP.locator('#mpCode').pressSequentially(code); await screenIs(lateP, 'name');
    await lateP.locator('#mpName').fill('Late'); // (filled in already: the name it played vs CPU under)

    // the map (tracks-v2 T2): "One track", a shuffled clover, for every round; the guest sees it
    const MAP = await setMap(host, 'track', 'clover', true);
    await guest.waitForFunction((sd) => window.__room?.settings?.map.seed === sd, MAP.seed, { timeout: 10_000 });
    const gm = await hostView(guest);
    check(MAP.mode === 'track' && MAP.family === 'clover' && familyOf(MAP.seed) === 'clover' && si.rooms.get(code)!.mapMode === 'track' && si.rooms.get(code)!.mapSeed === MAP.seed && gm.mapText.startsWith('One track: Clover'),
      `the host's map: "One track", a shuffled clover (seed ${MAP.seed}); the guest's panel shows "${gm.mapText}"`);
    await guest.screenshot({ path: `${OUT}/lobby-guest-map.png` });
    await host.screenshot({ path: `${OUT}/lobby-host-settings.png` });

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
    check(b1.every((b) => b.label === `Round 1 of ${RC} · Build` && b.left >= 55 && b.left <= 60) && Math.abs(b1[0].ms - b1[1].ms) < 1700 && lk.every((l) => l.rounds && l.match && l.train && l.app && l.mp),
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
      const genomes = ok.map((e) => JSON.parse(e.brain) as Genome);
      node[n - 1] = runRace(genomes, derive(matchSeed >>> 0, 0x50d5, n), undefined, ROUND_RACE, roundTrackSeed(derive(matchSeed >>> 0, 0x50d5, n), MAP));
      return { entries, ok, genomes, race: node[n - 1] };
    };
    /** Build → train (no buttons) → hand in → the race (= Node on every page) → standings; returns Node's round. */
    const playRound = async (n: number, players: Page[], watchers: Page[], o: { shots?: boolean } = {}) => {
      const all = [...players, ...watchers];
      await label(players, `Round ${n} of ${RC} · Build`);
      await skip(all, 0.3);
      await label(players, `Round ${n} of ${RC} · Train`);
      await Promise.all(players.map((p) => p.waitForFunction(() => window.__training?.state === 'running' || window.__training?.state === 'done', null, { timeout: 30_000 })));
      const btn = await Promise.all(players.map((p) => p.evaluate(() => ['tvStop', 'tvBack', 'tvAgain', 'tvDrive', 'tvRace'].filter((id) => !(document.getElementById(id) as HTMLElement).hidden))));
      check(btn.every((b) => b.length === 0), `round ${n}: Train starts itself at the build's 0, "Round ${n} of ${RC} · Train", no buttons in the training view (${btn.map((b) => b.join('+') || 'none').join(', ')})`);
      if (o.shots) await players[0].screenshot({ path: `${OUT}/m-train.png` });
      await Promise.all(players.map((p) => p.waitForFunction(() => window.__training?.state === 'done', null, { timeout: 60_000 })));
      await skip(all, 0.3);
      await Promise.all(players.map((p) => p.waitForFunction(() => window.__roomMatch?.handed === true, null, { timeout: 15_000 })));
      // handed in before the freeze: the stand-in holds each player's trained brain for this round
      const held = si.rooms.get(code)!.brains.get(n)!;
      const mine = await Promise.all(players.map((p) => p.evaluate(() => ({ me: window.__room!.me!.player, trained: window.__roomMatch!.trained }))));
      check(mine.every((x) => held.get(x.me) === genomeToJSON(x.trained!)), `round ${n}: each player's trained brain is handed in by the train phase's end (${mine.length} in the room's round ${n})`);
      await Promise.all(all.map((p) => p.waitForFunction(() => window.__roomMatch?.step === 'race', null, { timeout: 30_000 })));
      const nr = nodeRound(n);
      // this round's race on screen (the last round's may still be there a moment): its hash, drawing
      await Promise.all(all.map((p) => p.waitForFunction((hsh) => window.__race?.hash === hsh && (window.__race?.frames ?? 0) > 1, nr.race.hash, { timeout: 30_000, polling: 100 }).catch(() => undefined)));
      const rs = await Promise.all(all.map((p) => race(p)));
      check(rs.every((r) => r!.hash === nr.race.hash && r!.trackSeed === MAP.seed), `round ${n}: the entries froze as the countdown began; every page's race hash = Node runRace of them (${nr.ok.length} racing of ${nr.entries.length} in), on the room's one track (${MAP.seed}): ${nr.race.hash}`);
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
      await label(all, `Round ${n} of ${RC} · Race`);
      await skip(all, 0.3);
      for (const p of all) await p.evaluate(() => window.__race!.seek(1e9));
      await step(all, n < RC ? 'standings' : 'over');
      await Promise.all(all.map((p) => p.waitForFunction((k) => (window.__roomMatch?.standings[k - 1]?.length ?? 0) > 0, n, { timeout: 15_000 })));
      if (n === RC) return 0;
      await label(all, `Round ${n + 1} of ${RC} in`);
      const ms = await all[0].evaluate(() => window.__phase!.ms), want = matchAt + roundTimes(n).next - (Date.now() + si.skew);
      await skip(all, 60); // held while the check reads them
      return ms - want;
    };
    /** Standings after round n as Node has them: every player in it (0 m with nothing in), best race, total, round, name. */
    const nodeStandings = (n: number, ids: Map<string, string>) => {
      const dist = (k: number, id: string) => { const e = JSON.parse(si.rooms.get(code)!.frozen.get(k)!) as { id: string; brain: string }[]; const ok = e.filter((x) => energyRefusal((JSON.parse(x.brain) as Genome).spec, CONFIG.rounds.budgets[k - 1]) === null); const i = ok.findIndex((x) => x.id === id); return i < 0 ? 0 : node[k - 1].cars[i].dist; };
      return [...ids].map(([id, name]) => { let total = 0, best = -Infinity; for (let k = 1; k <= n; k++) { const x = dist(k, id); total += x; best = Math.max(best, x); } return { name, d: dist(n, id), best, total }; })
        .sort((a, b) => b.best - a.best || b.total - a.total || b.d - a.d || (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));
    };
    const km = (m: number) => { const v = (Math.abs(m) / 1000).toFixed(2); return `${m < 0 && v !== '0.00' ? '−' : ''}${v} km`; };
    /**
     * A standings table as the page should show it (principal 2026-11-05: 10 rows): places 1–3, then the 7 nearest
     * your place in the table's order, "⋯" where they don't meet; all of them up to 10. Written out here, not taken
     * from the app, so the check is independent of raceView's listRows.
     */
    const shownOf = (st: { name: string; d: number; best: number }[], you: string) => {
      const n = st.length, p = Math.max(0, st.findIndex((x) => x.name === you)), start = Math.max(3, Math.min(p - 3, n - 7));
      const idx = n <= 10 ? st.map((_, i) => i) : [0, 1, 2, ...Array.from({ length: 7 }, (_, i) => start + i)];
      return idx.flatMap((i, j) => [...(j === 3 && i > 3 ? [['⋯']] : []), [String(i + 1), st[i].name, km(st[i].d), km(st[i].best)]]);
    };
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

    // follow a far car from the map (follow-a-racer plan): it is drawn, the cars drawn are those nearest it, its brain
    const dotsAt = await host.evaluate(() => Array.from({ length: window.__race!.dots() }, (_, k) => window.__race!.dotAt(k)));
    const far = n1.race.cars.map((_, k) => k).filter((k) => k > 1 && dotsAt[k]).sort((a, b) => d2[b] - d2[a]).slice(0, 30)
      .map((k) => ({ k, gap: Math.min(...dotsAt.map((q, j) => (j === k || !q ? Infinity : Math.hypot(q.x - dotsAt[k]!.x, q.y - dotsAt[k]!.y)))) }))
      .sort((a, b) => b.gap - a.gap)[0];
    await host.mouse.click(dotsAt[far.k]!.x, dotsAt[far.k]!.y);
    const fr0 = await host.evaluate(() => window.__race!.frames); // frames drawn since the tap
    await host.waitForFunction((f) => (window.__race?.frames ?? 0) > f + 2, fr0, { timeout: 30_000 });
    const fo = await host.evaluate(`(() => { const r = window.__race; return { k: r.following(), title: r.cardTitle(), vals: r.cardVals(), own: r.ownVals(), main: r.drawn()[0], others: r.drawn().slice(1).map((p) => p[4]), look: r.lookOff(), cam: r.cam().mode, t: r.t, mine: !document.getElementById('rcMine').hidden }; })()`) as
      { k: number; title: string; vals: number[] | null; own: number[] | null; main: number[]; others: number[]; look: number; cam: string; t: number; mine: boolean };
    const fg = n1.genomes[far.k], frec = recordCar(fg, n1.race.track, n1.race.cars[far.k].slot, ROUND_RACE), fN = compile(fg).nNodes, fb = Math.min(Math.floor(fo.t * HZ - 1) + 1, frec.ticks - 1);
    const fvals = Array.from(frec.act.subarray(fb * fN, (fb + 1) * fN));
    const fp = posAt(far.k), dk = n1.race.cars.map((_, k) => { const p = posAt(k); return k === far.k ? Infinity : (p[0] - fp[0]) ** 2 + (p[1] - fp[1]) ** 2; });
    const wantF = n1.race.cars.map((_, k) => k).sort((a, b) => dk[a] - dk[b] || a - b).slice(0, MAX_RIVALS).sort((a, b) => a - b);
    check(fo.k === far.k && fo.main[4] === far.k && fo.main[3] === 1 && JSON.stringify(fo.others) === JSON.stringify(wantF) && fo.look < 3 && fo.cam === 'race',
      `the map: tap ${n1.ok[far.k].name}'s dot (${Math.sqrt(d2[far.k]).toFixed(0)} m from you): the race camera (broadcast or POV) follows that car, drawn (never a ghost), with the ${MAX_RIVALS} cars nearest it (${wantF.join(' ')}${JSON.stringify(fo.others) === JSON.stringify(wantF) ? '' : `; drawn ${fo.others.join(' ')}`}; following ${fo.k}, main car ${fo.main[4]} shown ${fo.main[3]}, aim ${fo.look.toFixed(2)} m off, ${fo.cam})`);
    check(fo.title === `Brain · ${n1.ok[far.k].name}` && !!fo.vals && fo.vals.length === fvals.length && fo.vals.every((x, i) => Math.abs(x - fvals[i]) < 1e-9) && JSON.stringify(fo.vals) !== JSON.stringify(fo.own) && fo.mine,
      `its brain card ("${fo.title}") fires as Node's replay of that entry; "Back to my car" shows (values ${fo.vals?.length} vs ${fvals.length}, max diff ${fo.vals ? Math.max(...fo.vals.map((x, i) => Math.abs(x - (fvals[i] ?? NaN)))).toExponential(1) : '-'}, at ${fo.t.toFixed(2)} s; button ${fo.mine})`);
    await host.screenshot({ path: `${OUT}/follow-far.png` });
    await host.click('#rcMine');
    await host.waitForFunction(() => window.__race?.following() === 0, null, { timeout: 10_000 }).catch(() => undefined);
    check((await host.evaluate(() => [window.__race!.following(), window.__race!.cardTitle()].join('|'))) === '0|Brain · live', '"Back to my car": your car and your brain again');
    await host.evaluate(() => { window.__race!.hold = false; });
    const st8 = await toStandings(1, pages);
    check(Math.abs(st8) < 400 && roundTimes(1).next - roundTimes(1).standings === 8000, `round 1's race ends: 8 s of standings, counting down to round 2's build on the server's clock (${st8.toFixed(0)} ms off)`);
    const ids1 = new Map<string, string>(si.players.filter((p) => p.room === code).map((p) => [p.id, p.name]));
    const s1 = nodeStandings(1, ids1);
    const t1 = await Promise.all(pages.map(tableOf));
    const st1 = await Promise.all(pages.map((p) => p.evaluate(() => ({ s: window.__roomMatch!.standings[0], d: window.__roomMatch!.dists[0] }))));
    check(JSON.stringify(st1[0].s) === JSON.stringify(s1.map((x) => x.name)) && JSON.stringify(st1[1].s) === JSON.stringify(st1[0].s) && st1[0].d['Bot 1'] === 0 && st1[0].d['Bot 2'] === undefined && s1.find((x) => x.name === 'Bot 2')!.total === 0,
      `round 1's standings on both = Node: all 98 players, signed distances, best race first (${s1.slice(0, 3).map((x) => x.name).join(', ')} …); Bot 1 (left out) at 0 m, Bot 2 (nothing in) listed at 0 m`);
    check(JSON.stringify(t1[0]) === JSON.stringify(shownOf(s1, 'Host')) && JSON.stringify(t1[1]) === JSON.stringify(shownOf(s1, 'Guest')),
      `the table shows 10 of the 98 as the sidebar does: places 1–3, "⋯", then those nearest you (host: ${t1[0].map((x) => x[0]).join(' ')}; guest: ${t1[1].map((x) => x[0]).join(' ')})`);
    // the panel sits below the round's timer
    const lay1 = await Promise.all(pages.map((p) => p.evaluate(STANDINGS_LAYOUT) as Promise<StandingsLayout>));
    check(lay1.every((l) => standingsClear(l, 98) && l.places.length === 11 && l.you !== null),
      `a 98-player table: exactly 10 player rows and "⋯", places 1–3 and your row (${lay1.map((l) => l.you).join(', ')}), clear of the timer (${lay1.map((l) => `${l.gap.toFixed(0)} px below it`).join(' at 1440×900, ')} at 844×390), nothing scrolls`);
    await guest.screenshot({ path: `${OUT}/m-standings-844x390.png` }); // while the standings are held
    const stl = await Promise.all(pages.map(ph));
    check(stl.every((x) => x.label === `Round 2 of ${RC} in`) && await host.locator('#rcAgain').isHidden() && await host.locator('#rcBack').isHidden(), `the standings count down to round 2, no buttons ("${stl[0].label}")`);
    await new Promise((res) => setTimeout(res, 800));
    const res1 = si.players.filter((p) => p.name === 'Host' || p.name === 'Guest').map((p) => p.result ? JSON.parse(p.result) as { round: number; place: number } : null);
    check(res1.every((x) => x !== null && x.round === 1) && res1[0]!.place === s1.findIndex((x) => x.name === 'Host') + 1, `each player's round result reaches the room (host ${res1[0]?.place}, guest ${res1[1]?.place})`);
    await skip(pages, 8, `Round 2 of ${RC} in`);
    await host.screenshot({ path: `${OUT}/m-standings.png` });
    // round 2: a latecomer joins during the build and watches (the lobby, then the race) until round 3's build
    await skip(pages, 0.3, `Round 2 of ${RC} in`);
    await label(pages, `Round 2 of ${RC} · Build`);
    await lateP.click('#mpGo');
    await lateP.waitForFunction(() => window.__roomMatch?.step === 'wait' && window.__phase?.state === 'running', null, { timeout: 15_000 });
    const lw = await lateP.evaluate(() => ({ w: window.__room!.watching, first: window.__roomMatch!.first, label: window.__phase!.label, lobby: !(document.getElementById('mpLobby') as HTMLElement).hidden }));
    check(lw.lobby && lw.first === 3 && lw.label === `Round 2 of ${RC} · Build` && /You join at round 3's build/.test(lw.w), `a player who joins mid-match watches: the lobby says "${lw.w}", round 2's countdown in its bar ("${lw.label}"; first round ${lw.first}; lobby ${lw.lobby})`);
    await lateP.screenshot({ path: `${OUT}/m-late-watch-844x390.png` });
    await lateP.waitForFunction(() => window.__room?.settings?.locked === true, null, { timeout: 10_000 }).catch(() => undefined);
    const lk2 = await hostView(lateP);
    let onErr = '';
    try { si.rpc('synapse_set_settings', { p_code: code, p_token: ht, p_max: 50, p_mode: 'each', p_family: 'loop', p_seed: 0 }); } catch (e) { onErr = (e as Error).message; }
    check(lk2.state === 'Locked while the match is on.' && !lk2.maxOn && onErr === 'match on', `while the match is on the settings are locked ("${lk2.state}"; the server: ${onErr})`);
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
    await label(all3, `Round 3 of ${RC} · Build`);
    const ll = await look(lateP);
    check(ll.rounds && ll.match && ll.app && ll.mp, 'round 3: the latecomer is in, building in the designer like everyone');
    // Main menu asks first, in a room
    await guest.click('#toTitle');
    await guest.waitForSelector('#leaveDlg[open]');
    const q = await guest.locator('#lvQ').innerText();
    await guest.click('#lvStay');
    check(q === 'Leave the room?' && (await guest.evaluate(() => window.__roomMatch!.step)) === 'build', `Main menu asks "${q}" first; Stay keeps you in the match`);

    // round 3 (the last: match polish §1), all three in; then the final standings
    for (let n = 3; n <= RC; n++) {
      await playRound(n, all3, []);
      await toStandings(n, all3);
      if (n < RC) await skip(all3, 0.3);
    }
    const fin = await Promise.all(all3.map((p) => p.evaluate((k) => ({ s: window.__roomMatch!.standings[k - 1], step: window.__roomMatch!.step, t: document.getElementById('rcResT')!.textContent, again: !(document.getElementById('rcAgain') as HTMLElement).hidden, back: !(document.getElementById('rcBack') as HTMLElement).hidden, backT: document.getElementById('rcBack')!.textContent, timer: window.__phase!.state }), RC)));
    const ids5 = new Map(ids1); ids5.set(si.players.find((p) => p.name === 'Late')!.id, 'Late');
    const s5 = nodeStandings(RC, ids5), t5 = await Promise.all(all3.map(tableOf));
    check(fin.every((f) => f.step === 'over' && f.back && f.backT === 'Main menu' && f.timer === 'off' && f.again && JSON.stringify(f.s) === JSON.stringify(s5.map((x) => x.name)))
      && ['Host', 'Guest', 'Late'].every((nm, k) => JSON.stringify(t5[k]) === JSON.stringify(shownOf(s5, nm))),
      `after round ${RC}: the final standings = Node's best races on every page, 10 of the 99 rows by best race as the sidebar picks them ("${fin[0].t}": ${t5[0].map((x) => x[0]).join(' ')}; "${fin[1].t}": ${t5[1].map((x) => x[0]).join(' ')}), Play again and Main menu for all`);
    await host.screenshot({ path: `${OUT}/m-final.png` });
    await guest.screenshot({ path: `${OUT}/m-final-guest.png` });

    // Play again: back to the lobby (the guest's read-only, the host's unlocking once the match is over); the host sets
    // "One family" and starts match 2 on every page, the latecomer from its final standings
    await guest.click('#rcAgain');
    await screenIs(guest, 'lobby');
    await host.click('#rcAgain');
    await screenIs(host, 'lobby');
    await host.waitForFunction(() => window.__room?.settings?.editable === true && !(document.getElementById('lbStart') as HTMLButtonElement).disabled, null, { timeout: 15_000 });
    const back2 = await Promise.all([hostView(host), hostView(guest)]);
    check(await host.locator('#arena').isHidden() && back2[0].maxOn && back2[0].mapBtn && !back2[1].maxOn && back2[1].state === 'Set by the host.' && (await room(guest)).watching === '',
      'Play again: each player back in the lobby; the settings unlock for the host (the guest\'s stay read-only)');
    const MAP2 = await setMap(host, 'family', 'eight', false);
    await guest.waitForFunction(() => window.__room?.settings?.map.mode === 'family', null, { timeout: 10_000 });
    await host.click('#lbStart');
    await Promise.all(all3.map((p) => p.waitForFunction((l) => window.__roomMatch?.matchNo === 2 && window.__roomMatch.step === 'build' && window.__phase?.label === l, `Round 1 of ${RC} · Build`, { timeout: 15_000 })));
    const m2 = await Promise.all(all3.map((p) => p.evaluate(() => ({ map: window.__roomMatch!.map, tracks: window.__roomMatch!.tracks, seed: window.__roomMatch!.seed }))));
    const want2 = Array.from({ length: RC }, (_, k) => roundTrackSeed(derive(m2[0].seed >>> 0, 0x50d5, k + 1), MAP2));
    check(si.rooms.get(code)!.matchNo === 2 && m2.every((x) => JSON.stringify(x.tracks) === JSON.stringify(want2) && x.map?.mode === 'family') && want2.every((x) => familyOf(x) === 'eight'),
      `the host sets "One family" (figure eight) and starts match 2 on every page (the latecomer from its final standings): a new figure eight each round (${want2.join(', ')})`);
    // the host leaves: the server hands the room to the player who joined earliest (the guest)
    await host.click('#toTitle'); await host.waitForSelector('#leaveDlg[open]'); await host.click('#lvGo');
    await guest.waitForFunction(() => window.__room?.me?.host === true, null, { timeout: 10_000 }).catch(() => undefined);
    const gTok = (await room(guest)).me!.token, after = si.rpc('synapse_room_state', { p_code: code }) as { players: { name: string; host: boolean }[] };
    check((await room(guest)).me!.host && si.rooms.get(code)!.hostHash === createHash('sha256').update(gTok).digest('hex') && after.players.filter((p) => p.host).map((p) => p.name).join() === 'Guest' && !after.players.some((p) => p.name === 'Host'),
      'the host leaves: the server makes the guest (who joined earliest of those left) the host, and the guest\'s page knows');
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
