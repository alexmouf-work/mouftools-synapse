// Determinism golden hashes (3 seeds): track geometry, recorded 600-tick races (the default brain, and a heavy brain
// with every sense and two layers, whose energy load caps its speed), and a short training phase per trainer
// (evolution, backprop) of the default brain run inline and on 4 worker_threads (must match each other and the golden). golden.json is written only by this script:
//   npx tsx scripts/checks/determinism.ts            check
//   npx tsx scripts/checks/determinism.ts --update   regenerate (say why in the commit)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../../src/common/config';
import { Hasher } from '../../src/common/hash';
import { Rng } from '../../src/common/rng';
import { compile } from '../../src/common/sim/brain';
import { defaultSpec, wireCount, type BrainSpec } from '../../src/common/sim/spec';
import { newRecording, recordingHash, Runner } from '../../src/common/sim/race';
import { generateTrack } from '../../src/common/sim/track';
import { InlineExecutor } from '../../src/common/train/episodes';
import { phaseSeeds, runPhase } from '../../src/common/train/phase';
import { NodePool } from '../sim/nodePool';

const SEEDS = [1, 2, 3];
const PHASE_T = 600_000; // a few generations of 60 s episodes
const goldenPath = fileURLToPath(new URL('./golden.json', import.meta.url));

const HEAVY: BrainSpec = { v: 2, senses: { boundary: 3, landmark: 2, hd: 2, grid: 2, speed: 1 }, layers: [{ n: 6, fn: 'relu' }, { n: 4, fn: 'sigmoid' }] };

/** A recorded 30 s race of `spec` with seeded random weights on the seed's unseen track. */
function raceHash(seed: number, spec: BrainSpec): string {
  const ps = phaseSeeds(seed), r = new Rng(seed);
  const net = compile({ spec, w: Array.from({ length: wireCount(spec) }, () => Math.max(-4, Math.min(4, r.normal() * 1.5))) });
  const rec = newRecording(net, CONFIG.race.ticks);
  new Runner().run(net, generateTrack(ps.unseenTrack), { ticks: CONFIG.race.ticks, earlyStop: false, record: rec });
  return recordingHash(rec);
}

async function main() {
  const update = process.argv.includes('--update');
  const pool = new NodePool(4);
  const got: Record<string, Record<string, string>> = {};
  let bad = 0;
  for (const seed of SEEDS) {
    const t = generateTrack(phaseSeeds(seed).unseenTrack);
    const track = new Hasher().u32(t.sub).f64s(t.px).f64s(t.py).f64s(t.curv).u32(t.startIdx).f64s(t.pads.map((p) => p.i0)).hex();
    const inline = await runPhase(new InlineExecutor(), defaultSpec(), seed, { T: PHASE_T });
    const pooled = await runPhase(pool, defaultSpec(), seed, { T: PHASE_T });
    if (inline.hash !== pooled.hash) { bad++; console.error(`seed ${seed}: inline ${inline.hash} ≠ 4 workers ${pooled.hash}`); }
    const bpInline = await runPhase(new InlineExecutor(), defaultSpec(), seed, { T: PHASE_T, trainer: 'backprop' });
    const bpPooled = await runPhase(pool, defaultSpec(), seed, { T: PHASE_T, trainer: 'backprop' });
    if (bpInline.hash !== bpPooled.hash) { bad++; console.error(`seed ${seed} backprop: inline ${bpInline.hash} ≠ 4 workers ${bpPooled.hash}`); }
    got[seed] = { track, race: raceHash(seed, defaultSpec()), raceHeavy: raceHash(seed, HEAVY), phase: inline.hash, phaseBackprop: bpInline.hash };
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
  console.log(`determinism: ${SEEDS.length} seeds match golden (track, default and heavy brains' races, evolution and backprop phases inline = 4 workers)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
