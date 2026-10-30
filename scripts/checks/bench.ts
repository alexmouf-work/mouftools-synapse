// Bench time check: one full Starter phase (seed 1, T car-ticks) on 4 worker_threads must finish within
// 1.3 × the committed baseline. Best of 3 runs (review call 2026-10-30: a check that fails on noise gets ignored).
// The baseline is machine-specific; it records the machine it came from.
//   npx tsx scripts/checks/bench.ts            check
//   npx tsx scripts/checks/bench.ts --update   write bench-baseline.json from this machine
import { readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism, cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../../src/common/config';
import { starterSpec } from '../../src/common/sim/brain';
import { runPhase } from '../../src/common/train/phase';
import { NodePool } from '../sim/nodePool';

const path = fileURLToPath(new URL('./bench-baseline.json', import.meta.url));
const SLACK = 1.3;

async function main() {
  const pool = new NodePool(4);
  const ms: number[] = [];
  let hash = '';
  for (let k = 0; k < 3; k++) {
    const r = await runPhase(pool, starterSpec(), 1, { now: () => performance.now() });
    ms.push(r.trainMs); hash = r.hash;
  }
  await pool.close();
  const best = Math.min(...ms);
  const machine = `${cpus()[0]?.model ?? '?'} × ${availableParallelism()}, Node ${process.version}`;
  if (process.argv.includes('--update')) {
    writeFileSync(path, JSON.stringify({ nodeMs: Math.round(best), T: CONFIG.train.T, workers: 4, machine, hash }, null, 2) + '\n');
    console.log(`bench: baseline ${best.toFixed(0)} ms written (${machine})`);
    return;
  }
  const base = JSON.parse(readFileSync(path, 'utf8')) as { nodeMs: number; T: number; machine: string };
  if (base.T !== CONFIG.train.T) throw new Error(`bench: baseline is for T = ${base.T}, config has ${CONFIG.train.T}; run --update`);
  const limit = base.nodeMs * SLACK;
  const msg = `bench: ${best.toFixed(0)} ms (best of 3; baseline ${base.nodeMs} ms on ${base.machine}; limit ${limit.toFixed(0)} ms)`;
  if (best > limit) { console.error(`${msg} — TOO SLOW`); process.exit(1); }
  console.log(msg);
}

main().catch((e) => { console.error(e); process.exit(1); });
