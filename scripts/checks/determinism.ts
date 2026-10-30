// Determinism golden hashes (3 seeds): track geometry, a recorded 600-tick race (under budget and over budget, so the
// noise path is covered), and a short training phase run inline and on 4 worker_threads (must match each other and
// the golden). golden.json is written only by this script:
//   npx tsx scripts/checks/determinism.ts            check
//   npx tsx scripts/checks/determinism.ts --update   regenerate (say why in the commit)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../../src/common/config';
import { Hasher } from '../../src/common/hash';
import { Rng } from '../../src/common/rng';
import { compile, starterSpec } from '../../src/common/sim/brain';
import { newRecording, Runner } from '../../src/common/sim/race';
import { generateTrack } from '../../src/common/sim/track';
import { InlineExecutor } from '../../src/common/train/episodes';
import { phaseSeeds, runPhase } from '../../src/common/train/phase';
import { NodePool } from '../sim/nodePool';

const SEEDS = [1, 2, 3];
const PHASE_T = 400_000;
const goldenPath = fileURLToPath(new URL('./golden.json', import.meta.url));

function raceHash(seed: number, budget: number): string {
  const ps = phaseSeeds(seed);
  const spec = starterSpec(), r = new Rng(seed);
  const net = compile({ spec, w: spec.conns.map(() => Math.max(-4, Math.min(4, r.normal() * 1.5))) });
  const rec = newRecording(net, CONFIG.race.ticks);
  new Runner().run(net, generateTrack(ps.unseenTrack), { ticks: CONFIG.race.ticks, budget, noiseSeed: ps.raceNoise, earlyStop: false, record: rec });
  return new Hasher().f64s(rec.x).f64s(rec.y).f64s(rec.hdg).f64s(rec.v).f64s(rec.energy).f64s(rec.act).hex();
}

async function main() {
  const update = process.argv.includes('--update');
  const pool = new NodePool(4);
  const got: Record<string, Record<string, string>> = {};
  let bad = 0;
  for (const seed of SEEDS) {
    const t = generateTrack(phaseSeeds(seed).unseenTrack);
    const track = new Hasher().u32(t.sub).f64s(t.px).f64s(t.py).f64s(t.curv).u32(t.startIdx).f64s(t.pads.map((p) => p.i0)).hex();
    const inline = await runPhase(new InlineExecutor(), starterSpec(), seed, { T: PHASE_T });
    const pooled = await runPhase(pool, starterSpec(), seed, { T: PHASE_T });
    if (inline.hash !== pooled.hash) { bad++; console.error(`seed ${seed}: inline ${inline.hash} ≠ 4 workers ${pooled.hash}`); }
    got[seed] = { track, race: raceHash(seed, CONFIG.budget[0]), raceOverBudget: raceHash(seed, 3), phase: inline.hash };
  }
  await pool.close();
  if (update) {
    writeFileSync(goldenPath, JSON.stringify(got, null, 2) + '\n');
    console.log(`determinism: wrote ${goldenPath}`);
    if (bad) process.exit(1);
    return;
  }
  const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as typeof got;
  for (const seed of SEEDS) for (const k of Object.keys(got[seed])) {
    if (golden[seed]?.[k] !== got[seed][k]) { bad++; console.error(`seed ${seed} ${k}: got ${got[seed][k]}, golden ${golden[seed]?.[k]}`); }
  }
  if (bad) { console.error(`determinism: ${bad} mismatch(es)`); process.exit(1); }
  console.log(`determinism: ${SEEDS.length} seeds match golden (track, race, over-budget race, phase inline = 4 workers)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
