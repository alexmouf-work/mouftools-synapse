# Synapse — sandbox loop (milestone 1): build plan

Status: built (S1–S5), done pending the principal's check: desktop Firefox and Safari, (e) on the reference desktop,
connecting Vercel and the `synapse` CNAME. Approved 2026-10-30 ("build the plan end to end"). Supersedes the match framing of
`2026-10-30-solo-loop.md`. That plan still holds the shared design: stack, layout, types, numbers, trainer seam,
checks, risks. Its timed match (steps 5–7, bots) becomes milestone 2. Where the two disagree, this file and
`docs/CONTEXT.md` win.

## What it is
Synapse is a sandbox. Milestone 1 is its core loop with no timers: **build a brain on the workbench → train it →
watch it drive → change it → retrain**. Racing is the first arena.

## Rulings this milestone follows (verbatim in CONTEXT.md)
- Workbench = `reference/builder-mockup.html` ("looks excellent"): plain sandbox look, light and dark, landscape phones.
- The car is the input layer; hidden neurons sit in flat lines; the four wheels are the output line.
- Inputs (always on the board; charged only while wired): 6 eyes (left, front-left, front, front-right, right, back),
  road ahead, energy left (1 − energy used so far / the pool), speed, bias. Outputs: wheel speeds FL, FR, RL, RR, −1..+1.
- Energy is a pool for the 1-minute period (ruling 2026-10-31); shown as "% of energy budget" = used so far / the
  minute's pool, meter to 100%; once the pool is spent → noise in every signal, all noise at 200%.
- Cars are ghosts to each other. Weights carry over on retrain; new wires start at 0.
- Commits to `main` as the principal; no AI references anywhere.

## Steps (each: checks green, one commit or a few, docs in the same commit, then stop for review)

### S1 — headless sim + evolution benchmark (GO / NO-GO)
Solo-loop step 1, with this milestone's car: skid-steer (solo-loop §3 "Car"), the 10 inputs above, 4 wheel outputs,
layered BrainSpec (solo-loop §2), energy/noise, metered env, neuroevolution trainer, `scripts/sim/bench.ts`, `/bench`.
Pass criterion as solo-loop step 1, using the workbench's Starter brain (car-side steering pair + cruise neuron).
If it fails: the listed levers in order, then report. All checks in solo-loop step 1 apply.

### S2 — workbench
Port the mock-up into `src/client/ui/workbench/` (TypeScript, same look). All edits are pure ops in
`src/common/sim/brain.ts`; energy comes only from `energy.ts` (numbers in `config.ts`, shown as %). The brain
(genome JSON, versioned) saves to localStorage with try/catch; a broken or missing save starts from Starter.
Trainer picker shows Evolution only, others marked "soon".
- Checks: edit-op unit tests (stable ids, later-layer-only wires, caps 3 layers × 10, layer removal re-numbers,
  dangling wires pruned) · Playwright: drag a wire, a backward wire is refused, the % shown equals energy.ts,
  reload keeps the brain, 844×390 landscape has no horizontal scroll.

### S3 — training view
Train → the worker pool spends one phase's experience budget T on generated tracks (seeded; seed shown). View: the
look mock-up's training camera and ghost swarm, a live fitness graph, generation count, ticks used / T. The champion's
weights save with the brain; Train again continues from them.
- Checks: 1 vs 4 workers → identical hash · ghost capacity assert · Playwright: a training run finishes and the
  genome hash changes · a no-op retrain from the same seed is reproducible.

### S4 — drive view
The renderer port (solo-loop step 2): track, kerbs, walls, pads, gates, terrain, trees, the car with each wheel
spinning at its own output, real eye rays, live brain panel (probe channel `signal`), chase / broadcast / showroom
cameras. The trained car drives 60 s on an unseen track; distance and best lap shown; "New track" re-seeds; "Back to
workbench". No race HUD on the workbench: racing styling stays in this view.
- Checks: Node geometry NaN test over 200 seeds · InstancedMesh capacity asserts · dev build throws on non-finite sim
  state · render smoke (Playwright, SwiftShader): mean luminance above threshold, not uniform, console clean.

### S5 — ship
Production build, `vercel.json` (static, SPA fallback), README "how to run", render smoke against `vite preview`.
The principal connects the repo in Vercel and adds the `synapse` CNAME (no Vercel access from here).

## Done when
Build → train → drive → edit → retrain works without a reload in desktop Chrome (Firefox and Safari: the principal
checks). All checks green (types, unit, purity, determinism, bench, Playwright, render smoke). ARCHITECTURE.md
describes what exists; ROADMAP.csv current; this plan marked historical.

## S1 results (2026-10-30): GO on (a)–(d), (f); (e) to confirm on the reference desktop
Measured in the 4-core build container (Xeon 2.1 GHz, Node 22, headless Chromium 1243 via Playwright), not the
reference desktop. Full report, fitness per generation and per-seed path SVGs (gen 1 / mid / final champion on the
unseen track): `npm run bench` → `out/bench/` (ignored).

**T fixed at 6,000,000** by the plan's rule. One Starter phase in headless Chrome: 3M car-ticks in 2.39 s on the
default pool (3 workers here; 2.16 s on 4), so 7 s fits 9.5M, clamped to 6M. Final config: 6M in **4.51 s** on 3
workers (4.06 s on 4, 11.2 s on 1); Node 4 workers: median 3.87 s, max 4.36 s over the 20 seeds. Chrome and Node give
the same phase hash. (e) holds on the reference desktop if it runs at ≥ 0.65× this container's speed; to confirm
with `/bench/` there.

Final numbers (seeds 1–20, Starter, budget 10, T 6M, grip 32):
- (a) median unseen progress: final champion 1393 m vs gen-1 champion 98 m → ×14.3 (need ×3) — pass
- (b) final champion ≥ 80% of a lap in 30 s on 16/20 (need 15) — pass, narrowly; fails on seeds 1, 4, 5, 16
  (pinned on a wall at the first or second corner)
- (c) best training fitness end ≥ 2× gen 1 on 20/20 — pass
- (d) Minimal ≥ 50% of a lap on 17/20 (need 15) — pass
- (f) same seed twice → same hash; 1 vs 4 workers → same hash on all 20 seeds; Node = Chrome — pass

Lever log (each re-measured over seeds 1–20; levers in the plan's order, stopping at the first that passes):

| run | (a) median final / gen 1 | (b) ≥ 80% lap | (c) | (d) Minimal ≥ 50% | (f) |
|---|---|---|---|---|---|
| T 3M (plan default) | 1227 / 103 m, ×11.9 | 11/20 ✗ | 20/20 | 18/20 | pass |
| T 6M (fixed by the rule) | 1349 / 103 m, ×13.1 | 13/20 ✗ | 20/20 | 16/20 | pass |
| lever 1: 15 s episodes | 1048 / 96 m, ×10.9 | 10/20 ✗ | 20/20 | 12/20 ✗ | pass |
| lever 1 reverted (worse); lever 2: grip 24 → 32 m/s² | 1393 / 98 m, ×14.3 | **16/20** | 20/20 | 17/20 | pass |

Training fitness climbs on every seed (gen-1 best ≈ 35–225 m → 930–1110 m per 20 s episode, near the car's top
speed). The failure mode is overfitting to the two training tracks: a champion that is perfect on them can pin
itself on an unseen corner. More grip makes corners forgiving enough to generalise; road width was not changed.

Out-of-sample check (seeds 21–40, same config, not part of the criterion): (a) ×5.7, (b) 15/20, (c) 20/20,
(d) 16/20. The criterion holds there too, but (b) sits at the line on both sets: about 1 champion in 4 still pins on
an unseen corner. The next levers (wider road, σ schedule) are untried and would add margin if the principal wants it.

Changed from the plan, and why:
- Grip 32 m/s² (lever 2), not the proposed 24. Episode length stays 20 s.
- `yawMax` 3 rad/s added: the grip cap (grip / v) has no bound at standstill, so a pivot turn would spin at 60 rad/s.
- Wheels have no transfer function and no upkeep (the workbench shows none); output = clamp(sum, −1, 1).
- The wire cost uses the plan's c_fire 0.1 × |out × w|; the mock-up's 0.05 per wire is kept as the workbench's
  static estimate (S2: `cost.estimateActivity` 0.5 × fire, via `energy.estimate`). "Energy left" costs 0.3 (mock-up).
- Over-budget noise is drawn per (car seed, node, tick), not from one sequential stream, so adding a node never shifts
  another node's noise.
- `Trainer.step` is async (worker pools answer asynchronously); trainers take `{start: fresh | carry}`.
- A generation runs only if its worst case fits what is left of T (whole generations).
- Minimal keeps the one (empty) hidden line the workbench always shows, so its car → wheel wires span 2 (+50%).
  Superseded by the review call of 2026-10-30 (empty lines are free to cross); (d) re-measured in the S3 notes.
- Deep preset left for S2 (the plan does not define it; nothing in S1 uses it).

## S2 notes (2026-10-30)
Built as planned; checks green (edit-op unit tests, save parsing, `scripts/checks/workbench.ts` in headless Chromium).
Reviewer notes followed: the workbench shows energy only through `energy.ts` (`estimate`, with the mock-up's 0.05 per
wire as `cost.estimateActivity` 0.5 × fire, labelled "est."); the board is checked at the caps (3 × 10) and empty
(no hidden neurons, car wired straight to the wheels: the one hidden line stays on the board, empty, as in the
mock-up; since the review call, crossing it costs nothing); a corrupt save gives Starter and a toast. Deep preset: five front eyes, road and speed → 4 ReLU → 3 tanh →
wheels, 90% est. Additions beyond the mock-up, desktop unchanged: "Start from" presets in the side panel, rename,
and narrow-board rules (one shared "HIDDEN LAYERS" heading when lines are close, no ⊕ on a full line, ⊕ kept clear of
the palette, a colliding front-eye label moves above its pin). The mock-up itself, opened on a phone, renders zoomed
out (it has no viewport meta), which hid the label collision there.

## S3 notes (2026-10-30)
Built as planned; checks green (unit: recording changes no result, per-generation stepping = one big step, renderer
guards over 200 track seeds; `scripts/checks/training.ts` in headless Chromium on SwiftShader). Measured here: the
browser's phase hash equals Node's (seed 7, T 6M: 419c1c14, the S1 bench value); 1 and 4 workers agree; a 6M phase
with the view open takes 15.8 s in this container on SwiftShader (4.5 s in /bench without rendering), so expect
about /bench's time on a real GPU — to confirm on the reference desktop.
- The renderer core is ported (track, kerbs, walls, pads, start line, terrain, trees, clouds, sky, bloom, ghost
  InstancedMesh, training camera); flat track for now, no grandstands, billboards or gates. Detailed car, rays and
  race cameras are S4.
- Swarm: the latest recorded generation at ~8×; a set plays through before the next starts, so a 6M phase shows
  about 4 generations (here 1, 78, 129, 145). Stuck cars flash red and fade in place (episodes that ended early);
  cars that drove the full 20 s fade out in their own colour.
- Seeds: each brain keeps its own seed (picked on its first Train); run n uses `phaseSeeds(seed, n)`. Run 1 keeps
  the S1 trainer stream (same hashes as the bench); later runs draw a new trainer stream and new tracks.
- Software rasterisers get low quality and 4 fps while training: SwiftShader renders on the same CPU cores as the
  workers and slowed a phase from 4.5 s to 115 s before this.
- Review call "empty lines are free to cross" re-measured on S1: Starter unchanged (16/20 on (b)); Minimal still 17/20
  on (d).

### S3 revision (review 2026-10-30: "the story doesn't read yet")
- Story instead of latest-generation sampling: generations picked by count (1, ~10%, 25%, 50%, final), played in
  order at 3× for 2.6 s each from gen 1 on; overlay "Watching gen 21 of ~172". Measured (seed 7, 145 gens): story
  1 → 21 → 45 → 82 → 145 before the estimate fix (early generations are cheap, so the run's length was overestimated);
  the estimate now floors the cost per generation at 80% of the worst case: 1 → 15 → 39 → 77 → 145 (10/27/53%).
- Camera: chase angle ~44 m up following the pack's median progress; the generation's best is the solid car (ported
  from the look mock-up); ghosts are see-through cyan, not additive, so a pack of near-identical cars stays readable.
- Finished state: the champion's 30 s lap loops as the solid car with its generation faint 0.4 s behind.
- Bloom: lit scenery was going over (white kerbs and road lines, max 1.95; trees under in the frames checked). All
  scene light ×0.6, exposure ×1/0.6: scenery max 1.17, audit 0% over; strips, pads, lamps and the sun still bloom.

## S4 notes (2026-10-30)
Built as planned with the reviewer's notes; checks green (Node: stadium geometry finite and crowd within capacity
over 50 seeds, drive determinism; `scripts/checks/drive.ts` on SwiftShader). Measured: the browser's drive hash
equals the Node replay (seed 7, T 1M: 23a2ba9c), bloom audit 0% (max 1.17).
- The run is computed first (`runDrive`, 1200 ticks) and played back; the noise seed comes from the track seed, so
  a track seed alone reproduces a drive. The first track is the unseen track of the brain's last training run.
- Stuck: the training stall rule on the recording; note "Stuck against the wall since m:ss"; the chase camera swings
  round the car and the wheels keep turning at their outputs.
- Wheel spin is 18 rad/s × output (readable, reverses with the sign), not the 60 m/s the output asks for.
- Clouds were the one scenery item over the bloom threshold from the low chase camera; toned down slightly.
- Seen in the stuck shot: the car body pokes ~0.4 m into the wall when pinned (sim clamps the centre at 11.5 m; the
  model is 2.9 m wide). Left as is; a render-only inset is an option for S5.

### S4 fixes (review 2026-10-30)
- Flaky "bloom audit in the finale" (reviewer saw 0.02%, max 3.03): reproduced by sampling 70 frames of the 6M
  finale (12 over, max 3.58); the mask put every over pixel on the champion car: sun glints off mirror-sharp coats
  (trim clearcoat roughness 0). Coats are satin now (roughness ≥ 0.45, half clearcoat on the paint): 1 of 70 random
  frames at 1.31 after the first change, then the half coat. The audit now runs on fixed frames (seek + snapped
  camera; repeated frames give identical numbers), 1 in gen 1 and 6 in the finale, 7 in the drive.
- Near-field bloom: strips and gate bands fade near the camera (25% at ≤ 6 m, full from 60 m), bloom radius
  0.45 → 0.32. Before/after: `out/s4/chase-corner-before.png` / `chase-corner.png`, `broadcast-before.png` /
  `broadcast.png`.

## S5 notes (2026-10-31)
- `vite build` → `dist/`; `vercel.json` (static, SPA fallback, immutable `assets/`, no-cache `index.html`); README
  "Run locally" and "Deploy (Vercel)".
- `scripts/checks/preview.ts` (in `npm run check`) runs the production build under `vite preview` at the real T:
  training phase hash = Node (seed 7: 419c1c14, 7.4 s with the view open on SwiftShader), drive hash = Node, render
  smoke, bloom audit, SPA fallback, console clean.
- Bundle: app ~70 kB JS (27 kB gz) + fonts; three.js stage chunk ~570 kB (150 kB gz), loaded on first Train/Drive.
- Left for the principal: connect the repo in Vercel, add `synapse.mouftools.com` and the CNAME; check in desktop
  Firefox and Safari; run `/bench/` and a Train on the reference desktop for (e) and the view-open phase time.

## Energy as a pool (ruling 2026-10-31)
Energy is a pool for the 1-minute period (anchor 10 per tick × 1200); training episodes and the 30 s race get a
prorated share (review calls). S1 criterion re-run, seeds 1–20, Starter, T 6M (`npm run bench`, `out/bench/`):

| run | (a) median final / gen 1 | (b) ≥ 80% lap | (c) | (d) Minimal ≥ 50% | (f) |
|---|---|---|---|---|---|
| per-tick budget (before) | 1393 / 98 m, ×14.3 | 16/20 | 20/20 | 17/20 | pass |
| pool, prorated (as built) | 1171 / 133 m, ×8.8 | **12/20 ✗** | 20/20 | 17/20 | pass (1 vs 4 workers, all 20) |
| pool, the minute's pool in every run (experiment, not built) | 1194 / 175 m, ×6.8 | 17/20 | 20/20 | 17/20 | (not run) |

Why (b) drops: Starter wires Energy left into its cruise neuron. With prorated pools Energy left falls from 1 to
about 0.4 over the length of each run — 20 s in training, 30 s in the race, 60 s in the drive — so the cue the
champion learned stretches differently when it is tested; prorating keeps the share of the run equal, not the
behaviour per second. With the minute's pool everywhere, Energy left drains at the same rate per second in every run
and (b) passes again; the trade-off is that a 20 s training episode then never reaches noise unless a brain uses
more than 3× its share, so training would barely penalise over-budget designs. For the principal and reviewer to
choose; the build follows the call as given.

