// Sound check (docs/plans/2026-11-04-sound.md), headless Chromium with autoplay allowed:
// - The page opens on the title; before any gesture audio is locked; the first tap unlocks it: the race track's quiet
//   pool; Sandbox → the lounge; the music never falls silent through title → sandbox → train → drive → back.
// - Train (10 generations from the popup, race mode) then Drive; the countdown follows the music: 5, 4, 3, 2, 1, Go, the car held on the line (tick 0) until Go
//   and moving after, Go on the drop (the racing sections start there); the drive hash is the Node replay's.
// - Back to the workbench → the lounge again. The winner hook plays the winner once, then the lounge comes back.
// - Leaving training, leaving mid-countdown and leaving a drive each stop every racing effect within 0.3 s (no blip
//   sounds later); the music plays on. A hidden, unfocused tab keeps playing.
// - Two toggles, independent (2026-11-04: "have one toggle for engine sounds and another for music."): Music off →
//   the music bus at 0 while the countdown blips and the engine still sound; Sound effects off → no blip or engine,
//   the music still plays; the master stays at 1. Both are remembered across a reload (synapse.sound as JSON) and the
//   old 'off' / 'on' reads as both. With either off, the countdown still follows the music clock; only a locked page
//   (no gesture yet) counts down on the plain timer, with the same spacing. Console clean.
//   npx tsx scripts/checks/audio.ts
import { chromium, type Browser, type Page } from 'playwright';
import { createServer } from 'vite';
import { CONFIG } from '../../src/common/config';
import { runDrive } from '../../src/common/sim/race';
import { defaultSpec, type Genome } from '../../src/common/sim/spec';
import { InlineExecutor } from '../../src/common/train/episodes';
import { phaseSeeds, runPhase } from '../../src/common/train/phase';

const SEED = 7, T = 300_000, GENS = 10;
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
let fails = 0;
const check = (cond: boolean, what: string) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (!cond) fails++; };

async function main() {
  // every training that ends with a brain is its next phase (a Stop after k generations too: the best so far is
  // saved); the Node replays follow the same chain, one step per run in the page
  let g: Genome | null = null, phase = 0, lastHash = '';
  async function nodeNext(stopAfter?: number): Promise<string> {
    const o = { T, generations: GENS, ...(g ? { phase, start: 'carry' as const, genome: g } : {}) };
    const stop = stopAfter === undefined ? {} : { stepTicks: (env: { worstCase(n: number): number }) => env.worstCase(CONFIG.train.population), stop: (() => { let n = 0; return () => n++ >= stopAfter; })() };
    const r = await runPhase(new InlineExecutor(), defaultSpec(), SEED, { ...o, ...stop });
    if (stopAfter === 0) return lastHash; // nothing evaluated: the brain is as it was
    g = r.final;
    lastHash = runDrive(g, phaseSeeds(SEED, phase).unseenTrack).hash;
    phase++;
    return lastHash;
  }

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
  async function countdown(page: Page, label: string, music: boolean) {
    await page.click('#train');
    await page.click(`#gens [data-g="${GENS}"]`);
    await page.click('#tdGo');
    await page.waitForFunction(() => window.__training?.state === 'done', null, { timeout: 300_000 });
    const want = await nodeNext();
    check((await au(page)).mode === 'race', `${label}: training plays the race music`);
    await page.click('#tvDrive');
    await page.waitForFunction(() => (window.__drive?.frames ?? 0) > 2, null, { timeout: 60_000 });
    const a = await au(page);
    check(a.mode === 'race', `${label}: Drive → race mode`);
    // the loudest each bus got through the countdown and the first 1.5 s of the drive (blips, then the engine)
    let held = true, samples = 0, musicMax = 0, sfxMax = 0;
    const peak = async () => { const x = await au(page); musicMax = Math.max(musicMax, x.musicLevel); sfxMax = Math.max(sfxMax, x.sfxLevel); };
    while (!(await dv(page)).go) {
      const d = await dv(page);
      if (!d.go) { held &&= d.tick === 0 && d.distance === 0; samples++; }
      await peak();
      await page.waitForTimeout(150);
      if (samples > 200) break;
    }
    const atGo = await au(page);
    await page.waitForFunction(() => window.__drive?.countdownSeen.includes('Go'), null, { timeout: 5_000 });
    for (let i = 0; i < 10; i++) { await peak(); await page.waitForTimeout(150); }
    // playback runs on real time, so a loaded headless page can be slow to cover the first metre: wait for it (bounded)
    const t0 = Date.now();
    await page.waitForFunction(() => Math.abs(window.__drive?.distance ?? 0) > 1, null, { timeout: 8000 }).catch(() => {});
    const waited = 1.5 + (Date.now() - t0) / 1000;
    const d = await dv(page);
    check(d.music === music, `${label}: the countdown ${music ? 'follows the music' : 'runs on the plain timer'}`);
    check(JSON.stringify(d.seen) === JSON.stringify(['5', '4', '3', '2', '1', 'Go']), `${label}: countdown shows ${d.seen.join(', ')}`);
    check(held && samples >= 3, `${label}: the car is held on the line until Go (${samples} looks, tick 0, 0 m)`);
    check(Math.abs(d.distance) > 1, `${label}: and moves after Go (${d.distance.toFixed(1)} m within ${waited.toFixed(1)} s; a briefly trained brain may reverse)`);
    check(d.hash === want, `${label}: drive hash ${d.hash} = Node replay ${want}`);
    return { atGo, after: await au(page), musicMax, sfxMax };
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
    check((await au(page)).state === 'locked' && await page.locator('#title').isVisible(), 'the page opens on the title; before any tap or key, audio is locked');
    const pairs = ['Ti', 'Wb', 'Tv', 'Dv'];
    const labels = await page.evaluate((ps) => ps.map((k) => [document.getElementById(`music${k}`)?.getAttribute('aria-label'), document.getElementById(`sfx${k}`)?.getAttribute('aria-label')].join('|')), pairs);
    check(await page.locator('button.sound').count() === 8 && labels.every((l) => l === 'Music|Sound effects'),
      'a Music and a Sound effects toggle side by side on the title, in the designer\'s top bar and in both views\' action rows');
    /** Every toggle's aria-pressed, as "music,sfx" (all four pairs must agree). */
    // as a string: the bundler's name helper isn't defined inside the page
    const pressed = () => page.evaluate(`(() => {
      const ps = ${JSON.stringify(pairs)}, v = (id) => document.getElementById(id).getAttribute('aria-pressed');
      const m = new Set(ps.map((k) => v('music' + k))), f = new Set(ps.map((k) => v('sfx' + k)));
      return m.size === 1 && f.size === 1 ? [...m][0] + ',' + [...f][0] : 'disagree';
    })()`) as Promise<string>;
    const stored = () => page.evaluate(() => localStorage.getItem('synapse.sound'));
    check(await pressed() === 'true,true', 'both start on');

    // 1. the first tap on the title unlocks it: the race track's quiet pool
    await page.click('#title h1');
    await page.waitForFunction(() => window.__audio?.playing === true, null, { timeout: 30_000 });
    let a = await au(page);
    check(a.state === 'running' && a.mode === 'build' && (a.phrase === 'intro' || a.phrase === 'breakdown'), `first tap on the title: ${a.state}, ${a.mode} mode, playing ${a.phrase}`);
    // the music must never fall silent from here on (sampled every 50 ms through title → sandbox → train → drive → back)
    await page.evaluate('window.__lv = []; window.__lvT = setInterval(() => window.__lv.push([performance.now(), window.__audio.level, window.__audio.phrase, window.__audio.mode]), 50)');

    // 2. Sandbox → the lounge
    await page.click('#toSandbox');
    await page.waitForFunction(() => window.__audio?.phrase === 'lounge', null, { timeout: 15_000 }).catch(() => {});
    a = await au(page);
    check(a.mode === 'lounge' && a.phrase === 'lounge', `Sandbox → the lounge (${a.phrase})`);
    await page.waitForFunction(() => window.__audio?.ready === true, null, { timeout: 60_000 });

    // 3. Train → race, Drive, the countdown on the music, Go on the drop
    const r = await countdown(page, 'sound on', true);
    check(r.after.phrase === 'drive-a', `Go lands on the drop: the racing sections start there (now playing ${r.after.phrase})`);

    // 4. back → the lounge, quickly
    await page.click('#dvBack');
    a = await au(page);
    check(a.mode === 'lounge', 'Back to workbench → lounge mode');
    await page.waitForFunction(() => window.__audio?.phrase === 'lounge', null, { timeout: 3000 }).catch(() => {});
    check((await au(page)).phrase === 'lounge', 'the race music crosses to the lounge within a beat or two');
    await page.waitForTimeout(1500);
    const gap = await page.evaluate(`(() => { clearInterval(window.__lvT); let g = 0, start = null, n = 0, where = '';
      const t0 = window.__lv[0][0];
      for (const [t, l, ph, md] of window.__lv) {
        if (l < 1e-4) { if (start === null) start = t; if (t - start > g) { g = t - start; where = md + '/' + ph + ' at ' + ((start - t0) / 1000).toFixed(1) + ' s'; } } else start = null;
        n++;
      }
      return { g, n, where }; })()`) as { g: number; n: number; where: string };
    check(gap.n > 100 && gap.g <= 800, `music continuous title → sandbox → train → drive → back: longest silence ${Math.round(gap.g)} ms over ${gap.n} samples (fades are 0.6 s)${gap.g ? `; it was in ${gap.where}` : ''}`);

    // the winner hook (matches will call it): plays once, then the mode's music again
    await page.evaluate(() => window.__audio!.win());
    await page.waitForTimeout(300);
    a = await au(page);
    check(a.phrase === 'winner' && a.winnerS > 5, `win(): the winner plays (${a.winnerS.toFixed(1)} s)`);
    await page.waitForFunction(() => window.__audio?.phrase === 'lounge', null, { timeout: a.winnerS * 1000 + 5000 }).catch(() => {});
    a = await au(page);
    check(a.phrase === 'lounge' && a.mode === 'lounge', 'after the winner, the lounge comes back');

    // 5. leaving a race stops its effects (the engines and any countdown still to come); only the music carries on
    const fx = () => page.evaluate(() => window.__audio!.liveSfx);
    await page.click('#train'); await page.click(`#gens [data-g="${GENS}"]`); await page.click('#tdGo');
    await page.waitForFunction(() => (window.__audio?.liveSfx ?? 0) > 0, null, { timeout: 60_000 }).catch(() => {});
    const busy = await fx();
    await page.click('#tvStop');
    await page.waitForFunction(() => window.__training?.state !== 'running', null, { timeout: 120_000 });
    await nodeNext(await page.evaluate(() => (window.__training!.savedOnStop ? window.__training!.gen : 0)));
    await page.click('#tvBack');
    await page.waitForTimeout(300);
    a = await au(page);
    check(busy > 0 && (await fx()) === 0 && a.playing, `leaving training: the engine was sounding (${busy}), 0.3 s later nothing is; the music plays on (${a.phrase})`);
    await page.click('#train'); await page.click(`#gens [data-g="${GENS}"]`); await page.click('#tdGo');
    await page.waitForFunction(() => window.__training?.state === 'done', null, { timeout: 300_000 });
    await nodeNext();
    await page.click('#tvDrive');
    await page.waitForFunction(() => window.__drive?.countdownSeen.includes('5') && !window.__drive.go, null, { timeout: 30_000 });
    const pending = await fx();
    await page.click('#dvBack');
    await page.waitForTimeout(300);
    const after = await fx();
    await page.waitForTimeout(7000); // past where 3, 2, 1, Go would have sounded
    a = await au(page);
    check(pending > 0 && after === 0 && (await fx()) === 0 && a.playing, `leaving mid-countdown: ${pending} effects pending, 0.3 s later ${after}, and no blip later on; the music plays on`);
    await page.click('#train'); await page.click(`#gens [data-g="${GENS}"]`); await page.click('#tdGo');
    await page.waitForFunction(() => window.__training?.state === 'done', null, { timeout: 300_000 });
    await nodeNext();
    await page.click('#tvDrive');
    await page.waitForFunction(() => window.__drive?.go === true, null, { timeout: 30_000 });
    await page.waitForTimeout(800);
    const driving = await fx();
    await page.click('#dvBack');
    await page.waitForTimeout(300);
    a = await au(page);
    check(driving > 0 && (await fx()) === 0 && a.playing, `leaving while driving: the engine (${driving}) stops within 0.3 s; the music plays on`);

    // 6. a hidden tab keeps playing (mute is the only off switch)
    // as a string: the bundler's name helper isn't defined inside the page
    await page.evaluate(`(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('blur'));
    })()`);
    await page.waitForTimeout(1000);
    a = await au(page);
    check(a.state === 'running' && a.playing, `tab hidden and unfocused → still running (${a.state}, ${a.phrase})`);

    // 7. the two toggles. Music off: its bus to 0, the effects untouched, all four pairs agree, remembered
    await page.click('#musicWb');
    // the bus eases down (time constant 50 ms on the audio clock, which a loaded headless page can run behind)
    await page.waitForFunction(() => window.__audio!.musicGain < 0.01, null, { timeout: 5000 }).catch(() => {});
    a = await au(page);
    check(!a.music && a.sfx && a.musicGain < 0.01 && a.sfxGain > 0.85 && a.master === 1 && await pressed() === 'false,true',
      `Music off: music bus ${a.musicGain.toFixed(3)}, effects bus ${a.sfxGain.toFixed(2)}, master ${a.master}; every Music toggle shows off`);
    check(await stored() === '{"music":false,"sfx":true}', `remembered (synapse.sound = ${await stored()})`);
    await page.reload();
    await page.waitForTimeout(500);
    a = await au(page);
    check(await pressed() === 'false,true' && !a.music && a.sfx, 'after a reload: music still off, effects still on');
    await page.click('#title h1');
    await page.waitForFunction(() => window.__audio?.playing === true, null, { timeout: 30_000 });
    a = await au(page);
    check(a.state === 'running' && a.musicGain === 0 && a.sfxGain > 0.85, `unlocked with music off: the music runs silent (music bus ${a.musicGain})`);
    await page.click('#toSandbox');
    let c = await countdown(page, 'music off', true);
    check(c.musicMax < 1e-4 && c.sfxMax > 1e-3, `music off: the countdown and engine still sound (effects peak ${c.sfxMax.toFixed(4)}), the music does not (peak ${c.musicMax.toExponential(1)})`);
    await page.click('#dvBack');

    // Sound effects off, music back on: no blip or engine, the music plays
    await page.click('#sfxWb');
    await page.click('#musicWb');
    await page.waitForFunction(() => window.__audio!.sfxGain < 0.01 && window.__audio!.musicGain > 0.65, null, { timeout: 5000 }).catch(() => {});
    a = await au(page);
    check(a.music && !a.sfx && a.sfxGain < 0.01 && a.musicGain > 0.65 && a.master === 1 && await pressed() === 'true,false',
      `Sound effects off: effects bus ${a.sfxGain.toFixed(3)}, music bus ${a.musicGain.toFixed(2)}; every Sound effects toggle shows off`);
    check(await stored() === '{"music":true,"sfx":false}', `remembered (synapse.sound = ${await stored()})`);
    c = await countdown(page, 'effects off', true);
    check(c.sfxMax < 1e-4 && c.musicMax > 1e-3, `effects off: no blip or engine heard (effects peak ${c.sfxMax.toExponential(1)}), the music plays (peak ${c.musicMax.toFixed(4)})`);
    await page.reload();
    await page.waitForTimeout(500);
    check(await pressed() === 'true,false', 'after a reload: music on, effects still off');

    // locked (no gesture yet): the countdown runs on the plain timer with the same spacing
    await page.goto(`${at}&view=drive`);
    await page.waitForFunction(() => window.__drive?.countdownSeen.includes('Go'), null, { timeout: 60_000 });
    await page.waitForTimeout(300);
    const ld = await page.evaluate(() => ({ music: window.__drive!.countdownMusic, seen: [...window.__drive!.countdownSeen], hash: window.__drive!.hash }));
    check((await au(page)).state === 'locked' && !ld.music && ld.seen.join(',') === '5,4,3,2,1,Go' && ld.hash === lastHash,
      `locked: the countdown runs on the plain timer (${ld.seen.join(', ')}), drive hash ${ld.hash} = Node replay ${lastHash}`);

    // the old single setting reads as both
    for (const [old, want] of [['off', 'false,false'], ['on', 'true,true']] as const) {
      await page.evaluate((v) => localStorage.setItem('synapse.sound', v), old);
      await page.goto(at);
      await page.waitForTimeout(400);
      a = await au(page);
      check(await pressed() === want && a.music === (old === 'on') && a.sfx === (old === 'on'), `the old synapse.sound = ${old} reads as both ${old}`);
    }
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
