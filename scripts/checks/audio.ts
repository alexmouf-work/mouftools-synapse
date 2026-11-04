// Sound check (docs/plans/2026-11-04-sound.md), headless Chromium with autoplay allowed:
// - Before any gesture audio is locked; the first click unlocks it and the workbench plays the lounge.
// - Train (10 generations from the popup, race mode) then Drive; the countdown follows the music: 5, 4, 3, 2, 1, Go, the car held on the line (tick 0) until Go
//   and moving after, Go on the drop (the racing sections start there); the drive hash is the Node replay's.
// - Back to the workbench → the lounge again. The winner hook plays the winner once, then the lounge comes back.
// - A hidden tab suspends the audio; visible again, it resumes.
// - The speaker button mutes (master to 0), is remembered across a reload (synapse.sound), and a muted Drive counts
//   down on the plain timer with the same spacing. Console clean.
//   npx tsx scripts/checks/audio.ts
import { chromium, type Browser, type Page } from 'playwright';
import { createServer } from 'vite';
import { runDrive } from '../../src/common/sim/race';
import { defaultSpec } from '../../src/common/sim/spec';
import { InlineExecutor } from '../../src/common/train/episodes';
import { phaseSeeds, runPhase } from '../../src/common/train/phase';
import meta from '../../src/assets/music/music.json';

const SEED = 7, T = 300_000, GENS = 10;
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
let fails = 0;
const check = (cond: boolean, what: string) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (!cond) fails++; };

async function main() {
  const run1 = (await runPhase(new InlineExecutor(), defaultSpec(), SEED, { T, generations: GENS })).final;
  const run2 = (await runPhase(new InlineExecutor(), defaultSpec(), SEED, { T, generations: GENS, phase: 1, start: 'carry', genome: run1 })).final;
  const nodeHash = [runDrive(run1, phaseSeeds(SEED, 0).unseenTrack).hash, runDrive(run2, phaseSeeds(SEED, 1).unseenTrack).hash];

  const server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
  await server.listen();
  const addr = server.httpServer?.address();
  if (!addr || typeof addr === 'string') throw new Error('no server address');
  const base = `http://127.0.0.1:${addr.port}/`;
  let browser: Browser;
  try { browser = await chromium.launch({ args: ARGS }); } catch { browser = await chromium.launch({ executablePath: CHROMIUM, args: ARGS }); }
  const errors: string[] = [];
  const au = (page: Page) => page.evaluate(() => ({ ...window.__audio! }));
  const dv = (page: Page) => page.evaluate(() => { const d = window.__drive!; return { tick: d.tick, distance: d.distance, go: d.go, seen: [...d.countdownSeen], music: d.countdownMusic, hash: d.hash, frames: d.frames }; });

  /** Train (the popup, GENS generations), Drive from the finished view, follow the countdown; returns what was seen. */
  async function countdown(page: Page, label: string, music: boolean, run: number) {
    await page.click('#train');
    await page.click(`#gens [data-g="${GENS}"]`);
    await page.click('#tdGo');
    await page.waitForFunction(() => window.__training?.state === 'done', null, { timeout: 300_000 });
    check((await au(page)).mode === 'race', `${label}: training plays the race music`);
    await page.click('#tvDrive');
    await page.waitForFunction(() => (window.__drive?.frames ?? 0) > 2, null, { timeout: 60_000 });
    const a = await au(page);
    check(a.mode === 'race', `${label}: Drive → race mode`);
    let held = true, samples = 0;
    while (!(await dv(page)).go) {
      const d = await dv(page);
      if (!d.go) { held &&= d.tick === 0 && d.distance === 0; samples++; }
      await page.waitForTimeout(150);
      if (samples > 200) break;
    }
    const atGo = await au(page);
    await page.waitForFunction(() => window.__drive?.countdownSeen.includes('Go'), null, { timeout: 5_000 });
    await page.waitForTimeout(1500);
    const d = await dv(page);
    check(d.music === music, `${label}: the countdown ${music ? 'follows the music' : 'runs on the plain timer'}`);
    check(JSON.stringify(d.seen) === JSON.stringify(['5', '4', '3', '2', '1', 'Go']), `${label}: countdown shows ${d.seen.join(', ')}`);
    check(held && samples >= 3, `${label}: the car is held on the line until Go (${samples} looks, tick 0, 0 m)`);
    check(Math.abs(d.distance) > 1, `${label}: and moves after Go (${d.distance.toFixed(1)} m 1.5 s later; a briefly trained brain may reverse)`);
    check(d.hash === nodeHash[run], `${label}: drive hash ${d.hash} = Node replay ${nodeHash[run]}`);
    return { atGo, after: await au(page) };
  }

  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    const at = `${base}?seed=${SEED}&T=${T}`;
    await page.goto(at);
    await page.evaluate(() => localStorage.setItem('synapse.notice', '2'));
    await page.goto(at);
    await page.waitForTimeout(500);
    check((await au(page)).state === 'locked', 'before any tap or key, audio is locked');
    check(await page.locator('button.sound').count() === 3 && await page.locator('#soundWb').getAttribute('aria-label') === 'Sound', 'a Sound button in the workbench header and both views\' action rows');

    // 1. unlock → build
    await page.click('.word');
    await page.waitForFunction(() => window.__audio?.playing === true, null, { timeout: 30_000 });
    let a = await au(page);
    check(a.state === 'running' && a.mode === 'lounge' && a.phrase === 'lounge', `first click unlocks: ${a.state}, ${a.mode} mode, playing ${a.phrase}`);
    await page.waitForFunction(() => window.__audio?.ready === true, null, { timeout: 60_000 });

    // 2. Drive → race, countdown on the music, Go on the drop
    const r = await countdown(page, 'sound on', true, 0);
    check(r.after.phrase === 'drive-a', `Go lands on the drop: the racing sections start there (now playing ${r.after.phrase})`);

    // 3. back → the lounge, at the next bar line of the race music
    await page.click('#dvBack');
    a = await au(page);
    check(a.mode === 'lounge', 'Back to workbench → lounge mode');
    await page.waitForFunction(() => window.__audio?.phrase === 'lounge', null, { timeout: meta.bar * 1000 + 3000 }).catch(() => {});
    check((await au(page)).phrase === 'lounge', 'the race music cross-fades into the lounge at the next bar line');

    // the winner hook (matches will call it): plays once, then the mode's music again
    await page.evaluate(() => window.__audio!.win());
    await page.waitForTimeout(300);
    a = await au(page);
    check(a.phrase === 'winner' && a.winnerS > 5, `win(): the winner plays (${a.winnerS.toFixed(1)} s)`);
    await page.waitForFunction(() => window.__audio?.phrase === 'lounge', null, { timeout: a.winnerS * 1000 + 5000 }).catch(() => {});
    a = await au(page);
    check(a.phrase === 'lounge' && a.mode === 'lounge', 'after the winner, the lounge comes back');

    // 4. hidden tab → suspended; visible → running
    // as a string: the bundler's name helper isn't defined inside the page
    const vis = (hidden: boolean) => page.evaluate(`(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => ${hidden} });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => '${hidden ? 'hidden' : 'visible'}' });
      document.dispatchEvent(new Event('visibilitychange'));
    })()`);
    await vis(true);
    await page.waitForFunction(() => window.__audio?.state === 'suspended', null, { timeout: 5_000 }).catch(() => {});
    check((await au(page)).state === 'suspended', 'tab hidden → audio suspended');
    await vis(false);
    await page.waitForFunction(() => window.__audio?.state === 'running', null, { timeout: 5_000 }).catch(() => {});
    check((await au(page)).state === 'running', 'tab visible again → audio running');

    // 5. mute: master to 0, remembered across a reload
    await page.click('#soundWb');
    await page.waitForTimeout(600);
    a = await au(page);
    check(a.muted && a.master < 0.01 && await page.locator('#soundWb').getAttribute('aria-pressed') === 'false', `the speaker button mutes (master ${a.master.toFixed(3)}, aria-pressed false)`);
    check(await page.evaluate(() => localStorage.getItem('synapse.sound')) === 'off', 'remembered in local storage (synapse.sound = off)');
    await page.reload();
    await page.waitForTimeout(500);
    check(await page.locator('#soundWb').getAttribute('aria-pressed') === 'false' && (await au(page)).muted, 'after a reload the sound is still off');
    await page.click('.word');
    await page.waitForFunction(() => window.__audio?.playing === true, null, { timeout: 30_000 });
    a = await au(page);
    check(a.state === 'running' && a.master === 0, `unlocked while muted: the music runs silent (master ${a.master})`);
    await countdown(page, 'muted', false, 1);
    await page.click('#dvBack');
    await page.click('#soundWb');
    await page.waitForTimeout(600);
    a = await au(page);
    check(!a.muted && a.master > 0.95 && await page.evaluate(() => localStorage.getItem('synapse.sound')) === 'on', `and back on (master ${a.master.toFixed(2)})`);
    await ctx.close();
    check(errors.length === 0, `console clean${errors.length ? ': ' + errors.join(' | ') : ''}`);
  } finally {
    await browser.close();
    await server.close();
  }
  if (fails) { console.error(`audio: ${fails} check(s) failed`); process.exit(1); }
  console.log('audio: all checks passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
