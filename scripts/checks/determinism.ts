// Determinism golden hashes (3 seeds): track geometry, recorded 600-tick races (the default brain, and a heavy brain
// with every sense and two layers, whose energy load caps its speed, and the heavy brain on a figure eight, where rays
// skip the other deck), and a short training phase per trainer
// (evolution, backprop, actor-critic, A_RP, and evolution at temperature ×2) of the default brain run inline and on 4
// worker_threads (must match each other and the golden; ×2 must differ from ×1), evolution on one race track of ten
// cars (a match's round trains on its race track only: match polish §2), a 2-lap race of the nine stored CPU brains of
// the last round (B7: race track, grid, 2 laps, ranking; as Multiplayer races), and a vs CPU round's 30 s timed race
// of round 1's (rounds plan 2026-11-05). golden.json is written only by this script:
//   npx tsx scripts/checks/determinism.ts            check
//   npx tsx scripts/checks/determinism.ts --update   regenerate (say why in the commit)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../../src/common/config';
import { Hasher } from '../../src/common/hash';
import { Rng } from '../../src/common/rng';
import { compile } from '../../src/common/sim/brain';
import { defaultSpec, paramCount, type BrainSpec } from '../../src/common/sim/spec';
import { newRecording, recordingHash, Runner } from '../../src/common/sim/race';
import { generateTrack } from '../../src/common/sim/track';
import { InlineExecutor } from '../../src/common/train/episodes';
import { phaseSeeds, runPhase } from '../../src/common/train/phase';
import { NodePool } from '../sim/nodePool';
import cpuData from '../../src/assets/cpu/brains.json';
import { cpuRounds } from '../../src/common/sim/cpu';
import { raceTrackSeed, ROUND_RACE, runRace } from '../../src/common/sim/match';

const SEEDS = [1, 2, 3];
const PHASE_T = 600_000; // a few generations of 60 s episodes
const goldenPath = fileURLToPath(new URL('./golden.json', import.meta.url));

const EIGHT_TRACK = 13; // a figure eight (track families, B5)
const HEAVY: BrainSpec = { v: 2, senses: { boundary: 3, landmark: 2, hd: 2, grid: 2, speed: 1 }, layers: [{ n: 6, fn: 'relu' }, { n: 4, fn: 'sigmoid' }] };

/** A recorded 30 s race of `spec` with seeded random weights on the seed's unseen track (or the given one). */
function raceHash(seed: number, spec: BrainSpec, track = phaseSeeds(seed).unseenTrack): string {
  const r = new Rng(seed);
  const net = compile({ spec, w: Array.from({ length: paramCount(spec) }, () => Math.max(-4, Math.min(4, r.normal() * 1.5))) });
  const rec = newRecording(net, CONFIG.race.ticks);
  new Runner().run(net, generateTrack(track), { ticks: CONFIG.race.ticks, earlyStop: false, record: rec });
  return recordingHash(rec);
}

async function main() {
  const update = process.argv.includes('--update');
  const pool = new NodePool(4);
  const got: Record<string, Record<string, string>> = {};
  let bad = 0;
  for (const seed of SEEDS) {
    const t = generateTrack(phaseSeeds(seed).unseenTrack);
    const track = new Hasher().u32(t.sub).f64s(t.px).f64s(t.py).f64s(t.curv).u32(t.startIdx).f64s(t.pads.map((p) => p.i0)).f64s(t.layer).hex();
    const inline = await runPhase(new InlineExecutor(), defaultSpec(), seed, { T: PHASE_T });
    const pooled = await runPhase(pool, defaultSpec(), seed, { T: PHASE_T });
    if (inline.hash !== pooled.hash) { bad++; console.error(`seed ${seed}: inline ${inline.hash} ≠ 4 workers ${pooled.hash}`); }
    const bpInline = await runPhase(new InlineExecutor(), defaultSpec(), seed, { T: PHASE_T, trainer: 'backprop' });
    const bpPooled = await runPhase(pool, defaultSpec(), seed, { T: PHASE_T, trainer: 'backprop' });
    if (bpInline.hash !== bpPooled.hash) { bad++; console.error(`seed ${seed} backprop: inline ${bpInline.hash} ≠ 4 workers ${bpPooled.hash}`); }
    const rl: Record<string, string> = {};
    for (const [key, id] of [['phaseAc', 'ac'], ['phaseArp', 'arp']] as const) {
      const a = await runPhase(new InlineExecutor(), defaultSpec(), seed, { T: PHASE_T, trainer: id });
      const b = await runPhase(pool, defaultSpec(), seed, { T: PHASE_T, trainer: id });
      if (a.hash !== b.hash) { bad++; console.error(`seed ${seed} ${id}: inline ${a.hash} ≠ 4 workers ${b.hash}`); }
      rl[key] = a.hash;
    }
    const onRace = { T: PHASE_T, tracks: [raceTrackSeed(seed)], raceCars: CONFIG.match.cars };
    const rcInline = await runPhase(new InlineExecutor(), defaultSpec(), seed, onRace), rcPooled = await runPhase(pool, defaultSpec(), seed, onRace);
    if (rcInline.hash !== rcPooled.hash) { bad++; console.error(`seed ${seed} race track: inline ${rcInline.hash} ≠ 4 workers ${rcPooled.hash}`); }
    const hotInline = await runPhase(new InlineExecutor(), defaultSpec(), seed, { T: PHASE_T, temperature: 1 });
    const hotPooled = await runPhase(pool, defaultSpec(), seed, { T: PHASE_T, temperature: 1 });
    if (hotInline.hash !== hotPooled.hash) { bad++; console.error(`seed ${seed} ×2: inline ${hotInline.hash} ≠ 4 workers ${hotPooled.hash}`); }
    if (hotInline.hash === inline.hash) { bad++; console.error(`seed ${seed}: temperature ×2 gave the ×1 hash ${inline.hash}`); }
    got[seed] = { track, race: raceHash(seed, defaultSpec()), raceHeavy: raceHash(seed, HEAVY), raceEight: raceHash(seed, HEAVY, EIGHT_TRACK), phase: inline.hash, phaseBackprop: bpInline.hash, ...rl, phaseTemp2: hotInline.hash, phaseRaceTrack: rcInline.hash, match: runRace(cpuRounds(cpuData)[cpuRounds(cpuData).length - 1].map((b) => b.genome), seed).hash, round: runRace(cpuRounds(cpuData)[0].map((b) => b.genome), seed, undefined, ROUND_RACE).hash };
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
  console.log(`determinism: ${SEEDS.length} seeds match golden (track, default and heavy brains' races, the heavy brain on a figure eight, evolution, backprop, actor-critic, A_RP, ×2 and race-track phases inline = 4 workers, a 2-lap race, a round's timed race)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
