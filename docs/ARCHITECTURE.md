# Architecture

What exists, updated in the same commit as the code. The intended full layout is §1 of
`docs/plans/2026-10-30-solo-loop.md`; milestone steps are in `docs/plans/2026-10-30-sandbox-loop.md`.

Built so far: **S1** (headless sim, evolution benchmark), **S2** (the workbench) and **S3** (the training view: Train
→ the swarm learns on a 3-D track → the champion is saved; Train again continues). No drive view yet (S4).

## Stack
Vite + TypeScript, Three.js 0.160 (training view only, loaded on first Train), Vitest, tsx for Node scripts,
Playwright (dev only: browser bench, workbench and training checks). No backend.

## src/common: the deterministic core
Pure TypeScript: no DOM, no three, no clocks, no `Math.random`, no engine transcendental `Math.*`, no Float32. It runs
unchanged in Node, Node worker_threads and browser workers, and must produce the same bits everywhere: multiplayer
will re-run races on every client. `scripts/checks/purity.ts` enforces this (Math is allow-listed).

| File | What it is |
|---|---|
| `config.ts` | Every tunable: tick rate, budgets, costs, upkeep, caps, sensors, car, track generator, trainer, T. |
| `fmath.ts` | sin, cos, atan, atan2, exp, tanh, sigmoid, log from + − × ÷, sqrt, floor, round only. |
| `rng.ts` | splitmix32 seed derivation (`derive`, fixed `TAG` labels), sfc32 streams (`Rng`), counter-based `hashU`. |
| `hash.ts` | FNV-1a over canonical bytes (doubles as little-endian IEEE bytes). |
| `sim/spec.ts` | Fixed pins (10 inputs, 4 wheel outputs), `BrainSpec`, `Genome`, validation. |
| `sim/energy.ts` | THE energy cost function (static cost, wire factors, fire cost, noise level, Energy left) and the workbench `estimate`. |
| `sim/brain.ts` | Spec → compiled net, evaluation, presets (Starter, Minimal, Deep), pure edit ops, canonical genome JSON and hash. |
| `sim/track.ts` | Track generator + validation, wall grid, ray cast (grid DDA), nearest-sample search. |
| `sim/car.ts` | Skid-steer physics, walls, boost pads, progress. |
| `sim/sensors.ts` | The 10 input readings (only wired inputs are computed). |
| `sim/race.ts` | `Runner`: one car for N ticks, optional recording of frames and activations, early stop for training. |
| `train/trainer.ts` | Trainer interface, events, probe channels, registry. |
| `train/env.ts` | Metered environment: the only way a trainer reaches the sim; throws before any overrun of T. |
| `train/episodes.ts` | Episode batches: `EpisodeCore` (runs policies × tracks), `splitEven`, `InlineExecutor`. |
| `train/neuroevo.ts` | The milestone's trainer. |
| `train/phase.ts` | Seeds for a phase and `runPhase` (setup → env → trainer → result hash; optional per-step hooks and stop). |
| `train/contract.test.ts` | The suite every trainer must pass. |

### Brain
Pins are always on the board; an input is computed and charged only while wired. Node order in the compiled net:
10 inputs (`i:l, i:fl, i:f, i:fr, i:r, i:b, i:road, i:energy, i:spd, i:bias`), hidden neurons by (layer, spec
order), then the wheels (`o:fl, o:fr, o:rl, o:rr`). Each node sums its incoming wires in spec order, so a new wire
with w = 0 adds an exact +0. Hidden transfer functions: step, ReLU (cap 4), sigmoid, tanh. Wheels have no transfer
function: output = clamp(sum, −1, 1), and no upkeep (as the workbench shows them). Layers are 1..3. A wire's span for the skip
surcharge counts only hidden lines that hold neurons (`wireSpan`; review call 2026-10-30), so the empty line the
board always shows is free to cross.

Over budget, every signal (inputs, neurons, wheels) is mixed after its transfer function:
`(1 − a)·clean + a·U(−1, 1)`, with `a = clamp(last tick's use / budget − 1, 0, 1)`. The noise value is a pure
function of (car noise seed, node key, tick) — `hashU` — so it does not depend on how many other nodes there are,
and every policy in a generation sees the same noise (common random numbers).

Upgrade invariance (tested for all four transfer functions over 600 ticks): adding w = 0 wires or neurons, even a
whole new layer, leaves every wheel output and car position identical **while the brain is under budget and Energy
left is unwired**. A new neuron's upkeep changes the energy used, and those two read energy by design.

### Edit ops
Every change the workbench makes is a pure function in `brain.ts` on a `Draft = {genome, nextId}`: `addWire`,
`removeWire`, `unplug`, `clearWires`, `addNeuron`, `addLayer`, `removeNeuron`, `setAct`, with `wireCheck` naming why a
wire is refused (`into-car`, `backward`, `duplicate`, …). Neuron ids are never reused (`nextId`). Kept wires keep
their weights; new wires start at 0. Removing the last neuron of a line removes the line (unless it is the only one)
and later lines move down; wires whose ends are gone are dropped. Caps: 3 lines × 10 neurons.

### Energy as the workbench shows it
`energy.estimate(spec)` = exact static cost (wired sensors + upkeep) + every wire at `wireFactor(span) ×
CONFIG.cost.estimateActivity` (0.5, so a span-1 wire shows 0.05 per tick, the mock-up's figure). The meter, the
ledger ("Wires (est.)"), the per-function and per-sensor costs and the noise figure all come from `energy.ts`, shown
as % of the round-1 budget. The client has no cost table of its own.

### Car (skid-steer)
Per wheel target speed = 60 m/s × output. The car eases toward the mean side speed (accel 14, brake 30 m/s²), yaws
at (vR − vL) / 2 m capped by 32 m/s² lateral grip (S1 lever 2; the plan proposed 24) and by `yawMax` 3 rad/s (the grip cap alone is unbounded at
standstill), and loses speed to front/rear mismatch on a side (`scrub`). Walls at 12.5 m clamp the car centre to
11.5 m, keep 60% of speed, ease the heading halfway to the tangent and count one wall tick per tick. Boost pads:
+10 m/s (cap 72) once per pad per lap, not sensed. Every tick asserts the state is finite.

### Track
Closed centripetal Catmull-Rom through 8–14 jittered points, resampled every ~2 m, validated (length 1100–1900 m,
smoothed radius ≥ 25 m, parts > 60 m apart along the track ≥ 31 m apart in space, a ≥ 150 m straight with
|curvature| < 1/300 for the start, 2–3 pads on the calmest 30 m windows ≥ 300 m apart). A failure moves to the next
sub-seed; 200 failures throw. About 1 attempt in 16 is valid; the 1000-seed test passes with room to spare.

### Training
`runPhase(executor, spec, seed)` derives the phase's two training tracks, their noise seeds, the unseen track and
the race noise from the seed; builds a `MeteredEnv` over an `Executor`; runs the trainer until it is done; hashes
every generation's stats and champion. Executors: `InlineExecutor` (this thread), `NodePool`
(`scripts/sim/nodePool.ts`, worker_threads) and `BrowserPool` (`src/client/workers/pool.ts`). All three run the same
`EpisodeCore` on contiguous slices from `splitEven` and return results in policy order, so the worker count can never
change a result (checked: 1 vs 4 workers, Node vs Chrome, identical hashes).

Neuroevolution: population 64, both training tracks × 400-tick episodes (early stop on stall or going backwards),
elitism 4, tournament 3, no crossover, Gaussian mutation p 0.2 with σ falling 0.4 → 0.08 over the phase, reset
p 0.01, weights clamped ±4. `fresh` start draws N(0, 0.5); `carry` puts the given genome in slot 0 exactly and its
mutants after it. It runs whole generations while the next one's worst case fits T. Probe channel: `signal`.

The Env also offers `openCar` (one car stepped tick by tick, metered per tick, optional exploration noise on the
wheels) for the gradient trainers to come; neuroevolution does not use it.

## src/client
- `index.html` + `main.ts` — the app: self-hosted fonts (@fontsource Atkinson Hyperlegible, IBM Plex Mono), the
  workbench, and the training view in the same page (no reload). `?view=train` trains the saved brain on load;
  `?seed=` and `?workers=` override; `?T=` (dev server only) shrinks the budget for the browser checks;
  `?quality=low|high` overrides the renderer's choice.
- `ui/workbench/` — a TypeScript port of `reference/builder-mockup.html`: `workbench.css` (the mock-up's styles,
  plus the rename field and presets), `pins.ts` (where each pin sits on the car, icons, panel text; pin ids and
  labels come from `spec.ts`), `store.ts` (save/load), `workbench.ts` (board layout and drawing, wiring by drag,
  side panel, meter, toasts). Same look in light and dark; phones use it in landscape, portrait shows the "turn
  sideways" card. Additions to the mock-up: a "Start from" section (Starter / Minimal / Deep; a second click within
  3 s confirms, since it replaces the brain), a real rename, and three narrow-board rules that leave the desktop
  layout untouched: several lines too close for "HIDDEN n" share one "HIDDEN LAYERS" heading with a number per line;
  a full line has no ⊕ and a ⊕ that would sit under the palette is kept above it; a front-diagonal eye label that
  runs into another label moves above its pin. Neurons shrink (17 → down to 6 px) only when a full line needs it.
- Saving: after every change the brain is written to localStorage `synapse.brain` as `{v: 2, name, nextId, train:
  {seed, phases}, genome}` (canonical genome JSON; v1 saves load with no training history). Reads and writes are in try/catch: a missing save starts from Starter; an unreadable one
  starts from Starter with a toast saying so; a browser that refuses storage gets a toast that changes last until the
  tab closes. A preset resets the training history (new seed, trains from scratch).
- `ui/training/` — the training view. Train hands the saved brain over; the seed is the brain's own (picked on its
  first Train), the phase is its count of finished runs, so every run is reproducible and a retrain sees new tracks.
  All-zero weights train from scratch (fresh), anything else continues from them (carry: slot 0 is the saved genome
  exactly). `runPhase` steps one generation at a time on a `BrowserPool`; before a step the view may ask the pool to
  record track-0 paths (only when the swarm wants a newer generation, at most 5 a second, and on the possibly last
  generations), which never changes a result. Overlay (plain, workbench tokens): seed, run, generation, generation
  on screen, ticks used / T, a fitness graph (best and mean per generation against ticks used), Stop / Back to
  workbench / Train again / Drive (disabled until S4). Done → the champion's genome and `{seed, phases + 1}` are
  saved; Stop keeps the brain as it was. While training, drawing is paced so it cannot starve the pool: a frame
  costing > 8 ms is kept to a fifth of the main thread, and a software rasteriser (which renders on the workers'
  CPU cores) draws 4 frames a second.
- `render/` — the 3-D port of `reference/look-mockup.html`'s core: `stage.ts` (renderer, ACES, bloom, sky dome, fog,
  sun and shadows, training camera circling high over the swarm), `trackMesh.ts` (road, kerbs red/white in corners,
  run-off, walls with light strip, boost pads, start line, from the sim Track; flat for now), `scenery.ts` (terrain,
  tree groves, clouds; seeded by the track), `textures.ts`, `ghosts.ts` (the swarm: one InstancedMesh holding a
  population, played back ~8× from recorded paths; champion yellow, wall contact flashing red, an episode that
  ended early stays put and fades out flashing red, a full episode fades out in its own colour), `guard.ts`
  (finite-geometry and finite-matrix asserts, instance capacity asserts — all throw). Quality: `low` (pixel ratio 1,
  no shadows, no MSAA; bloom kept) is picked for software rasterisers (SwiftShader, llvmpipe), `high` otherwise.
- `bench/index.html` → `bench/main.ts` (dev only) runs one phase in the browser on `BrowserPool`; `vite build` leaves
  it out.

## scripts
- `scripts/sim/bench.ts` — the S1 benchmark over seeds 1–20 (report, fitness CSV, path SVGs into ignored `out/bench/`).
- `scripts/checks/` — `purity.ts`, `determinism.ts` (+ `golden.json`, written only by `--update`), `bench.ts`
  (+ `bench-baseline.json`, Node time ≤ baseline × 1.3), `bench-browser.ts` (headless Chrome time + hash = Node).
- `scripts/checks/workbench.ts` — the workbench in headless Chromium: drag a wire, backward wires refused, % shown =
  `energy.estimate`, reload keeps the brain, corrupt save → Starter + toast, 844×390 without horizontal scroll,
  portrait card, 3 × 10 and empty brains without overlaps; screenshots to `out/s2/`.
- `scripts/checks/training.ts` — the training view in headless Chromium (SwiftShader): train from the workbench,
  phase hash = Node's, genome saved and changed, Train again = Node's carry run, the same saved brain on 1 and 4
  workers → the same hash, Stop keeps the brain, ghost capacity, render smoke (mean luminance and spread of a real
  frame), 844×390 layout, console clean; screenshots to `out/s3/`.
- `npm run check` runs types, purity, unit + contract tests, determinism, the bench time check, and the workbench
  and training checks.
