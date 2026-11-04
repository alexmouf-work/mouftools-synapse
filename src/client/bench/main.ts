// Dev-only /bench page: one training phase of the default brain in this browser, timed (?trainer= picks the trainer). Exposes the result on window.__bench for
// scripts/checks/bench-browser.ts.
import { CONFIG } from '../../common/config';
import { defaultSpec } from '../../common/sim/spec';
import { defaultWorkers } from '../../common/train/episodes';
import { runPhase } from '../../common/train/phase';
import { BrowserPool } from '../workers/pool';

interface BenchResult { done: boolean; error?: string; runs: { ms: number; setupMs: number; hash: string; gens: number; ticks: number }[]; workers: number; seed: number; T: number }
declare global { interface Window { __bench?: BenchResult } }

const q = new URLSearchParams(location.search);
const seed = Number(q.get('seed') ?? 1);
const workers = Number(q.get('workers') ?? defaultWorkers(navigator.hardwareConcurrency || 2));
const runs = Number(q.get('runs') ?? 1);
const T = Number(q.get('T') ?? CONFIG.train.T);
const trainer = q.get('trainer') ?? 'evolution';
const out = document.getElementById('out') as HTMLElement;
const res: BenchResult = { done: false, runs: [], workers, seed, T };

async function main() {
  const lines = [`${trainer} · seed ${seed} · ${workers} workers · T ${T.toLocaleString('en')} · ${navigator.hardwareConcurrency} cores reported`];
  out.textContent = lines.join('\n') + '\nrunning…';
  const t0 = performance.now();
  const pool = new BrowserPool(workers);
  for (let k = 0; k < runs; k++) {
    const s0 = performance.now();
    await pool.setup({ spec: defaultSpec(), trackSeeds: [], episodeTicks: 1 }); // warm workers
    const setupMs = performance.now() - s0;
    const r = await runPhase(pool, defaultSpec(), seed, { T, trainer, now: () => performance.now() });
    res.runs.push({ ms: r.trainMs, setupMs, hash: r.hash, gens: r.gens.length, ticks: r.ticksUsed });
    lines.push(`run ${k + 1}: ${(r.trainMs / 1000).toFixed(2)} s · ${r.gens.length} generations · ${r.ticksUsed.toLocaleString('en')} car-ticks · hash ${r.hash}`);
    out.textContent = lines.join('\n');
  }
  await pool.close();
  lines.push(`total ${((performance.now() - t0) / 1000).toFixed(2)} s`);
  out.textContent = lines.join('\n');
  res.done = true;
  window.__bench = res;
}

main().catch((e) => { res.done = true; res.error = String(e?.stack ?? e); window.__bench = res; out.textContent = `error: ${res.error}`; });
