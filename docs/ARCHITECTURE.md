# Architecture

What exists, updated in the same commit as the code. The intended full layout is §1 of
`docs/plans/2026-10-30-solo-loop.md`; milestone steps are in `docs/plans/2026-10-30-sandbox-loop.md`.

Milestone 1 is built: **S1** (headless sim, evolution benchmark), **S2** (the workbench), **S3** (the training view:
Train → the swarm learns on a 3-D track → the champion is saved; Train again continues), **S4** (the drive view: the
trained car drives 60 s on an unseen track in the stadium) and **S5** (production build and Vercel config; the
principal connects the project and the domain).

## Stack
Vite + TypeScript, Three.js 0.160 (training view only, loaded on first Train), Vitest, tsx for Node scripts,
Playwright (dev only: browser bench, workbench and training checks). No backend.

## src/common: the deterministic core
Pure TypeScript: no DOM, no three, no clocks, no `Math.random`, no engine transcendental `Math.*`, no Float32. It runs
unchanged in Node, Node worker_threads and browser workers, and must produce the same bits everywhere: multiplayer
will re-run races on every client. `scripts/checks/purity.ts` enforces this (Math is allow-listed).

| File | What it is |
|---|---|
| `config.ts` | Every tunable: tick rate, energy costs, brain caps, senses, car, track generator, trainers, T, teacher. |
| `fmath.ts` | sin, cos, atan, atan2, exp, tanh, sigmoid, log from + − × ÷, sqrt, floor, round only. |
| `rng.ts` | splitmix32 seed derivation (`derive`, fixed `TAG` labels), sfc32 streams (`Rng`), counter-based `hashU`. |
| `hash.ts` | FNV-1a over canonical bytes (doubles as little-endian IEEE bytes). |
| `sim/spec.ts` | Brain v2 shape: sense counts and hidden layers (`BrainSpec`), the default brain, column ids, the canonical wire order (`wireList`), `Genome`, validation. |
| `sim/senses.ts` | THE sense rules (boundary vector and landmark fields, head direction, grid, speed), shared by the sim and the designer's graphs. |
| `sim/energy.ts` | THE energy rule: per-node coefficients, the flat-out and resting loads, the speed cap (floor 10%), the match refusal, the designer's "at maximum firing rate" figures. |
| `sim/brain.ts` | Spec → compiled net, evaluation (returns the tick's energy load), firing rates, pure edit ops, canonical genome JSON and hash. |
| `sim/track.ts` | Track generator + validation, wall grid, ray cast (grid DDA), nearest-sample search. |
| `sim/car.ts` | Skid-steer physics, walls, boost pads, progress. |
| `sim/sensors.ts` | Every sense cell's reading for a car on a track (through senses.ts); `bearingDir`, the one field-direction rule the drive view's beams also use. |
| `sim/race.ts` | `Runner`: one car for N ticks, optional recording of frames and activations, early stop for training (`stopCheck`, the one stop rule); `runDrive` (the drive view's 60 s run, also replayed by the checks) and `recordingHash`. `Runner.tick` takes a training-only `act` hook that sees every node value before physics and may rewrite the wheels. |
| `sim/teacher.ts` | The scripted pure-pursuit teacher backprop copies (`teacherWheels`), and `driveTeacher` (the teacher alone, a reference for tests and the bench). |
| `train/trainer.ts` | Trainer interface, events, probe channels, registry with each trainer's label and refusal (`trainerRefusal`). |
| `train/env.ts` | Metered environment: the only way a trainer reaches the sim; throws before any overrun of T. |
| `train/episodes.ts` | Episode batches: `EpisodeCore` (runs policies × tracks), `splitEven`, `InlineExecutor`. |
| `train/neuroevo.ts` | Evolution. |
| `train/grad.ts` | The generalised delta rule on a compiled net (pre-activations, backward pass); the gradient trainers' one implementation. |
| `train/rollout.ts` | Lanes for gradient trainers: `RolloutCore` runs a round of lanes with a kernel; lane state travels with the job. |
| `train/kernels.ts`, `train/imitate.ts` | The kernels by id; `imitate` is backprop's (DAgger with the teacher). |
| `train/gradTrainer.ts` | What every gradient trainer shares: rounds, fitness checks, the update, the `delta` channel. |
| `train/backprop.ts` | Backprop (copy a teacher). |
| `train/probe.ts` | The `signal` probe all trainers share. |
| `train/phase.ts` | Seeds for a phase and `runPhase` (setup → env → trainer → result hash; optional per-step hooks and stop). |
| `train/contract.test.ts` | The suite every trainer must pass. |

### Brain (v2, 2026-11-04; plan `docs/plans/2026-11-04-brain-designer-v2.md`)
A brain is its sense counts and its hidden layers; every column is fully wired to the next, always (no wiring by
hand). Senses, each up to its maximum: boundary vector (≤ 7; a wall within a 20 m field facing one way, read by
three short rays across the field; fields spread across the front), landmark (≤ 5; the finish line within 40 m, in
the field's direction), head direction (≤ 8; cos(heading − preferred), preferred angles spread evenly, two = cos and
sin), grid (≤ 6; three plane waves 60° apart; the first two at two scales, more at spread phases), speed (≤ 1). Adding
a cell re-tunes the set (cells are numbered by count). Hidden layers: 1–8, each 1–8 neurons of one function
(Linear = z kept to −1..1, ReLU capped at 4, Sigmoid, Tanh); a new layer starts with two tanh neurons. The wheels are
tanh. Node order: sense cells (by sense, then cell), hidden layer by layer, wheels; the genome's weights follow
`wireList` (column by column, source by source, then target). The default brain: one boundary vector cell, one
head-direction cell, three tanh neurons. Every node has a firing rate 0..1 (`rateOf`: tanh and linear (y + 1)/2,
ReLU min(y, 1), sigmoid y; head direction (cos + 1)/2; the other senses their value).

Energy (speed follows firing, §3a, §3aa): one supply each tick. Each node spends its cost × its rate, each wire its
cost × its source's rate (costs halved 2026-11-04: senses 1–1.5%, neurons 0.75–1.5%, wheels 0.75%, wires 0.075%);
`evalNet` returns that load, and the tick's top speed is what is left, `speedCap` = max(10%, 100% − load), applied to
the wheels before physics. The sandbox refuses nothing (a brain past 100% just runs at the floor); vs CPU and
Multiplayer will pass mode `match`, which refuses a design past 100% with every cell flat out (`energyRefusal`). The
designer shows the range from resting (senses silent, layers at their resting rate, wheels at half) to flat out.
Retired: the per-minute pool, the over-budget noise, the energy-left input, the eyes, road ahead and bias.

### Edit ops
Every change the designer makes is a pure function in `brain.ts` on a `Genome`: `addSense`, `removeSense`,
`insertLayer`, `removeLayer`, `setLayerSize`, `setLayerFn`, each refusing at a cap (`full`, `empty`, `last-layer`) or,
in match mode, on energy. Any edit leaves an untrained brain: every weight goes back to 0 (ruling 2026-11-04: wires
are grey until trained, and any edit returns them to grey).

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
`runPhase(executor, spec, seed)` derives the phase's two training tracks and the unseen track from the seed; builds a `MeteredEnv` over an `Executor`; runs the trainer until it is done; hashes
every generation's stats and champion. Executors: `InlineExecutor` (this thread), `NodePool`
(`scripts/sim/nodePool.ts`, worker_threads) and `BrowserPool` (`src/client/workers/pool.ts`). All three run the same
`EpisodeCore` on contiguous slices from `splitEven` and return results in policy order, so the worker count can never
change a result (checked: 1 vs 4 workers, Node vs Chrome, identical hashes).

Sandbox training asks how many generations (10, 25, 50, 100, 250, 500 or 1000; 100 first): the budget is that many
of evolution's worst-case generations (`phaseBudget`), evolution stops after that many, and a gradient trainer spreads
that many fitness checks over the budget. The S1 bench still uses T = 6M.

Neuroevolution: population 64, both training tracks × 1200-tick (1-minute) episodes (early stop on stall or going
backwards),
elitism 4, tournament 3, no crossover, Gaussian mutation p 0.2 with σ falling 0.4 → 0.08 over the phase, reset
p 0.01, weights clamped ±4. `fresh` start draws N(0, 0.5); `carry` puts the given genome in slot 0 exactly and its
mutants after it. It runs whole generations while the next one's worst case fits T. Probe channel: `signal`.

The Env also offers `openCar` (one car stepped tick by tick, metered per tick, optional exploration noise on the
wheels; nothing uses it now) and `rollout` (a gradient trainer's round, below).

### Trainers
Every trainer gets the same experience budget T (car-ticks; principal 2026-10-30), so they compete on sample
efficiency (plan, bench numbers and the levers tried: `docs/plans/2026-11-04-trainers.md`). Each is registered with a label and a refusal (`trainerRefusal(id, spec)`: a sentence the workbench can
show, or null); `init` throws the same sentence. All pass `contract.test.ts`.

- **Evolution** (`neuroevo.ts`, above). Refuses nothing.
- **Gradient trainers** (`gradTrainer.ts`) share one frame. `CONFIG.train.grad.lanes` (16) cars drive the current
  weights at once, each from a seeded place on a training track at rest, through 60 s episodes with the same stop rule
  and energy pool as evolution. A round runs every lane `roundTicks` (400) ticks with the weights fixed; each lane
  returns its own sum of per-tick update terms, the trainer adds the lanes up in lane order and updates once
  (weights clamped ±4). The lanes' whole state travels with each job, so worker count, Node or browser never change a
  bit (checked: inline = 4 workers in the determinism check; 1 vs 4 workers in the bench). Every `evalEvery` (150k)
  car-ticks and at the end, the current weights are scored with evolution's training fitness on both training tracks
  (60 s each): that is a `generation` event (gen 1 = the starting weights), the fitness graph's point, and the last
  one is the score of `weights()`. Rounds, checks and all are charged to T; the final check's worst case is reserved.
  `fresh` draws N(0, 0.1) (all-zero weights have no gradient; small, so no tanh starts saturated), with wires into a
  ReLU layer drawn positive: a ReLU silent on every input has slope 0 and can never wake. `carry` starts from the
  given weights. Every function on every layer has a slope, so nothing is refused. Channels: `signal`, and `delta` =
  the last round's Δw per wire.
- **Backprop** (`backprop.ts`, kernel `imitate.ts`): copy the teacher, DAgger-style. The brain drives (an episode is
  teacher-driven with probability β, 0.5 falling to 0 by 25% of T: classic DAgger mixing), the teacher labels every
  state the brain saw, and each tick adds the generalised delta rule's terms (`grad.ts`): output δ = (t − y)·f′(z),
  hidden δ = f′(z)·Σ w·δ, term δ·x; the round's update is Δw = η·(Σ δ·x)/samples, η = `backprop.lr` (0.6, constant).
  The wheels are tanh like any neuron. The teacher's targets account for the tick's speed cap. On the default v2
  brain it does not learn (no bias input, see the trainers plan); it does on brains with a steady input.
- **The teacher** (`sim/teacher.ts`): pure pursuit on the centreline (privileged: the brain never sees the centreline).
  Look-ahead L = 10 m + 0.4 s × v (≤ 30 m); yaw wanted ω = gain × κ × max(v, 40 m/s), κ = 2·left / d² of the arc
  through the target (gain 3; the grip caps the yaw anyway, and a firm label is what a brain can copy: with gain 1 the
  wheel difference it asks for at speed is ~0.01, under what the brain's regression can resolve); speed capped by the
  slowest corner in braking reach, √(0.85·grip/|curv| + 2·0.8·brake·s); skid-steer wheels v ∓ ω·trackWidth/2, giving
  up speed rather than the turn at ±1. Alone it laps every tested track with no wall touch (~1 550 m in 30 s).


## src/client
- `index.html` + `main.ts` — the app: one font site-wide, Arial (Helvetica, sans-serif), weights 400 and 700, no
  italics, no web fonts (principal 2026-11-04), in CSS, SVG text, canvas text and the stadium's sign textures alike;
  tabular figures where numbers change. The workbench, the training view and the drive view in the same page (no reload),
  over one shared 3-D stage (`ui/arena.ts`). `?view=train` / `?view=drive` open them on load (`?track=` picks the
  drive's track);
  `?seed=` and `?workers=` override; `?T=` (dev server only) shrinks the budget for the browser checks;
  `?quality=low|high` overrides the renderer's choice.
- `ui/designer/` — the brain designer (the workbench; B3), a port of `reference/brain-v2-mockup.html` (the UI spec)
  onto the engine: `designer.css` (the mock-up's styles), `designer.ts` (layout in equal column regions, the tray of
  senses, sense cells as 3-D symbol circles, lines of identical neurons with a function header, the car whose wheels
  are motor neurons, wires grey until trained then in their weight colours; tap to inspect; "+"/"−" for neurons and
  layers that vanish at a limit; the panel: the activation graph from the engine's own rules (polar fields with
  distance rings, the head-direction wave, the grid heatmap with a 50 m bar, transfer and speed curves, axis titles,
  axes through 0), the one-line description, "At maximum firing rate, uses x% energy" from energy.ts, the Neurons
  slider, the bin; the energy split resting–flat out; Reset with a confirmation; the trainer picker and the centred
  "Learning Rule : …" strip; Train asks how many generations), `symbols.ts` (three.js symbols, loaded after first
  paint, one viewport per tray tile and sense cell; build mode is still, so only a gentle idle motion), `store.ts`.
  One 860 × 400 layout scaled to fit any screen (above the storage notice while it shows); portrait phones get the
  "turn sideways" card. Additions to the mock-up: the sound button in the top bar, the legal and credits line at the
  right end of the rule strip. No Drive button: the drive view is reached after training.
- Saving: after every change the brain is written to localStorage `synapse.brain` as `{v: 3, name, trainer, train:
  {seed, phases}, genome}` (canonical genome JSON). Reads and writes are in try/catch: a missing save starts from the
  starting brain; an unreadable one starts from it with a toast; a save from before brain v2 (v1, v2) is reset to
  the starting brain with a one-time note; a browser that refuses storage gets a toast that changes last until the
  tab closes. Any edit, and Reset, clear the training history (new seed, trains from scratch).
- `ui/training/` — the training view. Train hands the saved brain over; the seed is the brain's own (picked on its
  first Train), the phase is its count of finished runs, so every run is reproducible and a retrain sees new tracks.
  All-zero weights train from scratch (fresh), anything else continues from them (carry: slot 0 is the saved genome
  exactly). `runPhase` steps one generation at a time on a `BrowserPool`; before a step the view may ask the pool to
  record track-0 paths, which never changes a result. Display is decoupled from compute: the view records a story
  chosen by generation count (gen 1, ~10%, 25%, 50% of the estimated run, and every generation that could be the
  last), and the swarm plays them in order, each for 2.6 s at 3×, starting with gen 1 at once; if compute is behind,
  the newest recorded generation loops. When the story reaches the final generation, the finale loops the
  champion's 30 s lap (replayed on the main thread for display, not charged to T) as the solid car, with its
  generation faint behind it. Overlay (plain, workbench tokens): seed, run, generation, generation
  on screen ("gen 21 of ~172"), ticks used / T, a fitness graph (best and mean per generation against ticks used), Stop / Back to
  workbench / Train again / Drive (disabled until S4). Done → the champion's genome and `{seed, phases + 1}` are
  saved; Stop keeps the brain as it was. While training, drawing is paced so it cannot starve the pool: a frame
  costing > 8 ms is kept to a fifth of the main thread, and a software rasteriser (which renders on the workers'
  CPU cores) draws 4 frames a second.
- `render/` — the 3-D port of `reference/look-mockup.html`'s core: `stage.ts` (renderer, ACES, bloom, sky dome, fog,
  sun and shadows, the training camera: a chase angle ~44 m up, following the pack's median progress along the
  track, or the champion in the finale; bloom audit), `car.ts` (the mock-up's solid race car), `drive.ts`
  (the drive rig: the yellow car with each wheel spinning at 18 rad/s × its output, so it reverses visibly; one ray
  per boundary vector cell along its field's centre via `sensors.bearingDir`, up to 20 m, brighter as a wall nears;
  chase, broadcast and showroom cameras), `stadium.ts` (grandstand with crowd and SYNAPSE
  banner, start and checkpoint gates, SYNAPSE billboards, floodlights, chevron boards on tight corners, broadcast
  camera spots; trees keep clear of them), `trackMesh.ts` (road, kerbs red/white in corners,
  run-off, walls with light strip, boost pads, start line, from the sim Track; flat for now), `scenery.ts` (terrain,
  tree groves, clouds; seeded by the track), `textures.ts`, `ghosts.ts` (the swarm: one InstancedMesh holding a
  population, see-through cyan ghosts with the generation's best as the solid car; wall contact flashing red, an
  episode that ended early stays put and fades out flashing red, a full episode fades out in its own colour), `guard.ts`
  (finite-geometry and finite-matrix asserts, instance capacity asserts — all throw). Quality: `low` (pixel ratio 1,
  no shadows, no MSAA; bloom kept) is picked for software rasterisers (SwiftShader, llvmpipe), `high` otherwise.
  Bloom: threshold 1.3; all scene light is scaled by 0.6 and the exposure by 1/0.6, so lit scenery (max ≈ 1.17) stays
  under it and only glow-tagged things (wall strips, boost pads, lamps, gate bands, sun disc) bloom; `bloomAudit`
  renders the scene without them to a float target and counts pixels over. The checks audit fixed frames
  (`auditTrainAt` / the drive view's `auditAt`: seek, snap the camera, draw, audit), so a pass means pass. The car's
  coats are satin (roughness ≥ 0.45; the paint near matte, 0.7): mirror-sharp coats threw sun glints up to 3.6 at some poses,
  and driving into a low sun the glossier paint (1.8) and kerbs (1.38) still went over, so kerbs, run-off and walls are
  rough (0.8) too (found by the bloom audit after brain v2).
  Bloom radius 0.32 (mock-up 0.45), and `glow.ts` fades strips and gate bands near the camera (25% at ≤ 6 m, full
  from 60 m), so near glows read as lines, not haze, while mid-distance glow keeps the mock-up's look.
- `ui/weights.ts` — how a wire's weight looks everywhere (principal, 2026-10-31): red at −1, black at 0, green at +1
  (clamped beyond ±1); width 1→4 px and opacity 0.3→1 grow with √(|w| / 4). The workbench draws each wire in its
  weight colour over a faint neutral halo (`--wire-halo`, stronger in dark mode, so a w = 0 wire stays visible and
  clickable); a selected pin's or neuron's wires get an accent halo and the flow dashes, never a recolour.
- `ui/drive/` — the drive view. `runDrive(genome, trackSeed)` computes the whole 60 s run first, then it plays back
  in real time and loops. First track: the unseen track of the brain's
  last training run; New track draws a fresh seed. Overlay (plain): time, distance and laps, best lap, the energy split
  this tick (brain % · speed %), track seed, cameras (Chase / Broadcast / Showroom, keys 1–3), New track, Back to workbench. A stall
  (the training rule: < 5 m of new progress in 3 s) shows "Stuck against the wall since m:ss" (or "Not moving"), and
  the chase camera swings slowly round the car, whose wheels keep turning at their outputs. `brainPanel.ts` draws
  the brain's columns small on a canvas: wires in their weight colours (`weights.ts`), every cell flashing at
  14 Hz × its firing rate from the recording (`spikes.ts`; a short yellow flash; steady glow under reduced motion),
  wheels with their speed. The beams take their directions from `sensors.bearingDir` (checked against the sim at
  several poses). Drive is offered by the finished training view.
- `bench/index.html` → `bench/main.ts` (dev only) runs one phase in the browser on `BrowserPool`; `vite build` leaves
  it out.
- `audio/` — sound (plan: `docs/plans/2026-11-04-sound.md`); client only, src/common has none. `audio.ts`: one
  AudioContext created on the first pointerdown, keydown or touchstart (browsers need a gesture), master → music and
  effects buses, mute (localStorage `synapse.sound`, the speaker buttons `button.sound`: pressed = sound on), suspend
  while the tab is hidden, `ctxToPerf` (context time → when it is heard, via `getOutputTimestamp`). `music.ts`: three
  tracks on their own gains from `src/assets/music/music.json` (race −9.0 dB, lounge −0.2 dB, winner −4.1 dB, all to
  −16 LUFS). The race track is ten 8-bar phrases on the bar grid, queued a second ahead (natural neighbours butt-join;
  jumps cross-fade one beat on the downbeat); modes `lounge` (the sandbox workbench: a 128-bar loop joined on itself),
  `race` (training and drive), `build` (intro ↔ breakdown, for the lobbies to come). `startRace()` jumps into the
  intro's build-up and returns the countdown's context times with Go on the drop; `win()` plays the winner once and
  returns to the mode. Files (`?url` imports via `import.meta.glob`, so hashed and cached as `assets/`) are fetched
  after first paint, the lounge first, and decoded once unlocked. `sfx.ts`: the countdown blips (F♯5; Go F♯–A–C♯ an
  octave up) and `Engine` (motor whine with speed, road roar, tyre squeal when the sides differ; every parameter eased
  with setTargetAtTime). `countdown.ts`: "5, 4, 3, 2, 1, Go" on the music when sound is on, else a plain timer with the
  same two-beat spacing. The drive view holds the car on the line until Go and then plays the recorded run from tick
  0 (hashes unchanged); the training view's solid car has a quieter engine.

## scripts
- `scripts/sim/bench.ts` — the S1 benchmark over seeds 1–20 (report, fitness CSV, path SVGs into ignored `out/bench/`).
- `scripts/checks/` — `purity.ts`, `determinism.ts` (+ `golden.json`, written only by `--update`), `bench.ts`
  (+ `bench-baseline.json`, Node time ≤ baseline × 1.3), `bench-browser.ts` (headless Chrome time + hash = Node).
- `scripts/checks/workbench.ts` — the designer in headless Chromium: the starting brain, the energy split = energy.ts,
  the rule strip and trainer picker, tray → cell selected with graph, description and energy line, bin, full sense,
  layer panel (function, live slider, energy), "+"/"−" and their limits, every edit untrained, Reset and Train
  dialogs, reload, corrupt and pre-v2 saves, and an overlap audit of cells, buttons and headers for brains up to
  8 × 8 with every sense full, light and dark, 1440×900 and 844×390; portrait card; screenshots to `out/s2/`.
- `scripts/checks/training.ts` — the training view in headless Chromium (SwiftShader): train from the designer (the
  generations popup),
  phase hash = Node's, genome saved and changed, Train again = Node's carry run, the same saved brain on 1 and 4
  workers → the same hash, Stop keeps the brain, ghost capacity, render smoke (mean luminance and spread of a real
  frame), the story (gen 1 first, in order, ending on the final generation, then the finale), bloom audit = 0,
  844×390 layout, console clean; screenshots to `out/s3/`.
- `scripts/checks/drive.ts` — train a tiny T, Drive: distance increases, drive hash = Node `runDrive` replay (also
  after New track), render smoke, bloom audit = 0, the energy line = the recorded load and its speed share, one beam
  per boundary cell along the sim's direction, every cell's spikes at 14 Hz × its rate, cameras, an untrained brain
  shows "Not moving" while the camera keeps moving, 844×390; screenshots to `out/s4/`.
- `scripts/checks/preview.ts` — the production build: `vite build`, then `vite preview` (static with SPA fallback,
  as on Vercel): the designer loads, Train from the popup (25 generations; `?T=` ignored), phase hash = Node, drive hash = Node, render smoke on
  both views, bloom audit, `?T=` ignored, deep links fall back to the app, no `/bench` in the build, console clean.
- `scripts/checks/audio.ts` — sound in headless Chromium (autoplay allowed): locked until the first click, then the
  lounge; Drive → race mode, the countdown 5…1, Go on the music, the car held at tick 0 until Go and moving after,
  Go on the drop, drive hash = Node; back → the lounge; `win()` plays the winner then the lounge again; a hidden tab
  suspends; mute silences the master and survives a reload; muted, the countdown runs on the plain timer; console
  clean.
- `npm run check` runs types, purity, unit + contract tests, determinism, the bench time check, and the workbench,
  training, drive, production-build, legal and audio checks.

## Deploy
Static site. `vite build` → `dist/` (`index.html`, hashed `assets/`: the app ~70 kB JS, the 3-D stage chunk with
three.js ~570 kB loaded on first Train or Drive, the training worker, the music: lounge 3.8 MB, ten
race phrases 3.3 MB, winner 1.0 MB, fetched after first paint). `vercel.json`: build with
`npm ci` and `npm run build`, every unknown path rewritten to `index.html`, `assets/` cached for a year (immutable),
`index.html` no-cache, nosniff and a referrer policy. The principal imports the repo in Vercel and adds the
`synapse` CNAME to `cname.vercel-dns.com` (steps in README).
