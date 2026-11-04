// Headless benchmark (S1). For each seed: train the default brain (v2) for one phase (T car-ticks) on worker_threads,
// again on 1 worker (hash must match), train Minimal (one boundary cell, one linear neuron), then race the gen-1 / mid / final champions
// for 30 s on the seed's unseen track. Writes out/bench/{report.md,report.json,fitness.csv,seed-NN.svg} and prints
// the pass criterion (solo-loop plan step 1: a, b, c, d, f; e is the browser time, see /bench). --trainer picks the
// trainer (evolution by default); a gradient trainer's "generations" are its fitness checks (gen 1 = its starting
// weights), and the report adds the c-style gate for trainers (end ≥ 1.5× start on ≥ 15/20) and the teacher's own laps.
//   npx tsx scripts/sim/bench.ts [--seeds 1-20] [--workers 4] [--no-compare] [--T 3000000] [--trainer backprop]
import { mkdirSync, writeFileSync } from 'node:fs';
import { availableParallelism, cpus } from 'node:os';
import { CONFIG } from '../../src/common/config';
import { compile, genomeHash } from '../../src/common/sim/brain';
import { defaultSpec, type BrainSpec as Spec } from '../../src/common/sim/spec';
import { newRecording, Runner } from '../../src/common/sim/race';
import type { BrainSpec } from '../../src/common/sim/spec';
import { generateTrack, type Track } from '../../src/common/sim/track';
import { driveTeacher } from '../../src/common/sim/teacher';
import { phaseSeeds, runPhase, type PhaseResult } from '../../src/common/train/phase';
import { NodePool } from './nodePool';
import { trackSvg } from './svg';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const flag = (name: string) => process.argv.includes(`--${name}`);
const [s0, s1] = arg('seeds', '1-20').split('-').map(Number);
const seeds = Array.from({ length: (s1 ?? s0) - s0 + 1 }, (_, i) => s0 + i);
const workers = Number(arg('workers', '4'));
const T = Number(arg('T', String(CONFIG.train.T)));
const compare = !flag('no-compare');
const trainer = arg('trainer', 'evolution');
const outDir = arg('out', trainer === 'evolution' ? 'out/bench' : `out/bench-${trainer}`);

interface Raced { prog: number; wallTicks: number; x: Float64Array; y: Float64Array; ticks: number }
/** A look at the unseen track: a 1-minute run with the full pool (as trained and as the drive), cut at `ticks`. */
function race(spec: BrainSpec, w: ArrayLike<number>, t: Track, ticks: number = CONFIG.race.ticks): Raced {
  const net = compile({ spec, w: Array.from(w) });
  const rec = newRecording(net, ticks);
  const r = new Runner().run(net, t, { ticks, earlyStop: false, record: rec });
  return { prog: r.prog, wallTicks: r.wallTicks, x: rec.x, y: rec.y, ticks: rec.ticks };
}
/** (d)'s cheap design in brain v2: one boundary vector cell and one linear neuron (there are no presets any more). */
const minimalSpec = (): Spec => ({ v: 2, senses: { boundary: 1, landmark: 0, hd: 0, grid: 0, speed: 0 }, layers: [{ n: 1, fn: 'linear' }] });
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

interface Row {
  seed: number; lap: number; gens: number; ticks: number; trainMs: number; trainMs1?: number;
  fit1: number; fitEnd: number; prog1: number; progMid: number; progEnd: number; wallsEnd: number;
  minimalProg: number; minimalGens: number; hash: string; hash1?: string; hashRepeat?: string; champion: string;
  prog1_60: number; progEnd60: number; minimal60: number; teacher30: number;
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const pool = new NodePool(workers);
  const pool1 = compare ? new NodePool(1) : null;
  const now = () => performance.now();
  const rows: Row[] = [];
  const csv = ['seed,gen,best,mean,ticksUsed'];
  const t0 = now();
  for (const seed of seeds) {
    const ps = phaseSeeds(seed);
    const unseen = generateTrack(ps.unseenTrack);
    const st: PhaseResult = await runPhase(pool, defaultSpec(), seed, { T, now, trainer });
    const st1 = pool1 ? await runPhase(pool1, defaultSpec(), seed, { T, now, trainer }) : null;
    const mn = await runPhase(pool, minimalSpec(), seed, { T, now, trainer });
    const G = st.gens.length;
    const g1 = st.gens[0], gm = st.gens[Math.floor((G - 1) / 2)], ge = st.gens[G - 1];
    const r1 = race(st.spec, g1.champion, unseen);
    const rm = race(st.spec, gm.champion, unseen);
    const re = race(st.spec, ge.champion, unseen);
    const rmin = race(mn.spec, mn.final.w, unseen);
    // the drive-length look (60 s), for comparison with the 30 s criterion
    const D = CONFIG.drive.ticks;
    const r1d = race(st.spec, g1.champion, unseen, D), red = race(st.spec, ge.champion, unseen, D), rmind = race(mn.spec, mn.final.w, unseen, D);
    for (const g of st.gens) csv.push(`${seed},${g.gen},${g.best.toFixed(3)},${g.mean.toFixed(3)},${g.ticksUsed}`);
    const pct = (p: number) => `${(100 * p / unseen.len).toFixed(0)}% lap`;
    writeFileSync(`${outDir}/seed-${String(seed).padStart(2, '0')}.svg`, trackSvg(unseen, [
      { label: `gen 1`, color: '#d9465b', ...r1, note: `${r1.prog.toFixed(0)} m (${pct(r1.prog)}), ${r1.wallTicks} wall ticks` },
      { label: `gen ${gm.gen}`, color: '#e09a1a', ...rm, note: `${rm.prog.toFixed(0)} m (${pct(rm.prog)}), ${rm.wallTicks} wall ticks` },
      { label: `gen ${ge.gen} (final)`, color: '#2f6fde', ...re, note: `${re.prog.toFixed(0)} m (${pct(re.prog)}), ${re.wallTicks} wall ticks` },
    ], `Seed ${seed} · unseen track ${unseen.len.toFixed(0)} m · default-brain champions, 30 s`));
    const row: Row = {
      seed, lap: unseen.len, gens: G, ticks: st.ticksUsed, trainMs: st.trainMs, trainMs1: st1?.trainMs,
      fit1: g1.best, fitEnd: ge.best, prog1: r1.prog, progMid: rm.prog, progEnd: re.prog, wallsEnd: re.wallTicks,
      minimalProg: rmin.prog, minimalGens: mn.gens.length, hash: st.hash, hash1: st1?.hash, champion: genomeHash(st.final),
      prog1_60: r1d.prog, progEnd60: red.prog, minimal60: rmind.prog, teacher30: driveTeacher(unseen, CONFIG.race.ticks).prog,
    };
    rows.push(row);
    console.log(`seed ${seed}: gens ${G}, fit ${row.fit1.toFixed(0)}→${row.fitEnd.toFixed(0)}, unseen ${row.prog1.toFixed(0)}/${row.progMid.toFixed(0)}/${row.progEnd.toFixed(0)} of ${row.lap.toFixed(0)} m, minimal ${row.minimalProg.toFixed(0)} m, ${(row.trainMs / 1000).toFixed(2)} s (${workers}w)${st1 ? `, ${(st1.trainMs / 1000).toFixed(2)} s (1w), hash ${st.hash} ${st.hash === st1.hash ? '=' : '≠'} ${st1.hash}` : ''}`);
  }
  // same seed twice → same hash (on the first seed, fresh pool)
  const again = await runPhase(pool, defaultSpec(), seeds[0], { T, now, trainer });
  rows[0].hashRepeat = again.hash;
  await pool.close();
  if (pool1) await pool1.close();

  const n = rows.length;
  const a = { medianEnd: median(rows.map((r) => r.progEnd)), median1: median(rows.map((r) => r.prog1)) };
  const crit = {
    // a ratio means nothing when gen 1 went nowhere or backwards (≤ 0 m): then (a) fails rather than passing on a sign
    a: { ...a, ratio: a.medianEnd / a.median1, pass: a.median1 > 0 && a.medianEnd >= 3 * a.median1 },
    b: { count: rows.filter((r) => r.progEnd >= 0.8 * r.lap).length, need: 15, pass: false },
    c: { count: rows.filter((r) => r.fitEnd >= 2 * r.fit1).length, need: n, pass: false },
    /** The trainers' gate (brief 2026-11-04): end ≥ 1.5× start on ≥ 15/20 — and, since a gradient trainer starts from one
     *  random brain (fitness ≈ 0, so any ratio is easy), how many end at ≥ 500 m of training fitness. */
    gate: { count: rows.filter((r) => r.fitEnd >= 1.5 * r.fit1 && r.fitEnd > r.fit1).length, need: 15, over500: rows.filter((r) => r.fitEnd >= 500).length, pass: false },
    d: { count: rows.filter((r) => r.minimalProg >= 0.5 * r.lap).length, need: 15, pass: false },
    f: {
      repeat: rows[0].hashRepeat === rows[0].hash,
      workers: compare ? rows.every((r) => r.hash === r.hash1) : null,
      pass: false,
    },
  };
  const drive60 = {
    ratio: median(rows.map((r) => r.progEnd60)) / median(rows.map((r) => r.prog1_60)),
    laps: rows.filter((r) => r.progEnd60 >= 1.6 * r.lap).length,
    minimal: rows.filter((r) => r.minimal60 >= r.lap).length,
  };
  crit.b.pass = crit.b.count >= crit.b.need;
  crit.c.pass = crit.c.count >= crit.c.need;
  crit.gate.pass = crit.gate.count >= crit.gate.need;
  crit.d.pass = crit.d.count >= crit.d.need;
  crit.f.pass = crit.f.repeat && crit.f.workers !== false;
  const times = rows.map((r) => r.trainMs / 1000);
  const env = { node: process.version, cpus: availableParallelism(), cpu: cpus()[0]?.model ?? '?', workers, T, trainer };
  const go = crit.a.pass && crit.b.pass && crit.c.pass && crit.d.pass && crit.f.pass;
  const report = { env, crit, drive60, go, rows, wallS: (now() - t0) / 1000, timeS: { median: median(times), max: Math.max(...times) } };
  writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 2));
  writeFileSync(`${outDir}/fitness.csv`, csv.join('\n') + '\n');

  const md: string[] = [];
  md.push(`# S1 bench (${trainer}) — seeds ${seeds[0]}–${seeds[seeds.length - 1]}, the default brain v2 (1 boundary vector + 1 head direction → 3 tanh → wheels), speed from firing, T = ${T.toLocaleString('en')}`);
  md.push('', `Node ${env.node}, ${env.cpus} cores (${env.cpu}), ${workers} workers. Not the reference desktop.`, '');
  md.push(`- (a) median unseen progress: final ${a.medianEnd.toFixed(0)} m vs gen 1 ${a.median1.toFixed(0)} m → ×${crit.a.ratio.toFixed(1)} (need ×3) — ${crit.a.pass ? 'PASS' : 'FAIL'}`);
  md.push(`- (b) final champion ≥ 80% of a lap on ${crit.b.count}/${n} (need 15) — ${crit.b.pass ? 'PASS' : 'FAIL'}`);
  md.push(`- (c) best training fitness end ≥ 2× gen 1 on ${crit.c.count}/${n} (need ${n}) — ${crit.c.pass ? 'PASS' : 'FAIL'}`);
  md.push(`- trainer gate: end ≥ 1.5× start (and above it) on ${crit.gate.count}/${n} (need 15) — ${crit.gate.pass ? 'PASS' : 'FAIL'}; end ≥ 500 m on ${crit.gate.over500}/${n}; final fitness median ${median(rows.map((r) => r.fitEnd)).toFixed(0)}`);
  md.push(`- (d) Minimal ≥ 50% of a lap on ${crit.d.count}/${n} (need 15) — ${crit.d.pass ? 'PASS' : 'FAIL'}`);
  md.push(`- (f) same seed twice: ${crit.f.repeat ? 'same hash' : 'DIFFERENT'}; 1 vs ${workers} workers: ${crit.f.workers === null ? 'not run' : crit.f.workers ? 'same hash on every seed' : 'DIFFERENT'} — ${crit.f.pass ? 'PASS' : 'FAIL'}`);
  md.push(`- 60 s (drive length, for comparison): median final / gen 1 ×${drive60.ratio.toFixed(1)}; final ≥ 1.6 laps on ${drive60.laps}/${n}; Minimal ≥ 1 lap on ${drive60.minimal}/${n}`);
  md.push(`- The teacher alone, 30 s on the unseen track: median ${median(rows.map((r) => r.teacher30)).toFixed(0)} m`);
  md.push(`- Generations (fitness checks for a gradient trainer): median ${median(rows.map((r) => r.gens))} (${Math.min(...rows.map((r) => r.gens))}–${Math.max(...rows.map((r) => r.gens))})`);
  md.push(`- Phase time (Node, ${workers} workers): median ${report.timeS.median.toFixed(2)} s, max ${report.timeS.max.toFixed(2)} s`);
  md.push('', `**${go ? 'GO' : 'NO-GO'}** on (a)–(d), (f).`, '');
  md.push('| seed | lap m | gens | ticks | fit gen 1 | fit end | unseen gen 1 m | mid m | final m | final % lap | final wall ticks | Minimal m | Minimal % lap | s (' + workers + 'w) | s (1w) | hash | 1w hash |');
  md.push('|' + '---|'.repeat(17));
  for (const r of rows) {
    md.push(`| ${r.seed} | ${r.lap.toFixed(0)} | ${r.gens} | ${r.ticks} | ${r.fit1.toFixed(0)} | ${r.fitEnd.toFixed(0)} | ${r.prog1.toFixed(0)} | ${r.progMid.toFixed(0)} | ${r.progEnd.toFixed(0)} | ${(100 * r.progEnd / r.lap).toFixed(0)} | ${r.wallsEnd} | ${r.minimalProg.toFixed(0)} | ${(100 * r.minimalProg / r.lap).toFixed(0)} | ${(r.trainMs / 1000).toFixed(2)} | ${r.trainMs1 ? (r.trainMs1 / 1000).toFixed(2) : '–'} | ${r.hash} | ${r.hash1 ?? '–'} |`);
  }
  md.push('', 'Fitness per generation per seed: `fitness.csv`. Paths: `seed-NN.svg` (red gen 1, amber mid, blue final).');
  writeFileSync(`${outDir}/report.md`, md.join('\n') + '\n');
  console.log(md.slice(0, 12).join('\n'));
  console.log(`wrote ${outDir}/report.md (${report.wallS.toFixed(0)} s total)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
