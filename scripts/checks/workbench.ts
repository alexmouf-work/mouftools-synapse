// Workbench browser check (S2): serve the app with Vite, drive it in headless Chromium.
// Drag a wire; a backward wire is refused; the % shown equals energy.ts for the saved brain; reload keeps the
// brain; a corrupt save gives Starter and says so; 844×390 has no horizontal scroll; portrait phones get the
// "turn sideways" card; full lines (3 × 10) and an empty brain lay out without overlaps. Screenshots → out/s2/.
//   npx tsx scripts/checks/workbench.ts
import { mkdirSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { createServer } from 'vite';
import { CONFIG } from '../../src/common/config';
import {
  addLayer, addNeuron, addWire, deepSpec, draftOf, genomeHash, minimalSpec, starterSpec, zeroGenome, type Draft, type EditResult,
} from '../../src/common/sim/brain';
import { estimate, minutePercent, runsOutAt } from '../../src/common/sim/energy';
import { INPUTS, OUTPUTS } from '../../src/common/sim/spec';
import { NO_TRAINING, parse, SAVE_KEY, serialize } from '../../src/client/ui/workbench/store';
import { weightStyle } from '../../src/client/ui/weights';
import { InlineExecutor } from '../../src/common/train/episodes';
import { runPhase } from '../../src/common/train/phase';

const OUT = 'out/s2';
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const ok = (r: EditResult): Draft => { if (!r.ok) throw new Error(`refused: ${r.reason}`); return r.draft; };
let fails = 0;
const check = (cond: boolean, what: string) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (!cond) fails++; };

// ---- brains to inject ----
function threeLayer(): Draft {
  let d = draftOf(zeroGenome(starterSpec()));
  d = ok(addLayer(d)); d = ok(addNeuron(d, 2)); d = ok(addLayer(d));
  for (const [a, b] of [['n1', 'n4'], ['n3', 'n5'], ['n2', 'n4'], ['n4', 'n6'], ['n5', 'n6'], ['n6', 'o:fl'], ['n6', 'o:fr'], ['i:b', 'n6']]) d = ok(addWire(d, a, b));
  return d;
}
function full(): Draft { // 3 lines × 10, every line wired forward: the caps
  let d = draftOf(zeroGenome({ v: 1, layers: 1, nodes: [], conns: [] }));
  d = ok(addNeuron(d, 1)); d = ok(addLayer(d)); d = ok(addLayer(d));
  for (let L = 1; L <= 3; L++) while (d.genome.spec.nodes.filter((n) => n.layer === L).length < CONFIG.brain.maxPerLayer) d = ok(addNeuron(d, L));
  const by = (L: number) => d.genome.spec.nodes.filter((n) => n.layer === L).map((n) => n.id);
  for (const i of ['i:fl', 'i:f', 'i:fr']) for (const n of by(1).slice(0, 4)) d = ok(addWire(d, i, n));
  for (let k = 0; k < 10; k++) { d = ok(addWire(d, by(1)[k], by(2)[k])); d = ok(addWire(d, by(2)[k], by(3)[k])); d = ok(addWire(d, by(3)[k], OUTPUTS[k % 4].id)); }
  return d;
}
function overBudget(): Draft { // Deep plus the back eye, bias and two more tanh neurons per line, wired in
  let d = draftOf(zeroGenome(deepSpec()));
  for (const L of [1, 1, 2, 2]) { const r = addNeuron(d, L); d = ok(r); }
  for (const [a, b] of [['i:b', 'n8'], ['i:bias', 'n9'], ['i:energy', 'n8'], ['n8', 'n10'], ['n9', 'n11'], ['n10', 'o:fl'], ['n11', 'o:rr'], ['n10', 'o:fr'], ['n11', 'o:rl']]) d = ok(addWire(d, a, b));
  return d;
}
const empty = (): Draft => draftOf(zeroGenome(minimalSpec()));

// ---- page helpers ----
const pctOf = (d: Draft) => `${Math.round(minutePercent(estimate(d.genome.spec).total))}%`; // per-minute estimate
async function savedDraft(page: Page): Promise<Draft> {
  const text = await page.evaluate((k) => localStorage.getItem(k), SAVE_KEY);
  const r = parse(text);
  if (r.status !== 'ok') throw new Error(`saved brain is ${r.status}: ${r.why}`);
  return r.saved.draft;
}
const shownPct = (page: Page) => page.locator('#eVal b').innerText();
async function center(page: Page, sel: string) {
  const b = await page.locator(sel).first().boundingBox();
  if (!b) throw new Error(`no box for ${sel}`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
async function dragWire(page: Page, fromSel: string, toSel: string) {
  const a = await center(page, fromSel), b = await center(page, toSel);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up();
}
const toastText = (page: Page) => page.locator('#toast').innerText();
async function noOverlap(page: Page, what: string) {
  const r = await page.evaluate(() => {
    const svg = document.getElementById('net')!.getBoundingClientRect();
    const cs = [...document.querySelectorAll<SVGCircleElement>('#net circle[data-pick]')].map((c) => c.getBoundingClientRect());
    let overlaps = 0, outside = 0;
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i];
      if (a.top < svg.top || a.bottom > svg.bottom || a.left < svg.left || a.right > svg.right) outside++;
      for (let j = i + 1; j < cs.length; j++) {
        const b = cs[j];
        if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) overlaps++;
      }
    }
    return { n: cs.length, overlaps, outside };
  });
  check(r.overlaps === 0 && r.outside === 0, `${what}: ${r.n} neurons, none overlapping or off the board (${r.overlaps} overlaps, ${r.outside} outside)`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
  await server.listen();
  const addr = server.httpServer?.address();
  if (!addr || typeof addr === 'string') throw new Error('no server address');
  const url = `http://127.0.0.1:${addr.port}/`;
  let browser: Browser;
  try { browser = await chromium.launch(); } catch { browser = await chromium.launch({ executablePath: CHROMIUM }); }
  const errors: string[] = [];
  async function open(o: { w: number; h: number; dark?: boolean; save?: Draft | string; mobile?: boolean }): Promise<Page> {
    const ctx = await browser.newContext({ viewport: { width: o.w, height: o.h }, colorScheme: o.dark ? 'dark' : 'light', hasTouch: o.mobile, isMobile: o.mobile, deviceScaleFactor: o.mobile ? 2 : 1 });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(url);
    if (o.save !== undefined) {
      const text = typeof o.save === 'string' ? o.save : serialize({ name: 'Untitled brain', draft: o.save, train: NO_TRAINING });
      await page.evaluate(([k, v]) => localStorage.setItem(k, v), [SAVE_KEY, text]);
      await page.reload();
    }
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400); // pop animation settles
    return page;
  }
  try {
    // fresh start, desktop light
    let page = await open({ w: 1440, h: 900 });
    const starter = draftOf(zeroGenome(starterSpec()));
    check(await shownPct(page) === pctOf(starter), `fresh start shows Starter at ${pctOf(starter)} (energy.ts) — shown ${await shownPct(page)}`);
    await page.screenshot({ path: `${OUT}/desktop-light.png` });

    // drag a wire: back eye → n1
    await dragWire(page, '[data-id="i:b"] [data-wire]', '[data-id="n1"] [data-pick]');
    let d = await savedDraft(page);
    const k = d.genome.spec.conns.findIndex((c) => c.from === 'i:b' && c.to === 'n1');
    check(k >= 0 && d.genome.w[k] === 0, 'drag back eye → n1 adds one wire at weight 0, saved');
    check((await toastText(page)).includes('Back now in use'), `toast: "${await toastText(page)}"`);
    check(await shownPct(page) === pctOf(d), `% shown ${await shownPct(page)} = energy.ts ${pctOf(d)} after the wire`);

    // backward wires are refused
    const before = genomeHash(d.genome);
    await dragWire(page, '[data-id="n1"] [data-wire]', '[data-id="i:f"]');
    check(genomeHash((await savedDraft(page)).genome) === before, 'neuron → car wire refused (brain unchanged)');
    check((await toastText(page)) === 'The car only sends signals.', `toast: "${await toastText(page)}"`);
    await page.click('#addL');
    d = await savedDraft(page);
    const n4 = d.genome.spec.nodes.find((n) => n.layer === 2)!.id;
    const before2 = genomeHash(d.genome);
    await dragWire(page, `[data-id="${n4}"] [data-wire]`, '[data-id="n1"] [data-pick]');
    check(genomeHash((await savedDraft(page)).genome) === before2, 'layer 2 → layer 1 wire refused (brain unchanged)');
    check((await toastText(page)) === 'Signals run left to right, to a later layer.', `toast: "${await toastText(page)}"`);
    check(await shownPct(page) === pctOf(d), `% shown ${await shownPct(page)} = energy.ts ${pctOf(d)} after + Layer (wheel wires now span 2)`);

    // a transfer-function change and a cut wire also track energy.ts
    await page.click(`[data-id="n2"] [data-pick]`);
    await page.click('#fx-sigmoid');
    d = await savedDraft(page);
    check(d.genome.spec.nodes.find((n) => n.id === 'n2')?.act === 'sigmoid', 'set sigmoid on n2 from the side panel');
    // click the wire on its stroke, at a point along it where no other wire lies on top
    const mid = await page.evaluate(() => {
      const p = document.querySelector<SVGPathElement>('#net path[data-hit][data-from="i:f"][data-to="n1"]')!;
      const m = p.getScreenCTM()!, len = p.getTotalLength();
      for (let f = 0.5; f < 0.95; f += 0.05) {
        for (const g of [f, 1 - f]) {
          const q = p.getPointAtLength(len * g);
          const x = q.x * m.a + q.y * m.c + m.e, y = q.x * m.b + q.y * m.d + m.f;
          if (document.elementFromPoint(x, y) === p) return { x, y };
        }
      }
      throw new Error('wire i:f → n1 is covered along its whole length');
    });
    await page.mouse.click(mid.x, mid.y);
    d = await savedDraft(page);
    check(!d.genome.spec.conns.some((c) => c.from === 'i:f' && c.to === 'n1'), 'clicking wire i:f → n1 cuts it');
    check(await shownPct(page) === pctOf(d), `% shown ${await shownPct(page)} = energy.ts ${pctOf(d)}`);

    // reload keeps the brain
    const h = genomeHash(d.genome);
    await page.reload(); await page.waitForTimeout(300);
    check(genomeHash((await savedDraft(page)).genome) === h && await shownPct(page) === pctOf(d), 'reload keeps the brain and its %');
    await page.context().close();

    // dark
    page = await open({ w: 1440, h: 900, dark: true });
    await page.screenshot({ path: `${OUT}/desktop-dark.png` });
    await page.context().close();

    // landscape phone: no horizontal scroll, no rotate card
    page = await open({ w: 844, h: 390, mobile: true });
    let m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, rot: getComputedStyle(document.getElementById('rotate')!).display }));
    check(m.sw <= m.cw && m.rot === 'none', `844×390: scrollWidth ${m.sw} ≤ ${m.cw}, rotate card hidden`);
    await page.screenshot({ path: `${OUT}/phone-landscape-844x390.png` });
    await page.context().close();

    // portrait phone: the turn-sideways card, and "Continue in portrait" dismisses it
    page = await open({ w: 390, h: 844, mobile: true });
    m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, rot: getComputedStyle(document.getElementById('rotate')!).display }));
    check(m.rot !== 'none', '390×844 portrait shows "Turn your phone sideways"');
    await page.screenshot({ path: `${OUT}/phone-portrait-390x844.png` });
    await page.click('#stay');
    check(await page.evaluate(() => getComputedStyle(document.getElementById('rotate')!).display) === 'none', '"Continue in portrait" dismisses the card');
    await page.context().close();

    // 3-layer brain, desktop and landscape phone
    const three = threeLayer();
    page = await open({ w: 1440, h: 900, save: three });
    check(await shownPct(page) === pctOf(three), `3-layer brain: % shown ${await shownPct(page)} = energy.ts ${pctOf(three)}`);
    check(await page.locator('#addL').isDisabled(), '3 layers: + Layer disabled');
    await noOverlap(page, '3-layer brain, desktop');
    await page.screenshot({ path: `${OUT}/three-layers.png` });
    await page.context().close();
    page = await open({ w: 844, h: 390, mobile: true, save: three });
    await noOverlap(page, '3-layer brain, 844×390');
    await page.screenshot({ path: `${OUT}/three-layers-844x390.png` });
    await page.context().close();

    // over budget: red meter with the noise figure
    const over = overBudget();
    page = await open({ w: 1440, h: 900, save: over });
    const ev = await page.locator('#eVal').innerText();
    const out = runsOutAt(estimate(over.genome.spec).total);
    const outTxt = `${Math.floor(out / 60)}:${String(Math.floor(out % 60)).padStart(2, '0')}`;
    check(await shownPct(page) === pctOf(over) && ev.includes(`runs out at ${outTxt}`) && /est\. per minute/.test(ev) && await page.locator('#meter.over').count() === 1,
      `over budget: "${ev}" (energy.ts ${pctOf(over)}, pool spent at ${outTxt})`);
    await page.screenshot({ path: `${OUT}/over-budget.png` });
    await page.context().close();

    // the caps: 3 lines × 10
    const caps = full();
    for (const [w, hgt, mobile, name] of [[1440, 900, false, 'caps-3x10.png'], [844, 390, true, 'caps-3x10-844x390.png']] as const) {
      page = await open({ w, h: hgt, mobile, save: caps });
      await noOverlap(page, `3 × 10 at ${w}×${hgt}`);
      const sw = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
      check(sw, `3 × 10 at ${w}×${hgt}: no horizontal scroll`);
      await page.screenshot({ path: `${OUT}/${name}` });
      await page.context().close();
    }

    // empty: no hidden neurons, car wired straight to the wheels
    const e = empty();
    page = await open({ w: 1440, h: 900, save: e });
    const wires = await page.locator('#net path[data-hit]').count();
    check(wires === 16 && await shownPct(page) === pctOf(e), `empty brain (Minimal): ${wires} car → wheel wires drawn, % ${await shownPct(page)} = ${pctOf(e)}`);
    await page.screenshot({ path: `${OUT}/empty-minimal.png` });
    await page.context().close();

    // corrupt save → Starter + a toast saying so
    page = await open({ w: 1440, h: 900, save: '{"v":1,"name":"x","genome":' });
    check(genomeHash((await savedDraft(page)).genome) === genomeHash(starter.genome), 'corrupt save → Starter (and the Starter is saved over it)');
    check((await toastText(page)).includes('couldn’t be read'), `toast: "${await toastText(page)}"`);
    await page.context().close();

    // weights as colours (principal, 2026-10-31): a trained brain, light and dark
    mkdirSync('out/s6', { recursive: true });
    const trained = draftOf((await runPhase(new InlineExecutor(), starterSpec(), 7, { T: 300_000 })).final);
    for (const dark of [false, true]) {
      page = await open({ w: 1440, h: 900, dark, save: trained });
      const wires = await page.evaluate(() => [...document.querySelectorAll<SVGPathElement>('#net path.wire')].map((p) => ({
        stroke: getComputedStyle(p).stroke, width: Number(p.getAttribute('stroke-width')) }))); // document order = wire order
      const hits = await page.evaluate(() => [...document.querySelectorAll<SVGPathElement>('#net path[data-hit]')].map((p) => Number(p.dataset.w)));
      const ok = wires.length === hits.length && wires.every((wi, k) => { const st = weightStyle(hits[k]); return wi.stroke.replace(/\s/g, '') === st.css && Math.abs(wi.width - st.width) < 1e-9; });
      check(ok, `${dark ? 'dark' : 'light'}: every wire coloured and sized by its weight (${wires.length} wires, red −1 · black 0 · green +1)`);
      await page.screenshot({ path: `out/s6/workbench-trained${dark ? '-dark' : ''}.png` });
      await page.context().close();
    }
    page = await open({ w: 1440, h: 900, dark: true });
    const halo = await page.evaluate(() => getComputedStyle(document.querySelector('#net path.wire')!.previousElementSibling!).stroke);
    check(halo !== 'none' && !/rgba\(\d+, \d+, \d+, 0\)/.test(halo) && halo !== 'transparent', `dark: a zero-weight wire keeps a visible neutral halo (${halo})`);
    await page.context().close();

    check(errors.length === 0, `console clean${errors.length ? ': ' + errors.join(' | ') : ''}`);
    check(INPUTS.length === 10 && OUTPUTS.length === 4, 'pins: 10 inputs, 4 wheels');
  } finally {
    await browser.close();
    await server.close();
  }
  if (fails) { console.error(`workbench: ${fails} check(s) failed`); process.exit(1); }
  console.log(`workbench: all checks passed; screenshots in ${OUT}/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
