// What a race costs to compute (B8, tracks plan §4: "the cost of 100 brains × 60 s on a phone. Measured, not
// assumed"): runRace with 10 and 100 entries (the nine CPU brains, cycled, plus the heavy brain of the determinism
// check every tenth entry), the whole 120 s cap each, best of 3, on this machine in Node (one thread, as the page does).
//   npx tsx scripts/sim/raceCost.ts
import cpuData from '../../src/assets/cpu/brains.json';
import { cpuBrains } from '../../src/common/sim/cpu';
import { runRace } from '../../src/common/sim/match';
import { zeroGenome } from '../../src/common/sim/brain';
import { paramCount, type BrainSpec, type Genome } from '../../src/common/sim/spec';
import { Rng } from '../../src/common/rng';

const cpu = cpuBrains(cpuData).map((b) => b.genome);
const HEAVY: BrainSpec = { v: 2, senses: { boundary: 3, landmark: 2, hd: 2, grid: 2, speed: 1 }, layers: [{ n: 6, fn: 'relu' }, { n: 4, fn: 'sigmoid' }] };
const r = new Rng(1), heavy: Genome = { ...zeroGenome(HEAVY), w: Array.from({ length: paramCount(HEAVY) }, () => Math.max(-4, Math.min(4, r.normal()))) };
const field = (n: number) => Array.from({ length: n }, (_, k) => (k % 10 === 9 ? heavy : cpu[k % cpu.length]));
for (const n of [10, 100]) {
  const g = field(n), ms: number[] = [];
  for (let i = 0; i < 3; i++) { const t0 = performance.now(); runRace(g, 7 + i); ms.push(performance.now() - t0); }
  console.log(`${n} cars × 120 s: best ${Math.min(...ms).toFixed(0)} ms (runs ${ms.map((x) => x.toFixed(0)).join(', ')} ms)`);
}
