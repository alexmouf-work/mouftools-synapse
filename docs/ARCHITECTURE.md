# Architecture

What exists, updated in the same commit as the code. The intended full layout is §1 of
`docs/plans/2026-10-30-solo-loop.md`; milestone steps are in `docs/plans/2026-10-30-sandbox-loop.md`.

Milestone 1 is built: **S1** (headless sim, evolution benchmark), **S2** (the workbench), **S3** (the training view:
Train → the swarm learns on a 3-D track → the champion is saved; Keep training continues), **S4** (the drive view: the
trained car drives 60 s on an unseen track in the stadium) and **S5** (production build and Vercel config; the
principal connects the project and the domain).

## Stack
Vite + TypeScript, Three.js 0.160 (training view only, loaded on first Train), Vitest, tsx for Node scripts,
Playwright (dev only: browser bench, workbench and training checks). Multiplayer (B8) uses a Supabase project's
database through PostgREST functions (`supabase/schema.sql`); no server code of ours. The Supabase project is shared
by every Mouftools product, so Synapse's tables and functions are all prefixed `synapse_`; the file is idempotent.

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
| `sim/spec.ts` | Brain v2 shape: sense counts and hidden layers (`BrainSpec`), the fixed default brain and the random starter, column ids, the canonical wire order (`wireList`), the parameter layout (weights, biases, then each input cell's field: `paramCount`, `biasIndex`, `FIELD_PARAMS`, `fieldIndex`), `Genome`, validation. |
| `sim/senses.ts` | THE sense rules (the two boundary vector fields, short and long-range, head direction, grid, speed), shared by the sim and the designer's graphs; each cell's default tuning and its learned field (`fieldOf`, `hdOf`, `gridOf`, `speedGainOf`). |
| `sim/energy.ts` | THE energy rule: per-node coefficients, the flat-out and resting loads, the speed cap (floor 10%), the match refusal, the designer's "at maximum firing rate" figures. |
| `sim/brain.ts` | Spec → compiled net, evaluation (returns the tick's energy load), firing rates, pure edit ops, canonical genome JSON and hash. |
| `sim/track.ts` | Track families, generator + validation, the figure eight's crossing and decks, wall grid, ray cast (grid DDA, skipping the other deck), nearest-sample search; `seedOfFamily` (a seed whose track is of a given family: the picker's Shuffle, "One family" rounds, training's second track). |
| `sim/car.ts` | Skid-steer physics, walls, boost pads, progress. |
| `sim/sensors.ts` | Every sense cell's reading for a car on a track (through senses.ts, with the net's learned tuning); `bearingDir`, the one field-direction rule. |
| `sim/fieldgrad.ts` | ∂(cell reading)/∂(field parameter) for the gradient trainers (B2e, B4): head direction, grid, speed, both boundary cells' range. |
| `sim/race.ts` | `Runner`: one car for N ticks (from the start line, or a given start such as a grid slot), optional recording of frames and activations (or frames only), early stop for training (`stopCheck`, the one stop rule); `runDrive` (the drive view's 60 s run, also replayed by the checks) and `recordingHash`. `Runner.tick` takes a training-only `act` hook that sees every node value before physics and may rewrite the wheels. |
| `sim/match.ts` | vs CPU races (B7): the race seed's track (`raceTrackSeed`, a race track) and grid order (`gridOrder`), grid slots two by two behind the line (`gridPlace`, `gridCar`), `runRace` (every car its own run for the 120 s cap; finish time to a fraction of a tick after 2 laps), `rank` (finish time, then progress at the end, then slot) and the race hash. Tracks-v2 T2: a match's `MapSetting` (new track each round, one family, one track), `roundTrackSeed`, and `runRace`'s optional track seed (default the race seed's own). |
| `sim/cpu.ts` | The nine CPU brains' names and the check every stored set passes (`cpuBrains`: nine valid genomes within the match energy limit). |
| `sim/teacher.ts` | The scripted pure-pursuit teacher backprop copies (`teacherWheels`), and `driveTeacher` (the teacher alone, a reference for tests and the bench). |
| `train/trainer.ts` | Trainer interface, events, probe channels, registry with each trainer's label and refusal (`trainerRefusal`). |
| `train/env.ts` | Metered environment: the only way a trainer reaches the sim; throws before any overrun of T. |
| `train/episodes.ts` | Episode batches: `EpisodeCore` (runs policies × tracks), `splitEven`, `InlineExecutor`. |
| `train/neuroevo.ts` | Evolution. |
| `train/grad.ts` | The generalised delta rule on a compiled net (pre-activations, backward pass, Δw ∝ δ·x and Δb ∝ δ; optionally with the error given at the wheels' z, for A_RP); the gradient trainers' one implementation. |
| `train/rollout.ts` | Lanes for gradient trainers: `RolloutCore` runs a round of lanes with a kernel; lane state travels with the job. |
| `train/kernels.ts`, `train/imitate.ts`, `train/acKernel.ts`, `train/arpKernel.ts` | The kernels by id: `imitate` is backprop's (DAgger with the teacher), `actorCritic` actor-critic's (Gaussian exploration, TD(λ) with a linear critic), `arp` A_RP's (stochastic ±1 wheels, reward/penalty). |
| `train/gradTrainer.ts` | What every gradient trainer shares: rounds, fitness checks, the update, the `delta` channel. |
| `train/backprop.ts`, `train/actorCritic.ts`, `train/arp.ts` | Backprop (copy a teacher), actor-critic, A_RP. |
| `train/probe.ts` | The `signal` probe all trainers share. |
| `train/phase.ts` | Seeds for a phase and `runPhase` (setup → env → trainer → result hash; optional per-step hooks and stop; optional training tracks: `chosenTrainTracks`, the sandbox's chosen track then others of its family). |
| `train/contract.suite.ts`, `contract.test.ts`, `contract-ac.test.ts`, `contract-arp.test.ts` | The suite every trainer must pass (evolution and backprop in one file, actor-critic and A_RP one each, so no file holds a test worker for a minute). |

### Brain (v2, 2026-11-04; plan `docs/plans/2026-11-04-brain-designer-v2.md`)
A brain is its sense counts and its hidden layers; every column is fully wired to the next, always (no wiring by
hand). Senses, each up to its maximum: boundary vector (≤ 7; a wall within a 20 m field facing one way, read by
three short rays across the field; fields spread across the front), long-range boundary vector (`far`, ≤ 5; the same out to 60 m, learnable 30–80 m,
costing 1.25× a boundary cell; in the landmark cell's place since the senses plan of 2026-11-05: a save's landmark
cells load as long-range cells, weights kept, fields reset, `spec.ts migrateGenome`), head direction (≤ 8; cos(heading − preferred), preferred angles spread evenly, two = cos and
sin), grid (≤ 6; three plane waves 60° apart; the first two at two scales, more at spread phases), speed (≤ 1). Adding
a cell re-tunes the set (cells are numbered by count). Hidden layers: 1–8, each 1–8 neurons of one function
(Linear = z kept to −1..1, ReLU capped at 4, Sigmoid, Tanh); a new layer starts with two tanh neurons. The wheels are
tanh. Every hidden neuron and every wheel has a built-in bias (2026-11-04, §3ab): z = b + Σ w·x; it is not a cell
and costs nothing itself. Node order: sense cells (by sense, then cell), hidden layer by layer, wheels. A genome's
parameters are the weights in `wireList` order (column by column, source by source, then target), then the biases
in node order (`paramCount`, `biasIndex`), then each input cell's field parameters in input order (B2e, §3ad:
both boundary kinds' direction, width, range; head direction its angle; grid scale, offset x/y, orientation; speed
its gain; `fieldIndex`). Every parameter is a number within the weight cap; a field parameter of 0 is the even
spread, so an untrained cell reads exactly as before (the race goldens with fields at 0 reproduce the B2d hashes).
They map to bounded tunings (direction default + 45°·p, any; width default·2^(p/2) in 20–180°; range default·2^(p/2)
in 5–20 m or 10–40 m; head direction + 45°·p; grid scale default·2^(p/2) in 10–60 m, offset 15 m·p, orientation
15°·p; speed gain 2^(p/4), 0.5–2×), decoded into `net.tune` by `compile` and `setWeights`. Evolution mutates biases
and fields like weights (scaled by the temperature); the gradient trainers learn the biases (Δb ∝ δ) and the fields
that have a gradient (`fieldgrad.ts`: the error at each sense cell, Σ w·δ, times ∂reading/∂p). A fresh start draws weights and biases
and keeps the fields it is given. A new brain is the random starter (`starterSpec(seed)`, plan §3c: 2–6 input cells,
the count uniform, one always a boundary vector cell, the rest uniform over the five senses with repeats, three tanh
neurons; the client seeds it from crypto). `defaultSpec()` stays the fixed brain the goldens, S1 and the checks use:
one boundary vector cell, one head-direction cell, three tanh neurons. Every node has a firing rate 0..1 (`rateOf`: tanh and linear (y + 1)/2,
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
in match mode, on energy. Any edit leaves an untrained brain: every weight and bias goes back to 0 (ruling
2026-11-04: wires are grey until trained, and any edit returns them to grey). The learned fields stay (§3ad,
`carryFields`): each cell keeps its field, re-expressed against the new count's defaults; a new cell of a sense that
has learned goes in the widest gap between the others (direction, or head-direction angle); a sense that never
learned keeps its untrained spread for the new count. Boundary vector cells' untrained directions come from a fixed
table by count (`senses.ts BOUNDARY_DIRS`, match-flow v2 plan §4: mirror-symmetric, weighted to the front, reaching the
sides as the count grows; each width 0.6 × the gap to its nearest neighbour, 20–60°); long-range cells use the same table by their own count. New hidden layers and the random starter's layer
are Linear (senses plan §2); `defaultSpec()` keeps its tanh layer as the fixture.

### Car (skid-steer)
Per wheel target speed = 60 m/s × output. The car eases toward the mean side speed (accel 14, brake 30 m/s²), yaws
at (vR − vL) / 2 m capped by 32 m/s² lateral grip (S1 lever 2; the plan proposed 24) and by `yawMax` 3 rad/s (the grip cap alone is unbounded at
standstill), and loses speed to front/rear mismatch on a side (`scrub`). Walls at 12.5 m clamp the car centre to
11.5 m, keep 60% of speed, ease the heading halfway to the tangent and count one wall tick per tick. Boost pads:
+10 m/s (cap 72) once per pad per lap, not sensed. Every tick asserts the state is finite.

### Track
The seed picks one of seven families (B5, tracks plan §1–2), evenly. Tracks v2 (T1, tracks-v2 plan): every family but
the figure eight is a skeleton of straights and corners drawn by the seed: loop (4–6 left corners, one a sweep of
95–150° at 65–140 m, maybe one a hairpin), kidney (a loop with one side pushed in by a right-hand bend), chicane (four
corners, a chicane on the long back straight), dogleg (a loop with a left–straight–right step in one side), hairpin (a
tongue: out, left hairpin, back, right hairpin, out, a wide end, back and down) and clover (three leaves: stem, tip,
stem, waist; a tip may be a hairpin). The last corner takes up the slack so the lap turns 360°. The seed then places
the features (`decorate`): at least two, one a hairpin or a chicane, chosen and placed by the seed (a chicane or esses
into a straight; a double apex or a decreasing radius in place of a plain corner). The straights are scaled to a lap
of U(2150, 2850) m and the lap is closed by the least weighted change to its straights (never under 270 m for the
start, 45 m for others). The figure eight: two lobes (far straight 280–380 m, corners 45–75 m, each lobe drawn
separately) crossing at 70–110°. The lap is traced exactly (arcs and lines; no spline), resampled every ~2 m and
validated: length 2000–3000 m, smoothed radius ≥ 25 m, parts > 60 m apart along the track ≥ 31 m apart in space, a
≥ 250 m straight with |curvature| < 1/300 for the start, and for all but the eight a sweep and the features as the
detector (`detectShape`, on the smoothed curvature) finds them; 2–3 pads on the calmest 30 m windows ≥ 300 m apart.
The detector: turns are runs curving one way over 1/400 m⁻¹ (≥ 8°); same-way turns < 25 m apart are one corner; a
corner with ≥ 150° inside 120 m is a hairpin; alternating corners < 25 m apart form a chain, a chicane if two
neighbours turn ≥ 30° each within 120 m, else esses if three or more (each ≥ 12°); a corner of two turns (≥ 60° in
all) is a double apex; a lone turn of ≥ 60° whose second half is ≥ 1.3× as curved as its first is a decreasing
radius; a sweep is a turn of ≥ 90° no tighter than 60 m. `Track.features` lists what it found. A failure moves to the
next sub-seed of the same family; 200 failures throw. Mean retries over 200 seeds: dogleg 5.9, kidney 4.6, loop 2.9,
clover 2.6, chicane 1.0, hairpin 0.9, eight 0. Scenery measures how far the track reaches from its centre and puts the
ridges, the terrain's edge, the trees and the clouds beyond it.
The figure eight stays flat in the sim. Its one crossing is declared (exactly one self-crossing at 60–120°, both
passes within 1/150 m⁻¹ of straight for 75 m either side) and is the only exemption from the near-overlap rule. The
second pass from the start is the bridge: its samples within 20 m (flat) + 55 m (ramps) of the crossing have deck 1.
Each sample also has a layer (0 open, 1 the lower pass near the crossing, 2 the bridge); wall segments carry it and a
boundary ray skips the other layer's walls (`castRay(…, skip)`, `hiddenLayer`), so a car under the bridge doesn't see
its parapets and a car on it doesn't see the road below. Outside the crossing a ray sees every wall, so nothing
changes at a deck's end. A car finds its sample within ±3 of its last one and hits its own road's wall, so it never
jumps or cuts across. No start, gate or pad near the crossing.
A race track (`generateTrack(seed, cars)`, B7) also keeps its pads off the whole grid and the first 50 m: no pad
sample from 4 m behind the back row (`gridDepth(cars)` + `CONFIG.match.clearPast`: 40 m for ten cars, 400 m for 100)
to 50 m after the line (`clearAhead`). So a race track depends on the number of cars as well as the seed (a 100-car
track's pads differ from the ten-car track's on most seeds). Only races ask for race tracks, so training and drive
tracks (and their goldens) are unchanged.

### Races (vs CPU, B7; tracks plan §4)
`runRace(genomes, raceSeed)`: the race seed derives the track (any family) and a seeded shuffle of grid slots. Slot s
is in row ⌊s/2⌋, 4 m + 8 m per row behind the line (rounded to whole samples), 2.5 m left (even slots) or right (odd) of
the centreline, facing along the track; its progress starts negative, so it counts from the line. Cars pass through
each other: each car is its own `Runner` run for the whole cap (2400 ticks, 120 s; after the flag it carries on), so a
car's recording never depends on the others. A car finishes when its progress reaches 2 laps; its finish time is the
tick plus the fraction of the last tick before the line. The race ends with the last finisher, else at the cap.
Ranking: finish time, then progress at the end, then slot.
The wrong-way reset (races only, `RunOpts.wrongWay`, `putBack` in sim/race.ts): after each tick, a count of ticks in a
row in which progress fell; on the 60th (`CONFIG.match.wrongWayTicks`, 3 s) the car is put back at its furthest point
so far (`maxProg`), on the centreline sample at or just behind it, facing along the track, at rest, its progress that
sample's (so progress and position stay one), and the count starts again. The recording keeps the count per tick
(`wrong`; 60 on the put-back tick), which the race view uses to flash "Wrong way" over your car (from 1 s of falling
until 1 s after the put-back) and to jump the car without gliding. Distances are signed everywhere they are shown
(ruling 2026-11-05). Training and the drive view never set it. A race is either lapped (Multiplayer: 2 laps capped at
120 s) or timed (`ROUND_RACE`, a vs CPU round: 600 ticks, no laps, ranked by `RaceCar.dist`, the signed distance
covered from the car's grid slot). The race hash covers the track, every car's frames, finish and progress, and the
ranking; names are not hashed (determinism goldens `match`: a lapped race of the last round's CPU brains; `round`: a
timed race of the round-1 CPU brains; one race per golden seed; `phaseRaceTrack`: evolution on one race track of ten
cars, as a match's round trains).

The nine CPU players (`src/assets/cpu/brains.json` v3, written by `scripts/sim/cpuBrains.ts`, fixed seeds 1000–1008)
have a brain per round, three rounds since match polish (docs/plans/2026-11-05-rounds.md, match-flow-v2.md): each player's design grows with the edit
ops while the next step fits that round's energy budget, and is trained with evolution from fresh weights on its share
of the round's T (`CONFIG.rounds.T`, 12M; 5, 10, 17, 25, 35, 47, 60, 80 and 100%). They are named after the people behind
the methods (principal 2026-11-05): McCulloch, Pitts, Hebb, Rosenblatt, Holland, Werbos, Barto, Sutton and Hopfield,
in that order of skill (they replaced Axon … Hippo).

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
elitism 4, tournament 3, no crossover, Gaussian mutation p 0.2 with σ falling 0.4 → 0.08 over the phase (times the
temperature's multiplier 2^t, t a multiple of 0.25 in −2..2, from a fixed table so it is the same bits everywhere; a
run input like the seed: `TrainerOptions.temperature`, and a golden at ×2; actor-critic's σ and A_RP's firing
randomness take the same multiplier), reset
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
  hidden δ = f′(z)·Σ w·δ, term δ·x, and for each sense cell's field δ_input·∂reading/∂p (`fieldgrad.ts`); the
  round's update is Δw = η·(Σ δ·x)/samples, η = `backprop.lr` (0.6, constant).
  The wheels are tanh like any neuron. The teacher's targets account for the tick's speed cap. On the default v2
  brain it does not learn (no bias input, see the trainers plan); it does on brains with a steady input.
- **Actor-critic** (`actorCritic.ts`, kernel `acKernel.ts`, B4): the brain is the actor; the lanes drive a = y + σ·ε
  (ε ~ N(0, 1) per wheel, Box–Muller from counter-based draws on the lane's episode seed, so every worker draws the
  same noise; σ 0.3 falling to 0.05 over T, times the temperature's multiplier). A linear critic owned by the trainer,
  V(s) = v·φ, φ = [1, every input cell, every hidden neuron, speed / top speed], travels in the job's params and
  starts at 0 each phase. Reward per tick r = progress − 0.5 × wall touch (m), the training fitness per tick. TD
  error δ = r + γV(s′) − V(s) (γ 0.98; V = 0 after an episode ends), settled on the next tick; with eligibility
  traces (λ 0.9) e ← γλe + ∂log π/∂w (∂log π/∂y = ε/σ, carried back by `grad.ts` and into the fields by
  `fieldgrad.ts`) and e_v ← γλe_v + φ. Update per round: actor Δw = α·Σδ·e/n (α 0.1), critic Δv = β·Σδ·e_v/n (β 1).
  Traces and the open transition restart at every episode and round (`laneStart`, `episodeEnd` kernel hooks). Channels
  `signal`, `value` (per parameter, the critic's weight on the node it belongs to) and `td` (the last round's mean
  δ·e). The fitness checks drive the mean action, without the noise.
- **A_RP** (`arp.ts`, kernel `arpKernel.ts`, B4): each wheel is a stochastic unit, y = +1 with probability
  (1 + E[y])/2 else −1, E[y] = tanh(z) its own output (what it drives in a race). The lanes drive E[y] + s·(y − E[y])
  (s 0.75 times the temperature's multiplier, clamped to −1..1), spikes drawn from the lane's episode seed. One bit
  per tick: reward if the car made progress without touching a wall, else penalty. At each wheel δ = y − E[y] on
  reward, λ(−y − E[y]) on penalty (λ 0.2); that is ∂log P(y)/∂z for these units, so it is the error at z (no slope),
  and the delta rule carries it to the hidden layers and the fields. Update per round Δw = ρ·Σδ·x/n (ρ 0.5). Channels
  `signal` and `reward` (the last round's mean δ·x).
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
- `ui/title/` — the title screen (B2c; a port of `reference/title-screen-mockup.html`), which the page opens on: the
  card ("Synapse", "Build a brain. Train it. Race it.", Multiplayer in blue and vs CPU in yellow, both disabled with
  vs CPU live since B7, Multiplayer since B8, Sandbox plain), a quiet wired brain firing behind it (still under reduced
  motion), and the rail along its foot with Privacy · Terms · Cookies and the music credits (above the storage notice
  while it shows). Sandbox opens the designer; vs CPU opens its settings screen (tracks-v2 T2), then the match; the
  designer's Main menu comes back. `?view=sandbox|cpu|train|drive|race` skip it.
- `ui/tracks/` — choosing tracks (tracks-v2 T2): one picker (the families as map previews drawn with `TrackMap`, each
  with Shuffle; the chosen track's big preview with its length and features), used by the sandbox's Track dialog (top
  bar; Random first; stored as localStorage `synapse.track`; Drive opens on it and a sandbox Train trains on it, then
  another of its family), vs CPU's settings and a room's Map dialog (the three map modes). Also `synapse.name` (the
  name you play under, vs CPU and Multiplayer).
- `ui/cpuSettings/` — vs CPU's settings screen (`#cpuSet`): your name (required, 1–16), the map; Start match begins round
  1's build; Main menu; the final standings' Play again comes back here. No designer before the match.
- vs CPU (B7): the designer in match mode (`setDesignerMode('match')`, body class `match`, the lobby's building
  music): an edit past 100% flat out is refused, and a loaded brain past it says so; Train skips the generations
  popup and trains the design from scratch (every weight, bias and field 0, a fresh seed, phase 0, temperature ×1) on
  the fixed budget T, as the CPU brains did, so no racer brings extra training. The trained brain is saved like any
  run. The training view then offers Race and Back (no Drive, no Keep training). `ui/race/raceView.ts`: the race is
  computed first (`runRace`, you as car 0 with your node outputs recorded, the nine CPU brains after you), then played:
  the grid (every car on its slot, the players listed in grid order), the drive view's countdown (5…1, Go on the
  music), 2 laps capped at 120 s, a status panel (position, lap, time, the standings live with each car's colour and
  finish time) and the corner map (`training/map.ts`: every car a dot, yours ringed), then the results over the scene
  (place, name, time, distance; "You won!" or your place) with Race again (a new race seed) and Back (the match
  designer); a vs CPU round has no Skip (only the timers move a match on); Back (a room) and Main menu leave mid-race. Your car is the drive rig's yellow car
  with its engine (no beams: match-flow v2 §5); the others are solid cars in their own colours (`DriveRig.setRivals` / `placeRivals`, at
  most `MAX_RIVALS` = 11, made once and reused; a car within 8 m of the chase camera is not drawn, or the one behind
  yours on the grid fills the screen). Finishing first plays the winner music as you cross the line (`win()`), or at
  the results if you lead at the cap. `?race=` picks the first race seed (the checks). Since B8 the view takes a
  `RaceSetup` (names, genomes, which car is yours or −1 to watch, seed, and for a room the shared Go), so vs CPU and
  rooms share it: up to 100 cars, the nearest `MAX_RIVALS` = 11 to yours drawn as solid cars each frame (the drive
  rig's pool of 11, each recoloured to the car it shows), every car a dot on the map, the standings' top ten plus you,
  every car's row in the results. The drive and race views'
  panels, buttons, progress bars and the live-brain card have square corners, as the rest of the site (principal
  2026-11-04: "use square corners rather than squircles across the whole site"; the designer's bin stays round by its
  own ruling).
- `ui/designer/` — the brain designer (the workbench; B3), a port of `reference/brain-v2-mockup.html` (the UI spec)
  onto the engine: `designer.css` (the mock-up's styles), `designer.ts` (layout in equal column regions, the tray of
  senses, sense cells as 3-D symbol circles, lines of identical neurons with a function header, the car whose wheels
  are motor neurons, wires grey until trained then in their weight colours; tap to inspect; "+"/"−" for neurons and
  layers that vanish at a limit; the panel: the activation graph from the engine's own rules (polar fields with
  distance rings, the head-direction wave, the grid heatmap with a 50 m bar, transfer and speed curves, axis titles,
  axes through 0; a sense cell's graph is drawn from its learned field, with a "Learned field …" line once training
  has moved it), the one-line description, "At maximum firing rate, uses x% energy" from energy.ts, the Neurons
  slider, the bin; a trained neuron's or wheel's bias, its transfer curve plotted against Σ w·x so the bias shifts it;
  the energy split resting–flat out; Reset with a confirmation; the trainer picker and the centred
  "Learning Rule : …" strip; Train asks how many generations and, under it, the Temperature (B2d, mock-up v26: a
  log-scale slider ×0.25 to ×4 in quarter steps, default ×1, one line on what it scales; off, "—", for backprop;
  every trainer in the picker is live (B4)));
  input cells of radius 16 with their symbols at 1.7× the radius, columns spaced 2R + 6 (B2d), `symbols.ts` (three.js symbols, loaded after first
  paint, one viewport per tray tile and sense cell; build mode is still, so only a gentle idle motion), `store.ts`.
  One 860 × 400 layout scaled to fit any screen (above the storage notice while it shows). Additions to the mock-up: the Music and Sound effects toggles in the top bar; the
  wordmark is the way back to the title. No Drive button: the drive view is reached after training.
- Saving: after every change the brain is written to localStorage `synapse.brain` as `{v: 3, name, trainer, train:
  {seed, phases, temps}, genome}` (canonical genome JSON; a save from before the biases or the fields gets them at 0; `temps` holds each phase's temperature, log2 of the
  multiplier, so seed, phase and temperature reproduce every run; a save from before B2d has none: all ×1). Reads and writes are in try/catch: a missing save starts from a
  new random starter (`store.starterGenome`, as Reset does); an unreadable one starts from it with a toast; a save from before brain v2 (v1, v2) is reset to
  the starting brain with a one-time note; a v2 save from before the biases loads with every bias 0; a browser that
  refuses storage gets a toast that changes last until the
  tab closes. Any edit, and Reset, clear the training history (new seed, trains from scratch).
- `ui/training/` — the training view. Train hands the saved brain over; the seed is the brain's own (picked on its
  first Train), the phase is its count of finished runs, so every run is reproducible and a retrain sees new tracks.
  All-zero weights and biases train from scratch (fresh; the cells' learned fields are kept), anything else continues from them (carry: slot 0 is the saved genome
  exactly). `runPhase` steps one generation at a time on a `BrowserPool`. Layout (B6, `reference/training-view-mockup.html`):
  a panel of its own on the left, min(20vw, 280px) wide and full height (fitness per generation on top: best and
  mean against generations, the x-axis spanning every generation asked for, axes through 0, "gen n of N", Stop, then
  Drive / Keep training / Back and the sound toggles; below it the highlighted car's brain, live, with the drive
  view's `BrainPanel`); the camera fills the rest, with the generation on screen as a big white number at the top
  (clamp(40px, 9vh, 88px)) and a map in its bottom-right corner (`map.ts`: min(28%, 300px), 4:3, 10 px margins; the
  track, the chequered finish, every shown car as a dot, the highlighted one ringed; "64 of 64"). Every generation
  records all its agents (the whole population, as the old view showed; `showPick` picks them, seeded, and can pick
  fewer): the pool asks its workers for their track-0 paths and weights, plus the firing of the one furthest along
  (the highlighted car), so the main thread only compiles one net per generation; the ghosts of a new generation
  are added in 16 a frame. Recording never
  changes a result. The view plays the newest finished generation (render/ghosts.ts). Stop = the generation limit
  reached there (principal 2026-11-04): the pool is aborted, the generation being evaluated is dropped, and
  `runPhase` returns the best agent evaluated so far (`bestSoFar`; for evolution the last generation's champion,
  since elites keep their score), which is saved like a finished run (`{seed, phases + 1}`), with Drive and Keep
  training; a Stop before any generation finished keeps the brain as it was. While training, drawing is paced so it
  cannot starve the pool: when the typical frame (the median of the last 7; the first 3 always draw) costs > 8 ms,
  drawing is kept to about a fifth of the main thread, waiting at most 1 s between frames, and a software rasteriser
  (which renders on the workers' CPU cores) draws 4 frames a second. Pacing on the last frame alone used to stall
  the view for five times a one-off spike (a 2 s first-frame shader compile left a round's view blank for 10 s).
  **Ready at once** (principal 2026-11-05, "it takes ages for anything to load in"): a round's build phase calls
  `prewarmTraining` 0.6 s in (`rounds.ts`, `roomRounds.ts`): it starts the worker pool, makes the stage, builds the
  round's training track 0 (known from the match's training seed) and compiles its shaders (`Stage.warm`:
  `compileAsync`, parallel where the browser allows, then one draw for the passes' and the shadow map's). The train
  phase takes that pool and keeps that scene (`Stage.setTrack` skips a training track already built); without a
  warm-up the workers still start before the scene is built, and generations that finish first wait for it. The
  ghost mesh has its per-instance colours from the start, so the first ghosts draw with the shader compiled ahead.
  `__training.timeline` records each milestone in ms from the phase start (stage, track, scene, frame1 and its
  cost, workers, ready, gen1, ghosts, dots, brain). Measured at 1920×1080 on SwiftShader, forced to the high-quality
  path a desktop GPU takes (?quality=high): ghosts at 4.5 s (dev) / 4.8 s (built) before, 0.4–0.7 s after; on the
  low path 1.9 s before, 0.4–0.8 s after. Display only: no result changes.
- `render/` — the 3-D port of `reference/look-mockup.html`'s core: `stage.ts` (renderer, ACES, bloom, sky dome, fog,
  sun and shadows, the training camera: a chase angle ~44 m up, following the highlighted car closely (it moves
  at 12×; a new generation cuts instead of flying across), or the champion in the finale; bloom audit), `car.ts` (the mock-up's solid race car), `drive.ts`
  (the drive rig: the yellow car with each wheel spinning at 18 rad/s × its output, so it reverses visibly; one ray
  per boundary vector cell along its field's centre via `sensors.bearingDir`, up to 20 m, brighter as a wall nears;
  chase, broadcast and showroom cameras, and a race's director, mode `race`: broadcast shots for 5–8 s and the onboard
  POV, rigid on top of the back of the followed car with a slight vibration, for 4–6 s, cut by themselves, none in the
  first 2 s or sooner than 3 s after the last, the POV wherever no spot covers the car; match polish §3), `stadium.ts`
  (grandstand with crowd and SYNAPSE banner, start and checkpoint gates, SYNAPSE billboards, floodlights, chevron boards
  on tight corners, broadcast camera spots: each covers a stretch of road and every sight line from it to that stretch
  misses every box of scenery, `sight.ts`; trees keep out of those corridors, and a hill never rises into one,
  tests/unit/sight.test.ts), `trackMesh.ts` (road, kerbs red/white in corners,
  run-off, walls with light strip, boost pads, the start/finish line as a chequered band of four rows of 1 m squares,
  from the sim Track; flat except the figure eight's bridge: 7 m over the crossing on cosine ramps, its walls the
  parapets, an underside and pillar pairs every 14 m that stand clear of the road below; `liftAt`/`sampleOf` give a
  car's height and pitch from its recorded progress, never a nearest-sample search), `finish.ts` (a chequered flag on a black pole each side of the finish line, in
  the run-off, the cloth reaching away from the road), `scenery.ts` (terrain,
  tree groves, clouds; seeded by the track), `textures.ts`, `ghosts.ts` (the training playback, B6: one InstancedMesh of 64,
  made once, a new generation's ghosts added in 16 a frame, the highlighted one first; the newest finished generation replays at 12× as see-through cyan ghosts, the highlighted car warm
  yellow; a newer generation takes over after a 2 s minimum; each one is shown at most once, in order, and starts
  further into its episode than the one before (offset = (g − 1)/(N − 1) of the latest start that leaves 2.5 s to
  watch, never shrinking); with nothing newer the last frame holds (ended cars stay faintly where they stopped); when
  training ends the champion's lap loops as the solid car, never generation 1 again. Wall contact flashes red; an
  episode that ended early stays put, flashing red as it fades), `guard.ts`
  (finite-geometry and finite-matrix asserts, instance capacity asserts — all throw). Quality: `low` (pixel ratio 1,
  no shadows, no MSAA; bloom kept) is picked for software rasterisers (SwiftShader, llvmpipe), `high` otherwise.
  Bloom: threshold 1.3; all scene light is scaled by 0.6 and the exposure by 1/0.6, so lit scenery (max ≈ 1.17) stays
  under it and only glow-tagged things (wall strips, boost pads, lamps, gate bands, sun disc) bloom; `bloomAudit`
  renders the scene without them to a float target and counts pixels over. The checks audit fixed frames
  (`auditTrainAt` / the drive view's `auditAt`: seek, snap the camera, draw, audit), so a pass means pass. The car's
  coats are satin (roughness ≥ 0.45; the paint near matte, 0.7): mirror-sharp coats threw sun glints up to 3.6 at some poses,
  and driving into a low sun the glossier paint (1.8) and kerbs (1.38) still went over, so kerbs, run-off and walls are
  rough (0.8) too, and the pale floodlight poles and stand roof satin (0.75) (found by the bloom audit after brain v2).
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
  wheels with their speed. No beams are drawn from the car (match-flow v2 §5, "don't show lasers"); the drive check
  asserts none. Drive is offered by the finished training view.
- `bench/index.html` → `bench/main.ts` (dev only) runs one phase in the browser on `BrowserPool`; `vite build` leaves
  it out.
- `audio/` — sound (plan: `docs/plans/2026-11-04-sound.md`); client only, src/common has none. `audio.ts`: one
  AudioContext created on the first pointerdown, keydown or touchstart (browsers need a gesture), master → music and
  effects buses, two toggles (`button.sound.music`, a note, mutes the music bus; `button.sound.sfx`, a speaker, mutes
  the effects bus; pressed = on; a pair on the title, in the top bar and in the training, drive and race views' action rows; the master stays
  at 1; localStorage `synapse.sound` as `{"music":true,"sfx":true}`, the old `off` / `on` read as both), no
  suspending in a hidden or unfocused tab (the toggles are the only off switches), level meters on the master and
  each bus for the checks, `ctxToPerf` (context time → when it is heard, via `getOutputTimestamp`). `music.ts`: three
  tracks on their own gains from `src/assets/music/music.json` (race −9.0 dB, lounge −0.2 dB, winner −4.1 dB, all to
  −16 LUFS). The race track is ten 8-bar phrases on the bar grid, queued a second ahead (natural neighbours butt-join;
  jumps cross-fade one beat on the downbeat); modes `lounge` (the sandbox workbench: a 128-bar loop joined on itself),
  `race` (training and drive), `build` (intro ↔ breakdown: the title). Between tracks, an equal-power cross-fade of
  about 0.6 s centred on the outgoing track's next beat; the title's pool is fetched first, then the lounge. `startRace()` jumps into the
  intro's build-up and returns the countdown's context times with Go on the drop; `win()` plays the winner once and
  returns to the mode. Files (`?url` imports via `import.meta.glob`, so hashed and cached as `assets/`) are fetched
  after first paint, the lounge first, and decoded once unlocked. `sfx.ts`: the countdown blips (F♯5; Go F♯–A–C♯ an
  octave up) and `Engine` (motor whine with speed, road roar, tyre squeal when the sides differ; every parameter eased
  with setTargetAtTime). `countdown.ts`: "5, 4, 3, 2, 1, Go" on the music clock once audio is unlocked (whichever toggles
  are off), else (locked) a plain timer with the same two-beat spacing. `racing.ts`: THE teardown for racing sounds (engines fade, every scheduled countdown blip is
  cancelled), called by the arena whenever its view changes or it is hidden, which every exit goes through. The
  drive view holds the car on the line until Go and then plays the recorded run from tick
  0 (hashes unchanged); in the training view the highlighted car (then the champion) has a quieter engine.

- Landscape only (B9, `ui/landscape.ts`): an upright phone or tablet (`(orientation: portrait) and (max-width:
  899.98px)`) gets `#rotate`, "Turn your phone sideways", as a modal dialog over everything (the page under it is
  inert; Escape doesn't close it); it closes when the screen turns. `screen.orientation.lock('landscape')` is tried at
  start and on entering fullscreen, a refusal ignored. No portrait layout rules remain; a tall desktop window (shorter
  side ≥ 900 px) never gets the card.
- Multiplayer (B8, lobby B9): `net/rooms.ts` calls the database's functions (`synapse_open_room`, `synapse_join_room`, `synapse_leave_room`,
  `synapse_remove_player`, `synapse_room_state`, `synapse_submit_brain`, `synapse_start_race`, `synapse_race_entries`, `synapse_submit_result`) over PostgREST with the anon key; the build maps
  `SUPABASE_PROJECT_URL` and `SUPABASE_ANON_KEY` in through Vite `define` (`__SUPABASE_URL__`, `__SUPABASE_ANON_KEY__`,
  declared in `env.d.ts`; empty: Multiplayer says it isn't set up); the service role key is read nowhere. Every reply
  carries the server's clock, so Go is the same moment on every client. Nothing is stored in the browser: your player's
  secret token lives in memory (the database keeps only its SHA-256). `ui/lobby/lobby.ts` (+ `lobby.css`, from
  `reference/multiplayer-lobby-mockup.html`) is Multiplayer's own screen (`#mp`): (1) one 4-letter code field whose
  fourth letter checks the room with `synapse_room_state` (none: "No room with that code…", full: "That room is full…", the
  letters selected), or Create a room (`synapse_open_room`: a code, no players, the host's token); (2) your name on its own
  screen (the code and how many are in; 1–16 characters, spaces collapsed; a name already in the room, any case, is
  refused here and by `synapse_join_room`; a chip preview; Go in → `synapse_join_room`, the host recognised by the token the room was
  opened with); (3) the lobby: a header (code, "n / 100", "players · r ready", a legend, the host's Start race (r),
  enabled at 2 ready, or "You're in"), a field of name chips (`.chip`: the car colour's square, filled once the brain
  is in; yours in your car's yellow with an accent border; others the race colours in join order), and a footer (Build
  your brain / "Brain handed in · Edit", a note, the sound toggles, Leave room → `synapse_leave_room`). Chips pop in (none
  under reduced motion) and are scattered: each new chip tries 80 random spots (display only) and keeps the one
  overlapping least, kept as fractions of the free space so a resize holds the layout; the font is clamp(11,
  √(field area / max(n, 8)) / 6.2, 17) px; on a short screen (height ≤ 540 px) with more than 60 in, rows instead
  (the field scrolls). The host taps another chip → "Remove <name>" → `synapse_remove_player`; the removed client sees it on
  its next poll and goes back to the code screen ("The host removed you from the room."), now or when it comes back
  from building or racing. Closing the tab leaves the room (`synapse_leave_room`, keepalive), so names free up. Polled every
  1.5 s while you are in a room. Build your brain is the match designer; training ends
  with Hand in (your genome's canonical JSON goes to the room). The host's Start race freezes the entries (every player
  with a brain in, in join order) and draws the seed, Go 12 s later; every client fetches the same entries, leaves out
  anything that isn't a valid brain within the match limit (the same rule on every client), computes the race
  itself and counts down to Go (`countdown.ts countdownTo`: the same two-beat spacing, blips on the effects bus; it
  can't follow each client's music). A client that is late joins the race where it is. Results go back to the room
  (place, time, distance). Back to room returns to the lobby.
- Multiplayer since tracks-v2 T2 (the paragraph above predates the timed rounds; see the match-flow v2 and tracks-v2
  plans): the host's chip has a "Host" tag and the header "Host: <name>"; the server hands the room to the player who
  joined earliest when the host leaves (`synapse_rehost`), and `Me.host` follows the polled state. A Settings panel
  beside the chips: max players (2–100, never below the number in; `synapse_join_room` refuses past it) and the map,
  set by the host with `synapse_set_settings`, read-only for others, locked while a match is on. Each round's track is
  `roundTrackSeed` of its race seed under the room's map, on every client. The final standings' Play again returns
  everyone to the lobby, where the host starts the next match.
- Match polish (docs/plans/2026-11-05-match-polish.md): vs CPU and Multiplayer are 3 rounds (`CONFIG.rounds`: build 60,
  20, 20 s; budgets 20, 40, 64%; `common/schedule.ts` and supabase/schema.sql agree), scored by each player's best
  single-race distance, ties to the total (`match.ts matchScore`/`byScore`); the standings show "Race n" and "Best". A
  round trains on its race track only, as a race track of the race's cars (`EpisodeSetup.raceCars`; a room counts the
  players in since the round's build). The race clock is measured from Go's timestamp: playback, the race timer
  (`startPhaseTimer`'s `until`) and "finished" all count from it. The training, race and drive sidebars have a top row
  of Main menu and the sound toggles (44 px); the training and race sidebars split the rest in two halves.

## scripts
- `scripts/sim/cpuBrains.ts` — trains the nine CPU brains (B7) and writes `src/assets/cpu/brains.json` (about 40 s on
  4 workers), printing each one's median progress in 120 s alone on ten race tracks.
- `scripts/sim/raceCost.ts` — what a race costs to compute: 10 and 100 entries × the 120 s cap, best of 3 (B8).
- `scripts/sim/bench.ts` — the S1 benchmark over seeds 1–20 (report, fitness CSV, path SVGs into ignored `out/bench/`).
- `scripts/checks/` — `purity.ts`, `determinism.ts` (+ `golden.json`, written only by `--update`; a short phase of
  every trainer, inline = 4 workers), `bench.ts`
  (+ `bench-baseline.json`, Node time ≤ baseline × 1.3), `bench-browser.ts` (headless Chrome time + hash = Node).
- `scripts/checks/fixture.ts` — every page a check opens starts with `defaultSpec()`'s brain saved (an init script that
  writes only when nothing is stored), so the checks compare against the same Node runs as before the random starter.
- `scripts/checks/workbench.ts` — the designer in headless Chromium: the starting brain, Reset to a valid random starter, the energy split = energy.ts,
  the rule strip and trainer picker, tray → cell selected with graph, description and energy line, bin, full sense,
  layer panel (function, live slider, energy), "+"/"−" and their limits, every edit untrained, Reset and Train
  dialogs, reload, corrupt and pre-v2 saves, a learned field drawn by the inspector and a save from before the fields
  loading quietly, and an overlap audit of cells, buttons and headers for brains up to
  8 × 8 with every sense full, light and dark, 1440×900 and 844×390; the portrait card (modal, no way to stay in
  portrait); screenshots to `out/s2/`.
- `scripts/checks/training.ts` — the training view in headless Chromium (SwiftShader): train from the designer (the
  generations popup),
  phase hash = Node's (actor-critic at ×2 and A_RP too, with their Temperature hints), genome saved and changed, training again = Node's carry run, the same saved brain on 1 and 4
  workers → the same hash, Stop saves the best agent so far (= Node stopped there = Node asked for that many
  generations) and offers Drive / Keep training / Back, render smoke (mean luminance and spread of a real frame),
  the layout at 1440×900 and 844×390 in light and dark, mid-training and at the end (panel width, camera, map
  corner and size, the big white number), all 64 ghosts with no frame spike as they come in, every generation
  offered and shown in order, never twice,
  each after the minimum and starting further along, then the champion's lap, no main-thread spike, two finish
  flags, bloom audits at the start line, mid-run and in the finale, console clean; screenshots to `out/s3/`.
- `scripts/checks/drive.ts` — train a tiny T, Drive: distance increases, drive hash = Node `runDrive` replay (also
  after New track), render smoke, bloom audit = 0, the energy line = the recorded load and its speed share, no beams
  drawn, every cell's spikes at 14 Hz × its rate, cameras, an untrained brain
  shows "Not moving" while the camera keeps moving, 844×390; screenshots to `out/s4/`.
- `scripts/checks/preview.ts` — the production build: `vite build`, then `vite preview` (static with SPA fallback,
  as on Vercel): the designer loads, Train from the popup (25 generations; `?T=` ignored), phase hash = Node, drive hash = Node, render smoke on
  both views, bloom audit, `?T=` ignored, deep links fall back to the app, no `/bench` in the build, console clean.
- `scripts/checks/audio.ts` — sound in headless Chromium (autoplay allowed): locked until the first click, then the
  lounge; Drive → race mode, the countdown 5…1, Go on the music, the car held at tick 0 until Go and moving after,
  Go on the drop, drive hash = Node; back → the lounge; the music never silent for over 0.8 s from title to back;
  `win()` plays the winner then the lounge again; leaving training, a countdown or a drive leaves no racing effect;
  a hidden tab keeps playing; the toggles are independent (music off: the music bus silent, blips and engine heard;
  effects off: no blip or engine, the music heard), agree across all six pairs (the lobby footer has one too) and survive a reload; the old
  `off` / `on` migrates; locked, the countdown runs on the plain timer; console clean.
- `scripts/checks/title.ts` — the title in headless Chromium: it opens first; Multiplayer (blue) and vs CPU (yellow)
  enabled; vs CPU → the match designer → wordmark → title; Sandbox → designer (sandbox mode); the rail's links resolve and carry the credits, the
  rule strip doesn't; an overlap audit at 1440×900 and 844×390, light and dark; the notice sits below the rail; landscape
  only: the card over an upright phone (modal: nothing under it takes a tap; Escape keeps it), gone when turned and back
  when upright again, on a 820×1180 tablet, never on a 1000×1300 desktop window.
- `scripts/checks/race.ts` — vs CPU in headless Chromium: the match designer refuses a design past 100% flat out;
  Train skips the popup and trains from scratch on the budget (saved = Node's run); training ends with Race and Back;
  ten cars on the grid where `gridCar` puts them, the players in grid order, the countdown, race hash and ranking =
  Node `runRace`, every car where Node has it mid-race, ten map dots, standings, render smoke, bloom audits on the grid
  and mid-race, Skip → the results table = Node, Race again (new seed), Back (still vs CPU); a race you win (the
  strongest CPU brain as yours) plays the winner music as you cross the line; 844×390 layout; a round's training view
  at 1920×1080 shows its ghosts, map dots and brain card within 2 s of the train phase (readied in the build);
  screenshots to `out/race/`.
- `scripts/checks/standin.ts` — a local stand-in for the Supabase project: the same functions as `supabase/schema.sql`
  behind the same PostgREST shape, in memory, checking the anon key (with T2's settings, max players and host handover).
- T2 additions to the checks: check:workbench (the Track picker), check:race (vs CPU's settings screen and the map
  modes), check:multiplayer (host tag and header, settings, max players, the map on every race, locked mid-match, Play
  again → lobby, host handover), check:legal (the cookie table's keys, notice version 3), check:title (vs CPU → the
  settings screen).
- `scripts/checks/multiplayer.ts` — Multiplayer in headless Chromium against the stand-in: the code screen (the
  fourth letter checks; a code with no room says so and selects the letters), Create a room → the name screen (spaces
  collapsed, counter, preview) → the lobby as host; a guest's code → the name screen, the host's name refused (any
  case) there and by the server; both chips (fitting, apart, yours marked); only the host can start; a third player on
  a landscape phone (the lobby fits), removed by the host (back on the code screen saying so; a player's tap does
  nothing), the name free again, Leave room; both players train
  in match mode (= Node) and hand in (chips filled, Start race (2)); 98 more players from Node fill the room to 100
  (one with a brain past the limit) and a 101st is refused; 100 chips scattered inside the field at 1440×900, in rows
  at 844×390 (the field scrolls); Start race: the same race on both clients = Node, Go at the same moment, 99 cars (the
  over-limit one left out), the 11 drawn in 3-D are the nearest, 99 map dots; results = Node; results reach the room;
  Back to room; the page's defines carry the URL and anon key, never the service role key; prints the page's compute
  time for the race. Screenshots to `out/multiplayer/`.
- `npm run check` runs types, purity, unit + contract tests, determinism, the bench time check, and the workbench,
  training, drive, production-build (now also: the build carries the URL and anon key, never the service role key),
  legal, audio, icons, title, race and multiplayer checks.

## Deploy
Static site. `vite build` → `dist/` (`index.html`, hashed `assets/`: the app ~70 kB JS, the 3-D stage chunk with
three.js ~570 kB loaded on first Train or Drive, the training worker, the music: lounge 3.8 MB, ten
race phrases 3.3 MB, winner 1.0 MB, fetched after first paint). `vercel.json`: build with
`npm ci` and `npm run build`, every unknown path rewritten to `index.html`, `assets/` cached for a year (immutable),
`index.html` no-cache, nosniff and a referrer policy. The principal imports the repo in Vercel and adds the
`synapse` CNAME to `cname.vercel-dns.com` (steps in README).
