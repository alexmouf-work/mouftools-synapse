// The nine vs CPU brains (tracks plan §4, coordinator's vs CPU calls 2026-11-05): each trained offline with evolution
// from scratch at its own budget, spread from 5% to 100% of T, on a mix of random starters (plan §3c, the brains a new
// player gets) and sighted designs (more boundary vector cells, a speed cell, wider or deeper layers). Every design is
// one a player could race (within the match energy limit). Fixed seeds, so re-running this script writes the same file.
// Writes src/assets/cpu/brains.json and prints each brain's median progress over 120 s alone on ten race tracks.
//   npx tsx scripts/sim/cpuBrains.ts [--workers 4]
import { mkdirSync, writeFileSync } from 'node:fs';
import { CONFIG } from '../../src/common/config';
import { compile, genomeHash, genomeToJSON } from '../../src/common/sim/brain';
import { energyRefusal, maxLoad } from '../../src/common/sim/energy';
import { gridCar, raceTrackSeed } from '../../src/common/sim/match';
import { Runner } from '../../src/common/sim/race';
import { starterSpec, type BrainSpec, type Genome } from '../../src/common/sim/spec';
import { generateTrack } from '../../src/common/sim/track';
import { runPhase } from '../../src/common/train/phase';
import { CPU_NAMES, CPU_VERSION, type CpuBrain } from '../../src/common/sim/cpu';
import { NodePool } from './nodePool';

const i = process.argv.indexOf('--workers');
const workers = i >= 0 ? Number(process.argv[i + 1]) : 4;
const T = CONFIG.train.T;
const sighted: Record<string, BrainSpec> = {
  eyes: { v: 2, senses: { boundary: 3, landmark: 0, hd: 1, grid: 0, speed: 1 }, layers: [{ n: 4, fn: 'tanh' }] },
  wide: { v: 2, senses: { boundary: 5, landmark: 1, hd: 0, grid: 0, speed: 1 }, layers: [{ n: 5, fn: 'tanh' }] },
  deep: { v: 2, senses: { boundary: 3, landmark: 0, hd: 2, grid: 0, speed: 0 }, layers: [{ n: 4, fn: 'tanh' }, { n: 3, fn: 'tanh' }] },
  relu: { v: 2, senses: { boundary: 4, landmark: 0, hd: 1, grid: 0, speed: 1 }, layers: [{ n: 6, fn: 'relu' }] },
};
// name order = budget order; designs alternate a random starter and a sighted design
const PLAN: { share: number; design: string }[] = [
  { share: 0.05, design: 'starter:11' }, { share: 0.1, design: 'eyes' }, { share: 0.17, design: 'starter:12' },
  { share: 0.25, design: 'wide' }, { share: 0.35, design: 'starter:13' }, { share: 0.47, design: 'deep' },
  { share: 0.6, design: 'starter:14' }, { share: 0.8, design: 'relu' }, { share: 1, design: 'wide' },
];

async function main() {
  const pool = new NodePool(workers);
  const brains: CpuBrain[] = [];
  for (let k = 0; k < PLAN.length; k++) {
    const { share, design } = PLAN[k];
    const spec = design.startsWith('starter:') ? starterSpec(Number(design.split(':')[1])) : sighted[design];
    const why = energyRefusal(spec, 'match');
    if (why) throw new Error(`cpuBrains: ${CPU_NAMES[k]} (${design}) can't race: ${why}`);
    const seed = 1000 + k, budget = Math.round(share * T);
    const r = await runPhase(pool, spec, seed, { T: budget });
    const genome = JSON.parse(genomeToJSON(r.final)) as Genome;
    brains.push({ name: CPU_NAMES[k], design, budget, seed, gens: r.gens.length, genome });
    // skill: progress over 120 s alone from pole on ten race tracks
    const net = compile(genome), runner = new Runner(), got: number[] = [];
    for (let s = 1; s <= 10; s++) {
      const t = generateTrack(raceTrackSeed(s), true);
      got.push(runner.run(net, t, { ticks: CONFIG.match.capTicks, earlyStop: false, start: gridCar(t, 0) }).prog);
    }
    got.sort((a, b) => a - b);
    console.log(`${CPU_NAMES[k].padEnd(9)} ${design.padEnd(10)} budget ${(share * 100).toFixed(0).padStart(3)}% (${r.gens.length} gens) flat out ${maxLoad(spec).toFixed(1)}%  median 120 s ${Math.round((got[4] + got[5]) / 2)} m  ${genomeHash(genome)}`);
  }
  await pool.close();
  mkdirSync('src/assets/cpu', { recursive: true });
  writeFileSync('src/assets/cpu/brains.json', JSON.stringify({ v: CPU_VERSION, T, brains }, null, 1) + '\n');
  console.log('cpuBrains: wrote src/assets/cpu/brains.json');
}

main().catch((e) => { console.error(e); process.exit(1); });
