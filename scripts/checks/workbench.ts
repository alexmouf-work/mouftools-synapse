// Designer browser check (brain v2, B3): serve the app with Vite, drive the designer in headless Chromium.
// - The starting brain, the energy split (resting–flat out) as energy.ts computes it, the Learning Rule strip and the
//   trainer picker (actor-critic and A_RP not built yet), the legal line and the sound button.
// - Tap a sense in the tray to add a cell (it is selected: graph, one-line description, "At maximum firing rate"
//   energy from energy.ts, bin); the bin removes it. A full sense dims and loses its "+". A trained neuron or wheel
//   shows its built-in bias; an untrained one doesn't.
// - A layer header opens the layer panel: functions, the Neurons slider (live), the layer's energy line, bin.
// - "+"/"−" add and remove neurons and layers; at 8 neurons and 8 layers the "+"s go.
// - Reset asks first; Train asks how many generations (100 by default) and Cancel leaves the brain alone.
// - Saved after every change; reload keeps it; a corrupt save gives the starting brain and says so; a save from before
//   brain v2 is reset with a note.
// - Overlap audit across brain sizes up to 8 × 8 (and every sense full), light and dark, desktop and 844×390: no cell,
//   button or layer header overlaps another, all on the board; no horizontal scroll. Portrait phones get the card.
// Screenshots → out/s2/.
//   npx tsx scripts/checks/workbench.ts
import { mkdirSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer } from 'vite';
import { CONFIG } from '../../src/common/config';
import { defaultGenome, genomeHash, restRate, zeroGenome } from '../../src/common/sim/brain';
import { layerMax, maxLoad, restLoad, senseMax, speedCap } from '../../src/common/sim/energy';
import { biasIndex, type BrainSpec, type Genome } from '../../src/common/sim/spec';
import { parse, SAVE_KEY } from '../../src/client/ui/designer/store';

const OUT = 'out/s2';
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
let fails = 0;
const check = (cond: boolean, what: string) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (!cond) fails++; };

const fmtE = (v: number) => `${Math.round(v * 10) / 10}%`;
function allocText(s: BrainSpec): { brain: string; speed: string } {
  const top = maxLoad(s), lo = restLoad(s, restRate), f = (v: number) => Math.round(Math.max(0, v)), sp = (l: number) => Math.round(speedCap(l) * 100);
  return { brain: f(lo) === f(top) ? `${f(lo)}%` : `${f(lo)}–${f(top)}%`, speed: sp(top) === sp(lo) ? `${sp(lo)}%` : `${sp(top)}–${sp(lo)}%` };
}
const sizes: [string, BrainSpec][] = [
  ['default', defaultGenome().spec],
  ['3 layers × 4, three senses', { v: 2, senses: { boundary: 3, landmark: 1, hd: 2, grid: 0, speed: 1 }, layers: [{ n: 4, fn: 'relu' }, { n: 4, fn: 'tanh' }, { n: 4, fn: 'sigmoid' }] }],
  ['8 × 8, every sense full', { v: 2, senses: { boundary: 7, landmark: 5, hd: 8, grid: 6, speed: 1 }, layers: Array.from({ length: 8 }, (_, L) => ({ n: 8, fn: (['linear', 'relu', 'sigmoid', 'tanh'] as const)[L % 4] })) }],
  ['8 layers × 1', { v: 2, senses: { boundary: 1, landmark: 0, hd: 0, grid: 0, speed: 0 }, layers: Array.from({ length: 8 }, () => ({ n: 1, fn: 'tanh' as const })) }],
  ['1 × 8, no senses', { v: 2, senses: { boundary: 0, landmark: 0, hd: 0, grid: 0, speed: 0 }, layers: [{ n: 8, fn: 'linear' }] }],
];

async function saved(page: Page) {
  const r = parse(await page.evaluate((k) => localStorage.getItem(k), SAVE_KEY));
  if (r.status === 'corrupt') throw new Error(`saved brain corrupt: ${r.why}`);
  return r.saved;
}
const toastText = (page: Page) => page.locator('#toast').innerText();

/** Every visible cell, "+"/"−" and layer header on the board: no two overlap, none off the board. */
async function noOverlap(page: Page, what: string) {
  const r = await page.evaluate(() => {
    const board = document.getElementById('board')!.getBoundingClientRect();
    const boxes: { kind: string; r: DOMRect }[] = [];
    document.querySelectorAll('#net g.cell').forEach((g) => boxes.push({ kind: 'cell', r: (g.firstElementChild as Element).getBoundingClientRect() }));
    document.querySelectorAll('#net g.btnc').forEach((g) => boxes.push({ kind: 'button', r: (g.firstElementChild as Element).getBoundingClientRect() }));
    document.querySelectorAll('#net g[data-layer]').forEach((g) => boxes.push({ kind: 'header', r: (g.firstElementChild as Element).getBoundingClientRect() }));
    let overlaps = 0, outside = 0;
    const bad: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      const a = boxes[i].r;
      if (a.left < board.left - 0.5 || a.right > board.right + 0.5 || a.top < board.top - 0.5 || a.bottom > board.bottom + 0.5) outside++;
      for (let j = i + 1; j < boxes.length; j++) {
        const b = boxes[j].r;
        if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) { overlaps++; if (bad.length < 3) bad.push(`${boxes[i].kind}/${boxes[j].kind}`); }
      }
    }
    return { n: boxes.length, overlaps, outside, bad, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
  });
  check(r.overlaps === 0 && r.outside === 0 && r.sw <= r.cw, `${what}: ${r.n} cells, buttons and headers, none overlapping or off the board, no sideways scroll (${r.overlaps} overlaps${r.bad.length ? ': ' + r.bad.join(', ') : ''}, ${r.outside} outside)`);
}

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
  async function open(o: { w: number; h: number; dark?: boolean; save?: string; mobile?: boolean }): Promise<Page> {
    const ctx = await browser.newContext({ viewport: { width: o.w, height: o.h }, colorScheme: o.dark ? 'dark' : 'light', isMobile: o.mobile, hasTouch: o.mobile });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(base);
    await page.evaluate(([k, v]) => { localStorage.setItem('synapse.notice', '2'); if (v !== null) localStorage.setItem(k, v); }, [SAVE_KEY, o.save ?? null] as const);
    await page.goto(base);
    await page.waitForSelector('#net g.cell');
    return page;
  }
  const spec = (page: Page) => page.evaluate(() => window.__designer!.spec());

  try {
    // 1. the starting brain
    let page = await open({ w: 1440, h: 900 });
    let s = await spec(page);
    check(genomeHash(zeroGenome(s)) === genomeHash(defaultGenome()), 'a fresh start is the starting brain (1 boundary + 1 head direction → 3 tanh → wheels)');
    check(await page.locator('#net g.cell').count() === 2 + 3 + 4, '9 cells on the board');
    const al = allocText(s);
    check(await page.locator('#aBrain').innerText() === al.brain && await page.locator('#aSpeed').innerText() === al.speed, `energy split: brain ${al.brain}, speed ${al.speed} (resting–flat out, energy.ts)`);
    check(await page.locator('#eq').innerText() === 'Learning Rule : w′ = w + σ·ε', `Learning Rule strip: "${await page.locator('#eq').innerText()}"`);
    const trs = await page.locator('#trainers button').evaluateAll((bs) => bs.map((b) => [b.textContent, (b as HTMLButtonElement).disabled, b.getAttribute('aria-pressed')]));
    check(JSON.stringify(trs) === JSON.stringify([['Evolution', false, 'true'], ['Backprop', false, 'false'], ['Actor-critic', true, 'false'], ['ARP', true, 'false']]), `trainer picker: ${JSON.stringify(trs)}`);
    check(await page.locator('.legal-links a').count() === 3 && /DM DOKURO, Kevin MacLeod/.test(await page.locator('.legal-links').innerText()), 'legal links and music credits on the page');
    check(await page.locator('#soundWb').getAttribute('aria-label') === 'Sound', 'the sound button is in the top bar');
    check(await page.locator('#drive').count() === 0, 'no Drive button on the designer (drive comes after training)');
    await page.screenshot({ path: `${OUT}/designer.png` });

    // 2. trainer picker → the rule strip follows
    await page.click('#trainers [data-tr="backprop"]');
    check(await page.locator('#eq').innerText() === 'Learning Rule : Δw = η·δ·x' && (await saved(page)).trainer === 'backprop', 'Backprop picked: the strip shows Δw = η·δ·x, and it is saved');
    await page.click('#trainers [data-tr="evolution"]');

    // 3. tray: add a boundary cell → selected, graph, description, energy; the bin removes it
    await page.click('#tray [data-s="boundary"]');
    s = await spec(page);
    check(s.senses.boundary === 2 && (await saved(page)).genome.spec.senses.boundary === 2, 'tap the boundary tile: a second boundary vector cell, saved');
    check(await page.locator('#insp #graph').count() === 1 && (await page.locator('#insp .desc').innerText()) === 'Fires faster when approaching a wall.', 'the new cell is selected: its graph and one-line description');
    check((await page.locator('#insp .use b').innerText()) === fmtE(senseMax(s, 'boundary')), `"At maximum firing rate, uses ${fmtE(senseMax(s, 'boundary'))} energy" (energy.ts)`);
    await page.click('#insp .bin');
    check((await spec(page)).senses.boundary === 1, 'the bin removes the cell');
    for (let k = 0; k < 2; k++) await page.click('#tray [data-s="speed"]', { force: true });
    check((await spec(page)).senses.speed === 1 && await page.locator('#tray [data-s="speed"]').isDisabled() && await page.locator('#tray [data-s="speed"] .plus').count() === 0, 'speed cells: one at most; the full tile dims and loses its "+"');

    // 3b. a neuron's built-in bias: shown once trained (with the curve against Σ w·x), not before
    await page.evaluate(() => window.__designer!.select('h0:0'));
    check(await page.locator('#insp [data-bias]').count() === 0, 'untrained: no bias line in the neuron panel');
    const tg = defaultGenome(), trainedG = { ...tg, w: tg.w.map((_, k) => (k % 2 ? 0.25 : -0.5)) };
    await page.evaluate((g) => { window.__designer!.load(g); window.__designer!.select('h0:0'); }, trainedG);
    const bi = biasIndex(trainedG.spec, 'h0:0'), want = trainedG.w[bi];
    check((await page.locator('#insp [data-bias] b').innerText()) === `${want >= 0 ? '+' : '−'}${Math.abs(want).toFixed(2)}`, `trained: "Bias ${await page.locator('#insp [data-bias] b').innerText()}" from the genome`);
    await page.evaluate(() => window.__designer!.select('o:fr'));
    check(await page.locator('#insp [data-bias]').count() === 1, 'wheels show their bias too');
    await page.evaluate((g) => window.__designer!.load(g), defaultGenome());

    // 4. layer panel: function, the Neurons slider (live), energy line
    await page.click('#net g[data-layer="0"]');
    await page.click('#insp [data-fx="relu"]');
    check((await spec(page)).layers[0].fn === 'relu', 'layer panel: ReLU set for layer 1');
    await page.locator('#nSlide').fill('6');
    s = await spec(page);
    check(s.layers[0].n === 6 && await page.locator('#net g.cell[data-id^="h0:"]').count() === 6, 'the Neurons slider resizes the layer live (6 neurons on the board)');
    check((await page.locator('#lUse b').innerText()) === fmtE(layerMax(s, 0)), `layer energy line: ${fmtE(layerMax(s, 0))} (energy.ts)`);

    // 5. "+"/"−" for neurons and layers, and the limits
    await page.click('#net g[data-add-n="0"]'); await page.click('#net g[data-add-n="0"]');
    check((await spec(page)).layers[0].n === 8 && await page.locator('#net g[data-add-n="0"]').count() === 0, 'a "+" under the layer adds neurons; at 8 it goes');
    await page.click('#net g[data-rm-n="0"]');
    check((await spec(page)).layers[0].n === 7, 'the "−" above the layer removes one');
    await page.click('#net g[data-add-l="1"]');
    s = await spec(page);
    check(s.layers.length === 2 && s.layers[1].n === CONFIG.brain.newLayerNeurons && s.layers[1].fn === 'tanh', 'a "+" on a column boundary inserts a layer of two tanh neurons there');
    await page.click('#net g[data-rm-l="1"]');
    check((await spec(page)).layers.length === 1, 'the "−" at the foot of a column removes the layer');
    while ((await spec(page)).layers.length < 8) await page.click('#net g[data-add-l="1"]');
    check(await page.locator('#net g[data-add-l]').count() === 0, 'at 8 layers the boundary "+"s go');
    check((await saved(page)).genome.w.every((w) => w === 0), 'every edit leaves an untrained brain (grey wires, weights 0)');

    // 6. Reset asks first
    await page.click('#reset');
    await page.click('#cfNo');
    check((await spec(page)).layers.length === 8, 'Reset → Cancel keeps the brain');
    await page.click('#reset');
    await page.click('#cfYes');
    check(genomeHash((await saved(page)).genome) === genomeHash(defaultGenome()), 'Reset → Reset goes back to the starting brain');

    // 7. Train asks how many generations
    await page.click('#train');
    const gens = await page.locator('#gens button').evaluateAll((bs) => bs.map((b) => [Number(b.textContent), b.getAttribute('aria-pressed')]));
    check(JSON.stringify(gens.map((g) => g[0])) === JSON.stringify(CONFIG.train.generations) && gens.find((g) => g[1] === 'true')?.[0] === 100, `Train asks: ${gens.map((g) => g[0]).join(', ')} generations (100 picked)`);
    await page.screenshot({ path: `${OUT}/train-dialog.png` });
    await page.click('#tdNo');
    check(!(await page.locator('#trainDlg').isVisible()) && !(await page.locator('#arena').isVisible()), 'Cancel closes it without training');

    // 8. reload keeps the brain
    await page.click('#tray [data-s="grid"]');
    const h = genomeHash((await saved(page)).genome);
    await page.reload();
    await page.waitForSelector('#net g.cell');
    check(genomeHash((await saved(page)).genome) === h && (await spec(page)).senses.grid === 1, 'reload keeps the brain');
    await page.context().close();

    // 9. a corrupt save, and a save from before brain v2
    page = await open({ w: 1440, h: 900, save: '{"v":3,' });
    check(genomeHash((await saved(page)).genome) === genomeHash(defaultGenome()) && (await toastText(page)).includes('couldn’t be read'), `corrupt save → the starting brain, toast "${await toastText(page)}"`);
    await page.context().close();
    const v1: Genome = { spec: { v: 1, layers: 1, nodes: [], conns: [] } as unknown as BrainSpec, w: [] };
    page = await open({ w: 1440, h: 900, save: JSON.stringify({ v: 2, name: 'Old', nextId: 1, train: { seed: 3, phases: 2 }, genome: v1 }) });
    check(genomeHash((await saved(page)).genome) === genomeHash(defaultGenome()) && (await toastText(page)).includes('changed how brains work'), `a save from before brain v2 is reset, with a note: "${await toastText(page)}"`);
    await page.reload();
    await page.waitForSelector('#net g.cell');
    check((await page.locator('#toast').isHidden()), 'the note shows once');
    await page.context().close();

    // 10. overlap audit: brain sizes, light and dark, desktop and landscape phone
    for (const [w, hgt, dark, mobile] of [[1440, 900, false, false], [1440, 900, true, false], [844, 390, false, true], [844, 390, true, true]] as const) {
      page = await open({ w, h: hgt, dark, mobile });
      for (const [name, sp] of sizes) {
        await page.evaluate((g) => window.__designer!.load(g), zeroGenome(sp));
        await page.waitForTimeout(60);
        await noOverlap(page, `${name} at ${w}×${hgt}${dark ? ' dark' : ''}`);
        if (name.startsWith('8 × 8')) await page.screenshot({ path: `${OUT}/8x8-${w}${dark ? '-dark' : ''}.png` });
      }
      const fit = await page.evaluate(() => { const a = document.querySelector('.app')!.getBoundingClientRect(); return a.right <= innerWidth + 0.5 && a.bottom <= innerHeight + 0.5 && a.left >= -0.5 && a.top >= -0.5; });
      check(fit, `${w}×${hgt}${dark ? ' dark' : ''}: the 860 × 400 layout scaled to fit the screen`);
      await page.context().close();
    }

    // 11. portrait phones get the card
    page = await open({ w: 390, h: 844, mobile: true });
    check(await page.evaluate(() => getComputedStyle(document.getElementById('rotate')!).display) !== 'none', '390×844 portrait shows "Turn your phone sideways"');
    await page.click('#stay');
    check(await page.evaluate(() => getComputedStyle(document.getElementById('rotate')!).display) === 'none', '"Continue in portrait" dismisses the card');
    await page.context().close();

    check(errors.length === 0, `console clean${errors.length ? ': ' + errors.join(' | ') : ''}`);
  } finally {
    await browser.close();
    await server.close();
  }
  if (fails) { console.error(`workbench: ${fails} check(s) failed`); process.exit(1); }
  console.log(`workbench: all checks passed; screenshots in ${OUT}/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
