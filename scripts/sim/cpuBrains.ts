// The nine vs CPU players' brains, one per round (rounds plan 2026-11-05 §1; tracks plan §4 for the skill spread). Each
// player has a share of the round's T (CONFIG.rounds.T; 5% to 100%, its skill) and its own design style, one design
// per round growing with the round's power (CPU designs plan 2026-11-06 §1). Every round trains from fresh weights,
// biases and fields (match-flow v2 plan §2), on that round's tracks (phase r), under the round's power (its budget: the
// speed cap, round power plan 2026-11-06). Evolution, fixed seeds, so re-running this script writes the same file.
// Writes src/assets/cpu/brains.json and prints each brain's design and its smallest and median signed distance in a
// 30 s race alone from pole on ten race tracks.
//   npx tsx scripts/sim/cpuBrains.ts [--workers 4]
import { mkdirSync, writeFileSync } from 'node:fs';
import { CONFIG } from '../../src/common/config';
import { compile, genomeHash, genomeToJSON, zeroGenome } from '../../src/common/sim/brain';
import { energyRefusal, maxLoad } from '../../src/common/sim/energy';
import { gridCar, raceTrackSeed } from '../../src/common/sim/match';
import { Runner } from '../../src/common/sim/race';
import { type BrainSpec, type Genome } from '../../src/common/sim/spec';
import { generateTrack } from '../../src/common/sim/track';
import { runPhase } from '../../src/common/train/phase';
import { CPU_NAMES, CPU_VERSION, type CpuBrain } from '../../src/common/sim/cpu';
import { NodePool } from './nodePool';

const i = process.argv.indexOf('--workers');
const workers = i >= 0 ? Number(process.argv[i + 1]) : 4;
const T = CONFIG.rounds.T, R = CONFIG.rounds;

type Fn = BrainSpec['layers'][number]['fn'];
/** A design: input cells by type and hidden layers as [width, function]. */
const d = (senses: Partial<BrainSpec['senses']>, layers: [number, Fn][]): BrainSpec =>
  ({ v: 2, senses: { boundary: 0, far: 0, hd: 0, grid: 0, speed: 0, ...senses }, layers: layers.map(([n, fn]) => ({ n, fn })) });
/**
 * Each racer's own design style (CPU designs plan 2026-11-06 §1), one design per round, growing with the round's power:
 * 2–8 input cells of mixed types, 1–3 hidden layers 2–8 wide, functions mixed; no two share a layer shape and
 * functions. Every one fits its round's power flat out (checked below).
 */
const STYLES: { style: string; rounds: BrainSpec[] }[] = [
  { style: 'small linear', rounds: [d({ boundary: 2 }, [[2, 'linear']]), d({ boundary: 3 }, [[3, 'linear']]), d({ boundary: 3, speed: 1 }, [[4, 'linear']])] },
  { style: 'two ReLU layers', rounds: [d({ boundary: 2 }, [[3, 'relu'], [2, 'relu']]), d({ boundary: 3 }, [[4, 'relu'], [2, 'relu']]), d({ boundary: 4, speed: 1 }, [[5, 'relu'], [3, 'relu']])] },
  { style: 'wide tanh', rounds: [d({ boundary: 2 }, [[4, 'tanh']]), d({ boundary: 2, hd: 1 }, [[6, 'tanh']]), d({ boundary: 3, hd: 1, grid: 1 }, [[8, 'tanh']])] },
  { style: 'sigmoid, many walls', rounds: [d({ boundary: 4 }, [[2, 'sigmoid']]), d({ boundary: 6 }, [[3, 'sigmoid']]), d({ boundary: 7, speed: 1 }, [[4, 'sigmoid']])] },
  { style: 'three mixed layers', rounds: [d({ boundary: 2 }, [[2, 'relu'], [2, 'sigmoid'], [2, 'tanh']]), d({ boundary: 3, speed: 1 }, [[3, 'relu'], [2, 'sigmoid'], [2, 'tanh']]), d({ boundary: 3, far: 1, speed: 1 }, [[4, 'relu'], [3, 'sigmoid'], [2, 'tanh']])] },
  { style: 'deep narrow tanh', rounds: [d({ boundary: 2 }, [[2, 'tanh'], [2, 'tanh']]), d({ boundary: 3 }, [[2, 'tanh'], [2, 'tanh'], [2, 'tanh']]), d({ boundary: 3, hd: 1 }, [[3, 'tanh'], [2, 'tanh'], [2, 'tanh']])] },
  { style: 'ReLU → tanh, speed', rounds: [d({ boundary: 2, speed: 1 }, [[2, 'relu'], [2, 'tanh']]), d({ boundary: 3, speed: 1 }, [[3, 'relu'], [3, 'tanh']]), d({ boundary: 4, speed: 1 }, [[5, 'relu'], [3, 'tanh']])] },
  { style: 'long range + heading', rounds: [d({ far: 2, hd: 1 }, [[3, 'sigmoid'], [2, 'linear']]), d({ far: 3, hd: 1 }, [[4, 'sigmoid'], [2, 'linear']]), d({ boundary: 1, far: 3, hd: 2 }, [[5, 'sigmoid'], [3, 'linear']])] },
  { style: 'balanced mix', rounds: [d({ boundary: 2, far: 1 }, [[3, 'tanh'], [2, 'relu']]), d({ boundary: 3, far: 1, speed: 1 }, [[4, 'tanh'], [3, 'relu']]), d({ boundary: 4, far: 1, hd: 1, speed: 1 }, [[5, 'tanh'], [3, 'relu'], [2, 'linear']])] },
];
/** Training share of T per racer (its skill), weakest first, as before. */
const SHARES = [0.05, 0.1, 0.17, 0.25, 0.35, 0.47, 0.6, 0.8, 1];
/** "2 boundary + 1 far · 3 tanh → 2 relu" */
const describe = (s: BrainSpec): string => `${Object.entries(s.senses).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(' + ')} · ${s.layers.map((l) => `${l.n} ${l.fn}`).join(' → ')}`;

async function main() {
  STYLES.forEach((st, k) => st.rounds.forEach((s, r) => { // every design fits its round's power, before any training
    const why = energyRefusal(s, R.budgets[r]), n = Object.values(s.senses).reduce((a, c) => a + c, 0);
    if (why || n < 2 || n > 8 || s.layers.length > 3) throw new Error(`cpuBrains: R${r + 1} ${CPU_NAMES[k]} ${describe(s)}: ${why ?? 'not 2–8 inputs, 1–3 layers'}`);
  }));
  const pool = new NodePool(workers);
  const rounds: CpuBrain[][] = [];
  for (let r = 0; r < R.count; r++) {
    const budget = R.budgets[r], out: CpuBrain[] = [];
    for (let k = 0; k < STYLES.length; k++) {
      const share = SHARES[k], { style } = STYLES[k];
      const start = zeroGenome(STYLES[k].rounds[r]);
      const why = energyRefusal(start.spec, budget);
      if (why) throw new Error(`cpuBrains: round ${r + 1} ${CPU_NAMES[k]} (${style}) can't race: ${why}`);
      const seed = 1000 + k, ticks = Math.round(share * T);
      const res = await runPhase(pool, start.spec, seed, { T: ticks, phase: r, power: budget }); // under the round's power (round power plan 2026-11-06)
      const genome = JSON.parse(genomeToJSON(res.final)) as Genome;
      out.push({ name: CPU_NAMES[k], design: style, budget: ticks, seed, gens: res.gens.length, genome });
      // skill: signed distance in a 30 s race alone from pole on ten race tracks
      const net = compile(genome, budget), runner = new Runner(), got: number[] = [];
      for (let s = 1; s <= 10; s++) {
        const t = generateTrack(raceTrackSeed(s), CONFIG.match.cars), g0 = gridCar(t, 0), from = g0.prog; // run() moves g0 itself
        got.push(runner.run(net, t, { ticks: R.raceTicks, earlyStop: false, start: g0, wrongWay: true }).prog - from);
      }
      got.sort((a, c) => a - c);
      const sp = start.spec;
      console.log(`R${r + 1} | ${CPU_NAMES[k]} | ${describe(sp)} | ${maxLoad(sp).toFixed(1)} / ${budget} | ${(share * 100).toFixed(0)}% T (${res.gens.length} gens) | min ${Math.round(got[0])} m, median ${Math.round((got[4] + got[5]) / 2)} m | ${genomeHash(genome)}`);
    }
    rounds.push(out);
  }
  await pool.close();
  mkdirSync('src/assets/cpu', { recursive: true });
  writeFileSync('src/assets/cpu/brains.json', JSON.stringify({ v: CPU_VERSION, T, rounds }, null, 1) + '\n');
  console.log('cpuBrains: wrote src/assets/cpu/brains.json');
}

main().catch((e) => { console.error(e); process.exit(1); });
