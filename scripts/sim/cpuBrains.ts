// The nine vs CPU players' brains, one per round (rounds plan 2026-11-05 §1; tracks plan §4 for the skill spread). Each
// player has a budget share of the round's T (CONFIG.rounds.T; 5% to 100%, its skill) and a way of growing its design.
// Round 1: a small design within round 1's budget. Each later round: the last round's design is grown with the same
// edit ops a player uses while the next step still fits that round's budget. Every round trains from fresh weights,
// biases and fields (match-flow v2 plan §2), on that round's tracks (phase r). Evolution, fixed seeds, so re-running this script writes the same file.
// Writes src/assets/cpu/brains.json and prints each brain's median signed distance in a 30 s race alone from pole on ten
// race tracks.
//   npx tsx scripts/sim/cpuBrains.ts [--workers 4]
import { mkdirSync, writeFileSync } from 'node:fs';
import { CONFIG } from '../../src/common/config';
import { addSense, compile, genomeHash, genomeToJSON, setLayerSize, zeroGenome, type EditResult } from '../../src/common/sim/brain';
import { energyRefusal, maxLoad } from '../../src/common/sim/energy';
import { gridCar, raceTrackSeed } from '../../src/common/sim/match';
import { Runner } from '../../src/common/sim/race';
import { type BrainSpec, type Genome, type SenseId } from '../../src/common/sim/spec';
import { generateTrack } from '../../src/common/sim/track';
import { runPhase } from '../../src/common/train/phase';
import { CPU_NAMES, CPU_VERSION, type CpuBrain } from '../../src/common/sim/cpu';
import { NodePool } from './nodePool';

const i = process.argv.indexOf('--workers');
const workers = i >= 0 ? Number(process.argv[i + 1]) : 4;
const T = CONFIG.rounds.T, R = CONFIG.rounds;

/** One growth step: a sense cell, or a neuron on hidden layer L. */
type Step = { sense: SenseId } | { neuron: number };
interface Style { base: BrainSpec; grow: Step[] }
const b = (n = 1): Step[] => Array.from({ length: n }, () => ({ sense: 'boundary' as const }));
const STYLES: Record<string, Style> = {
  // eyes first: wall cells, then neurons (then headings and landmarks once those are full, so it keeps growing)
  eyes: { base: { v: 2, senses: { boundary: 3, landmark: 0, hd: 0, grid: 0, speed: 0 }, layers: [{ n: 3, fn: 'tanh' }] }, grow: [...b(), { neuron: 0 }, ...b(), { neuron: 0 }, { sense: 'speed' }, { sense: 'hd' }, { sense: 'landmark' }] },
  // balanced: a wall cell, a neuron, a heading now and then
  even: { base: { v: 2, senses: { boundary: 2, landmark: 0, hd: 1, grid: 0, speed: 0 }, layers: [{ n: 3, fn: 'tanh' }] }, grow: [...b(), { neuron: 0 }, { sense: 'hd' }, { neuron: 0 }, { sense: 'landmark' }] },
  // speed-aware: the signed speed cell from the start
  pace: { base: { v: 2, senses: { boundary: 3, landmark: 0, hd: 0, grid: 0, speed: 1 }, layers: [{ n: 3, fn: 'tanh' }] }, grow: [{ neuron: 0 }, ...b(), { neuron: 0 }, ...b(), { sense: 'hd' }, { sense: 'landmark' }] },
  // deep: a second layer once it can afford one
  // (two layers from round 1: a layer added later would start at 0 and cut the trained path through it)
  deep: { base: { v: 2, senses: { boundary: 2, landmark: 0, hd: 0, grid: 0, speed: 0 }, layers: [{ n: 3, fn: 'tanh' }, { n: 2, fn: 'tanh' }] }, grow: [...b(), { neuron: 0 }, { neuron: 1 }, { sense: 'hd' }] },
};
// name order = budget order; styles alternate
const PLAN: { share: number; style: string }[] = [
  { share: 0.05, style: 'even' }, { share: 0.1, style: 'eyes' }, { share: 0.17, style: 'pace' },
  { share: 0.25, style: 'deep' }, { share: 0.35, style: 'even' }, { share: 0.47, style: 'eyes' },
  { share: 0.6, style: 'pace' }, { share: 0.8, style: 'deep' }, { share: 1, style: 'eyes' },
];

/** Apply the style's steps in turn (cycling) while one still fits the budget; each edit carries the weights over. */
function grow(g: Genome, style: Style, budget: number): Genome {
  for (let tries = 0, s = 0; tries < style.grow.length; s++) {
    const st = style.grow[s % style.grow.length];
    let r: EditResult;
    if ('sense' in st) r = g.spec.senses[st.sense] >= CONFIG.senses[st.sense].max ? { ok: false, reason: 'full' } : addSense(g, st.sense, budget);
    else r = st.neuron < g.spec.layers.length && g.spec.layers[st.neuron].n < CONFIG.brain.maxPerLayer ? setLayerSize(g, st.neuron, g.spec.layers[st.neuron].n + 1, budget) : { ok: false, reason: 'full' };
    if (r.ok) { g = r.genome; tries = 0; } else tries++;
  }
  return g;
}

async function main() {
  const pool = new NodePool(workers);
  const rounds: CpuBrain[][] = [];
  let prev: Genome[] = [];
  for (let r = 0; r < R.count; r++) {
    const budget = R.budgets[r], out: CpuBrain[] = [];
    for (let k = 0; k < PLAN.length; k++) {
      const { share, style } = PLAN[k], st = STYLES[style];
      const start = grow(zeroGenome(r === 0 ? st.base : prev[k].spec), st, budget);
      const why = energyRefusal(start.spec, budget);
      if (why) throw new Error(`cpuBrains: round ${r + 1} ${CPU_NAMES[k]} (${style}) can't race: ${why}`);
      const seed = 1000 + k, ticks = Math.round(share * T);
      const res = await runPhase(pool, start.spec, seed, { T: ticks, phase: r });
      const genome = JSON.parse(genomeToJSON(res.final)) as Genome;
      out.push({ name: CPU_NAMES[k], design: style, budget: ticks, seed, gens: res.gens.length, genome });
      // skill: signed distance in a 30 s race alone from pole on ten race tracks
      const net = compile(genome), runner = new Runner(), got: number[] = [];
      for (let s = 1; s <= 10; s++) {
        const t = generateTrack(raceTrackSeed(s), CONFIG.match.cars), g0 = gridCar(t, 0), from = g0.prog; // run() moves g0 itself
        got.push(runner.run(net, t, { ticks: R.raceTicks, earlyStop: false, start: g0, wrongWay: true }).prog - from);
      }
      got.sort((a, c) => a - c);
      const sp = start.spec, cells = Object.values(sp.senses).reduce((a, c) => a + c, 0) + sp.layers.reduce((a, l) => a + l.n, 0);
      console.log(`R${r + 1} ${CPU_NAMES[k].padEnd(9)} ${style.padEnd(5)} ${String(cells).padStart(2)} cells flat out ${maxLoad(sp).toFixed(1).padStart(4)}% / ${budget}%  T ${(share * 100).toFixed(0).padStart(3)}% (${res.gens.length} gens)  median 30 s ${Math.round((got[4] + got[5]) / 2)} m  ${genomeHash(genome)}`);
    }
    rounds.push(out);
    prev = out.map((x) => x.genome);
  }
  await pool.close();
  mkdirSync('src/assets/cpu', { recursive: true });
  writeFileSync('src/assets/cpu/brains.json', JSON.stringify({ v: CPU_VERSION, T, rounds }, null, 1) + '\n');
  console.log('cpuBrains: wrote src/assets/cpu/brains.json');
}

main().catch((e) => { console.error(e); process.exit(1); });
