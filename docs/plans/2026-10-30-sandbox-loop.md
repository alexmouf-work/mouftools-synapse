# Synapse — sandbox loop (milestone 1): build plan

Status: approved 2026-10-30 ("build the plan end to end"). Supersedes the match framing of
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
  road ahead, energy left (1 − last tick's use / budget), speed, bias. Outputs: wheel speeds FL, FR, RL, RR, −1..+1.
- Energy shown as "% of energy budget", meter to 100%; over budget → noise in every signal, all noise at 200%.
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

## S1 results (2026-10-30)
Measured in the 4-core build container (Xeon 2.1 GHz, Node 22, headless Chromium 1243 via Playwright), not the
reference desktop. Full report, fitness per generation and per-seed path SVGs: `npm run bench` → `out/bench/`.

**T fixed at 6,000,000** by the plan's rule: one Starter phase takes 2.39 s for 3M car-ticks in headless Chrome on
the default 3 workers (2.16 s on 4), so 7 s fits 9.5M here, clamped to 6M. (e) is to confirm on the reference
desktop: 6M stays valid there if it runs at ≥ 0.7× this container's speed.

Lever log (seeds 1–20, Starter, budget 10):

| run | (a) median final / gen 1 | (b) ≥ 80% lap | (c) | (d) Minimal ≥ 50% | (f) |
|---|---|---|---|---|---|
| T 3M (plan default) | 1227 / 103 m, ×11.9 | 11/20 ✗ | 20/20 | 18/20 | pass |
| T 6M (fixed) | 1349 / 103 m, ×13.1 | 13/20 ✗ | 20/20 | 16/20 | pass |

Training fitness climbs on every seed (gen-1 best ≈ 35–225 m → 870–1100 m per 20 s episode, near the car's top
speed), but on the unseen track the final champion often scrapes a wall or stalls: overfitting to two tracks.
