# Brain designer v2: design plan (for agreement before mock-ups)

Status: built (B2 engine + B3 designer, 2026-11-04; "please build all the changes"); notes and the S1 re-benchmark in
"As built" at the end. Rulings it rests on are in `docs/CONTEXT.md` (2026-11-04).

## The idea in one line
The designer reads like a nervous system: **senses** on the left, shown as living 3-D symbols; a **cortex** of
identical neurons in the middle; the **body** on the right, the car itself, whose wheels are motor neurons. Everything
that fires flashes yellow at its own rate, so you can watch the computation happen.

## 1. One kind of neuron per layer (2026-11-04: "all neurons in a given LAYER will have the same processing")
- Each hidden layer has one transfer function, set on the layer's header; the wheels are fixed to tanh (full reverse
  to full forward). The text below that says "whole brain" now means "the layer".

## 1a. (superseded wording) One kind of neuron per brain
- The brain has one transfer function, chosen once for the whole brain: step, ReLU, sigmoid or tanh. The per-neuron
  picker goes.
- Why it's logical: a brain is built from one kind of unit; the choice becomes a single, legible decision with clear
  trade-offs (cost per neuron, how it fires, which trainers can use it: backprop can't learn through step).
- Every neuron has a **firing rate** from 0 to 1, shown as yellow flashes up to 14 per second:

| Function | Firing rate | At rest (no input) |
|---|---|---|
| Step | 0 or 1: silent or flat out | silent |
| ReLU | rises from 0, saturates at 1 | silent |
| Sigmoid | smooth 0 to 1 | half rate |
| Tanh | (tanh + 1) / 2 | half rate: excitation speeds it up, inhibition slows it down |

  The maths passes the function's own value downstream (tanh stays −1..1); the flash shows the rate.
- Wheels are motor neurons on the car: wheel speed = 2 × rate − 1 (full reverse at 0, stop at 0.5, full forward at 1).

## 2. Senses: the input side (agreed 2026-11-04, round 2)
- Each input cell is **a circle with its sense's 3-D symbol inside**, flashing yellow at its firing rate. A cell is
  **on the field only while it's in use**: you add cells from a tray of senses, and remove them from the field. This
  replaces the fixed pins (ruling 2026-10-30) and the dots-on-a-tile idea.
- Adding a second, third… cell of the same sense **re-tunes them all to spread evenly** (directions, phases, places).
- Senses are named after the real rat cells they imitate (principal: "Use the real names"):

| Sense | Symbol (animated, matte low-poly) | Each cell fires… | More cells of the type |
|---|---|---|---|
| Boundary vector cells | a wall section | the nearer a wall within its field, which faces one way from the car | fields spread across the front: 1 ahead, 2 at ±45°, 3 left/ahead/right … |
| Whisker cells | whiskers | only when a wall is very close (short range, cheap) | spread around the car's sides |
| Landmark cells (were object-vector) | a chequered flag | when the finish line is within range | as boundary cells |
| Place cells | a tree | when the car is inside its place field on the track | fields spread evenly round the lap; remap on a new track |
| Head direction | a turning circular arrow | as cos(heading − preferred angle) | preferred angles spread evenly (2 = cosine and sine) |
| Grid cells | a sliding hexagonal lattice | at the vertices of its hexagonal grid | first two take two scales; more take spread phases |
| Speed cells | a speedometer needle | faster the faster the car goes | one is enough (max 1) |

Removed (principal): road ahead, energy left, bias. With no bias input, a neuron's resting rate comes from its
function alone (tanh and sigmoid idle at half rate; step and ReLU idle silent).

## 3. The world (my default; overturn freely)
Boundary, whisker and object-vector cells read the surroundings, so they work on any track. Head-direction, grid and
place cells are anchored to the world, so they pay off when it stays the same: sandbox keeps your track until
"New track"; a match keeps one track for all rounds.

## 3ad. Receptive fields learn (2026-11-04)
"I want you to allow the input cells to vary their receptive fields / input fields / graphs as they learn." Each input
cell's tuning becomes part of what training learns, within bounds:
| Sense | Learns | Bounds |
|---|---|---|
| Boundary vector | field direction, field width, range | any direction; width 20–180°; range 5–20 m |
| Landmark | field direction, field width, range | any direction; width 20–180°; range 10–40 m |
| Head direction | preferred angle | any |
| Grid | scale, phase (x, y), orientation | scale 10–60 m |
| Speed | gain (how fast it saturates) | 0.5–2× |
- New cells start where today's re-tuning puts them (spread evenly). Adding a cell to a trained brain keeps the other
  cells' learned fields and puts the new one in the widest gap; removing one leaves the rest as they are.
- Evolution mutates every field parameter (scaled by temperature). Backprop learns those with a gradient (head
  direction, grid, speed, and boundary/landmark direction and width through the smooth angular tuning); where there is
  none, the field stays as it is. Energy costs don't change with the field.
- The inspector graphs (polar maps, the HD wave, the grid heatmap, the speed line) draw the learned field, so you can
  watch a cell's field change from one training run to the next.

Built (B2e, 2026-11-04):
- Each input cell's field parameters follow the biases in the genome (boundary and landmark 3: direction, width,
  range; head direction 1; grid 4: scale, offset x, offset y, orientation; speed 1: gain), each a number within the
  weight cap like a weight, 0 = the even spread. Mappings (senses.ts): direction = default + 45°·p; width =
  default·2^(p/2) in 20–180°; range = default·2^(p/2) in 5–20 m (boundary) or 10–40 m (landmark); head direction
  + 45°·p; grid scale = default·2^(p/2) in 10–60 m, offset 15 m·p, orientation 15°·p; speed gain 2^(p/4), 0.5–2×.
  With every field at 0 the sim is bit-for-bit what it was (the race goldens recomputed with zero fields equal the
  B2d ones); the goldens change only because genomes are longer (random test weights and evolution's mutation draws).
- Evolution mutates every field parameter like a weight (σ times the temperature; fresh starts keep the given fields
  rather than drawing them). Backprop learns, through the error at each sense cell: head direction (angle), grid
  (scale, offset, orientation), speed (gain), landmark (direction, width, range) and boundary (range only). A
  boundary cell's direction and width have no gradient: its three rays decide which wall they hit, not how strongly
  it fires, so those stay where they are under backprop. Finite differences confirm every gradient (unit test).
- Edits keep the learned fields; a new cell of a sense that has learned goes in the widest gap between the others;
  a sense that never learned keeps the even spread. A save from before (weights, or weights and biases) loads with
  every field at its default. The inspector draws the cell's learned field and, once trained, a "Learned field …"
  line (e.g. "18° · 60° wide · 20.0 m"); the drive view's beams follow each boundary cell's learned direction and
  range.

S1 on the default brain (seeds 1–20, T 6M, 60 s episodes, Node 4 workers, build container):

| | evolution, B2b | evolution, B2e | backprop, B2b | backprop, B2e |
|---|---|---|---|---|
| final training fitness, median | 3065 (20/20 ≥ 500) | 3106 (20/20 ≥ 500) | 120 (0/20 ≥ 500) | 121 (0/20 ≥ 500) |
| gate: end ≥ 1.5× start | 20/20 | 20/20 | 19/20 | 19/20 |
| (a) median 30 s on the unseen track | 1446 m (×15.6) | 1403 m (gen 1: 93 m, ×15.1) | 162 m | 182 m |
| (b) ≥ 80% of a lap in 30 s | 15/20 | 15/20 | 0/20 | 0/20 |
| (c) end ≥ 2× gen 1 | 19/20 | 19/20 | 19/20 | 19/20 |
| (d) Minimal (1 boundary, 1 linear) ≥ 50% of a lap | 17/20 | 18/20 | 0/20 | 0/20 |
| 60 s: ≥ 1.6 laps / Minimal ≥ 1 lap | 13/20 / 15/20 | 12/20 / 14/20 | 0/20 / 0/20 | 0/20 / 0/20 |
| (f) same seed → same hash; 1 vs 4 workers | pass | pass | pass | pass |
| phase time, median (max) | 3.88 s (4.56) | 3.86 s (6.00) | 6.31 s (11.0) | 7.16 s (8.19) |

Evolution is level with B2b (within seed-to-seed noise: the runs differ from the first mutation, since genomes are
longer). What it does with the fields, seeds 1–5: it turns the boundary cell 7–35° to the right of the nose and
narrows it (60° → 34–60°), keeps its 20 m range, and moves the head-direction cell 10–22° either way. Backprop
moves only the head-direction angle (±3°) and leaves the boundary range at 20 m; it still copies the teacher from
inputs that cannot see the road, so it still creeps (as B2b). Backprop's phase is about 1 s slower (the field terms
every tick); the machine was also slower than for B2b.

## 3ac. Temperature: how boldly training explores (2026-11-04)
"let's add a temperature slider as well somewhere." → "Training exploration", "In the Train popup". Under the
generations choice: Temperature, a log-scale multiplier ×0.25 to ×4 (default ×1, the tuned value), on the chosen
trainer's own exploration: evolution's σ (mutation size), actor-critic's exploration, A_RP's firing randomness. It's
disabled for backprop, which copies a teacher and has nothing to explore; one line under the slider says what it does.
The run records the temperature with the brain's training history.
Built (B2d): the slider is −2..2 in steps of 0.25 (log2 of the multiplier), shown as ×0.25 … ×4.0; evolution's σ is
multiplied by 2^t (exact quarter-step table, so every engine gets the same bits); the run takes it as an input like
the seed (`TrainerOptions.temperature`) and records it per phase in the save (`train.temps`); backprop ignores it and
the slider is off. Actor-critic and A_RP will take it when they are built (B4). A determinism golden covers a phase
at ×2 (inline = 4 workers, and different from ×1).

## 3ab. Every neuron has a built-in bias (2026-11-04)
Without the bias cell, a quiet brain outputs zero and can't hold "drive forward": backprop failed to learn and the
default brain drove a median 7 m on a new track. Principal: "the neurons can have a bias internally as well, that's
totally fine by me." Every hidden neuron and every wheel gets a learned bias (its resting level, like a real neuron's
threshold). Not a cell on the board, no energy cost of its own; both trainers learn it (backprop: Δb = η·δ). The
inspector shows it once trained, and the neuron's transfer curve shifts with it.

## 3aa. Twice the energy; no limit in the sandbox (2026-11-04)
- "increase the max energy allowed for a brain by 2x": every cost is halved (senses 1–1.5%, neurons 0.75–1.5%, wires
  0.075%, wheels 0.75%), so the same brain uses half the supply. Default brain: 4–11%, speed 89–96%.
- "remove the max energy allowed in sandbox mode": the sandbox refuses nothing. A brain past 100% just leaves less for
  speed, which never drops below 10% so every car can still move (my default). vs CPU and Multiplayer keep the 100%
  limit at the new costs.

## 3a. Speed follows firing (2026-11-04, replaces the fixed split below)
"the speed is higher when less neurons fire per tick." Each tick, every cell spends its cost × its firing rate (a wire,
its cost × its source's rate); what is left of the supply is that tick's top speed. A design is still refused if it
would pass 100% with everything firing flat out, so speed never reaches zero. In build mode the bar shows the range,
resting to flat out (e.g. brain 8–23%, speed 77–92%); while active it shows the current tick. Teaching point: quiet,
sparse brains run faster; ReLU idles silent, tanh and sigmoid idle at half rate and pay for it.

## 3b. (superseded) Energy is an allocation: brain power against speed (agreed 2026-11-04)
- One supply, always 100%, split two ways: **brain** (cells on the field, neurons, wires) and **speed** (the rest).
  Top speed scales with the speed share. Fixed by the design (principal: "Fixed by design"); it doesn't move while
  driving.
- The top bar is one split bar, brain against speed, with the 50/50 "mean car" marked. A design can't pass 100%: an
  addition that would is refused, with the reason.
- Retired with it: the noise rule, the per-minute pool, the energy-left input.
- Training still rewards distance, so evolution must find the balance. The speed curve is tuned with the benchmark.

## 3c. The default brain (2026-11-04)
One boundary cell, one head-direction cell, one hidden layer of three neurons, the four wheels. About 23% brain / 77%
speed. When v2 is built, the learning benchmark must be re-run on this brain: a two-input brain may not lap, which is
fine for a starting point but changes what the S1 criterion can promise.

## 4. The cortex: hidden layers
**Wiring is fixed (2026-11-04):** every layer is fully connected to the next, always; there is no wiring or unwiring.
The player can only inspect cells, add or remove cells (and layers of cells), and set each layer's function. The
forgiving tap-to-wire idea from round 2 is dropped.

- Lines of identical neurons, as today. Default: each layer fully connected to the one before (ruling 2026-11-04).
- Limits (2026-11-04, revised): up to **8 hidden layers × 8 neurons** (64 hidden neurons); a new layer starts with
  **two** neurons (the default brain keeps its three); 8 neurons a layer, each sense its own maximum. At a limit the "+" goes
  away (a full sense's tile loses its "+" and dims); no warnings. Columns share the width evenly unless the inputs or
  the car need more; with many layers the function chip shows its curve only and the bottom-row buttons shrink to fit.
  (Superseded: "up to 10 layers" became 8.)
- No Drive button in the designer: the brain fires while it trains and is still otherwise.
- The layer panel: the four functions, then a **Neurons slider** (1–8, the layer resizes live as you drag; where the
  energy rule applies, a refused size snaps back), then the layer's energy (no description line).
- Energy is shown as "At maximum firing rate, uses xx% energy": a cell or neuron counts its own cost plus the wires it
  drives; the layer panel shows the whole layer, live with the slider (2026-11-04).
- Layers: a "−" at the foot of each hidden column (in the row of the boundary "+"s) removes it; "−", neurons and
  "+" share one even spacing; minus and plus are drawn alike. Reset (top bar) returns to the starting brain after a
  confirmation. Square corners everywhere; circles stay circles (2026-11-04).
- Wires keep their weight colours: red −1, black 0, green +1, thicker and brighter with size, but only once the
  brain is trained; before that (and after any edit) they are plain grey (2026-11-04).
- A "+" under each layer's neurons adds one and a "−" above them removes one; a "+" at the foot of each column
  boundary inserts a layer and a "−" at the top of each hidden column removes it (2026-11-04).
- Click any cell to see what it does and what it costs. A full "inside the neuron" view (sum of inputs × weights →
  function → rate) can follow once the layout is agreed.

## 5. The body: the output side
- The car sits on the right, front facing right (the direction signals travel), drawn as the race car, top-down.
- Its four wheels are the motor neurons: they flash at their rate, and a small arrow on each shows its speed and
  direction.

## 6. Build mode is still (2026-11-04, supersedes "always running")
While you build, nothing fires: no flashes, no wheel arrows. Cells and neurons fire only inside an active brain, while
training or driving. The sense symbols keep a gentle idle motion.

## 6b. Each cell's activation pattern (2026-11-04)
Functions offered (2026-11-04): Linear, ReLU, Sigmoid, Tanh (no step). Heatmaps run cold to hot: blue, green,
yellow, red.
Tapping a cell shows a graph of what makes it fire, in the right-hand panel (no "tuning" text):
- Boundary vector and landmark cells: a circular map around the car, distance rings labelled in metres (boundary 20 m,
  object-vector 40 m; an object-vector cell fires when its landmark is within range).
- Head direction: a wave, heading in degrees on x, activation on y.
- Grid cells: a heatmap over a map of the track, track drawn on top, a 50 m scale bar.
- Speed: activation against m/s. Neurons and wheels: their layer's transfer curve.
- x/y charts carry axis titles and draw both axes through 0. Under each graph, one line on what the cell does; the
  remove control is a round red bin, white icon, in the panel's bottom-right corner. Buttons are square (2026-11-04).

## 7. Look
One font across the whole site: Arial, regular or bold (2026-11-04).
The symbols are low-poly 3-D models in the workbench's plain style (soft, matte, flat colours on the light/dark
board), not the race's glossy stadium look. One shared 3-D layer sits under the diagram; the wires and cells stay crisp.

## 9. Touch first (2026-11-04)
Everything works by tap: tap a sense in the tray to add a cell, tap a cell to inspect or remove it, tap one cell then
another to toggle a wire, tap a layer's header to set its function. Every target is at least 44 px; nothing relies on
hover; phones use landscape.

## 10. Training view (2026-11-04; layout superseded by `2026-11-04-tracks-training-matches.md` section 3)
5–20 cars on the track (fewer on weaker devices), each a random member of the population; one, picked at random, is
highlighted with its brain shown beside the track (a toggle shows the mean brain). Playback starts at real speed and
accelerates until it matches the computer's training speed. ~~(accelerating playback dropped 2026-11-04)~~

## Agreed 2026-11-04
- Place cells recognise landmarks (walls, finish line) and replace the eyes; counts start at head direction 1, grid 2,
  place 2 (walls, finish line); adding cells re-tunes them automatically.
- ~~The brain runs continuously on the workbench~~ → superseded 2026-11-04: build mode is still; firing only when active.
- Plain matte low-poly symbols.
- Round 2: real cell names; whisker cells added; energy is a fixed brain/speed split; road ahead, energy left and
  bias removed; input cells are symbol circles placed on the field only when used.
- Still my default, not yet ruled: same track until "New track"; tanh/sigmoid idle at half rate.

## As built (B2 + B3, 2026-11-04)
Engine in `src/common/sim` (spec, senses, energy, brain, sensors), designer in `src/client/ui/designer` (a port of the
mock-up); the details are in `docs/ARCHITECTURE.md`. Choices the plan left open, or that the build had to make:
- Boundary vector cells read three 20 m rays across their field (centre and both half-widths), weighted by the same
  field rule the designer's polar graph draws; landmark cells use the nearest point of the finish line. One rule for
  each sense (`senses.ts`), so the graphs show exactly what the sim computes.
- Linear is z kept to −1..1 (rate (y + 1)/2), as tanh's range.
- Any edit leaves an untrained brain (weights 0, grey wires), as the rulings say; Reset too.
- Sandbox Train asks for generations; the budget is that many of evolution's worst-case generations, evolution stops
  after that many, backprop spreads that many fitness checks over it (backprop's phases are therefore longer:
  about 15M car-ticks for 100 generations).
- The legal and credits line moved into the right end of the rule strip (the panel had no room under the bin at
  860 × 400); the sound button sits at the end of the top bar.
- The drive view keeps working: one beam per boundary cell, every cell flashing at its rate, the energy line shows
  "brain x% · speed y%" for the tick.

### S1 re-benchmark on the default brain (seeds 1–20, evolution, T 6M, 60 s episodes)
`npm run bench` → `out/bench/report.md`. Measured in the 4-core build container, not the reference desktop.

| | brain v1 Starter (before) | default brain v2 |
|---|---|---|
| final training fitness, median (60 s, both tracks) | 3125 | 2505 (17/20 ≥ 500; seeds 8, 9, 19 stay under 400) |
| trainer gate: end ≥ 1.5× start | 20/20 | 18/20 |
| (a) median 30 s on the unseen track, final champion | 1467 m | 7 m (gen 1: −1 m; the ratio is meaningless) |
| (b) final ≥ 80% of a lap in 30 s | 18/20 | 3/20 |
| (d) Minimal (v2: one boundary cell, one linear neuron) ≥ 50% of a lap | 19/20 | 0/20 |
| (f) same seed → same hash; 1 vs 4 workers | pass | pass |
| phase time, Node 4 workers | 3.8 s | median ≈ 3.6 s |

Read: the default brain learns its two training tracks well but hardly carries over to a new one. Its only steady
signal is the head-direction cell, which is anchored to the world: a champion learns "which way to steer when facing
north" for those two tracks, and that is wrong on the next. The single boundary cell only sees 20 m ahead. As the plan
expected, a two-input brain does not lap reliably; adding boundary cells (and speed) is what the player is meant to
discover. Minimal has no steady input at all (no bias any more), so it never moves.

Backprop on the default brain does not learn (training fitness ≈ 0 on seeds 1–3): with no bias input, the net can't
produce the constant "forward" the teacher asks for from a boundary reading that is mostly 0 and a cosine that
changes sign with the heading; the loss stays at ≈ 0.94 per wheel. It is reported, not fixed: that is B4's concern
(trainers), and the obvious remedy (a steady input) is a design question for the principal.

### B2b: built-in biases (2026-11-04, §3ab) and the S1 re-run
Every hidden neuron and wheel computes z = b + Σ w·x. The biases sit after the weights in the genome; evolution
mutates them like weights, backprop learns Δb = η·δ under the same clamp; fresh starts draw them like weights (ReLU
layers positive). A brain v2 save from before loads with every bias 0. The designer shows a trained neuron's or
wheel's bias and plots its curve against Σ w·x, so the bias shifts it.

S1 on the default brain (seeds 1–20, T 6M, 60 s episodes, Node 4 workers, build container):

| | evolution, B2 (no bias) | evolution, B2b | backprop, B2 | backprop, B2b |
|---|---|---|---|---|
| final training fitness, median | 2505 (17/20 ≥ 500) | **3065 (20/20 ≥ 500)** | ≈ 0 | 120 (0/20 ≥ 500) |
| gate: end ≥ 1.5× start | 18/20 | 20/20 | – | 19/20 |
| (a) median 30 s on the unseen track | 7 m | **1446 m** (gen 1: 93 m, ×15.6) | ≈ 0 | 162 m |
| (b) ≥ 80% of a lap in 30 s | 3/20 | **15/20** | 0/20 | 0/20 |
| (c) end ≥ 2× gen 1 | 18/20 | 19/20 | – | 19/20 |
| (d) Minimal (1 boundary, 1 linear) ≥ 50% of a lap | 0/20 | **17/20** | – | 0/20 |
| 60 s: ≥ 1.6 laps / Minimal ≥ 1 lap | – | 13/20 / 15/20 | – | 0/20 / 0/20 |
| (f) same seed → same hash; 1 vs 4 workers | pass | pass | – | pass |
| phase time, median (max) | ≈ 3.6 s | 3.88 s (4.56) | 4.7 s | 6.31 s (11.0) |

With a bias the default brain drives new tracks: the old Starter's level (1467 m, 18/20) almost exactly, and Minimal
laps again. No design change is needed for evolution.

Backprop still does not drive. The teacher steers by the centreline, which this brain cannot see: one boundary cell
looks 20 m straight ahead (mostly reading 0 on a straight), and the head-direction cell knows the compass heading,
not the road. Copying the teacher from those two inputs leaves the regression averaging (training fitness ≈ 120 m, the
car creeps); it can learn "forward" now, not "where the road goes". Evolution has no such problem because it is
scored on progress, not on matching a driver it can't see. A brain with a few boundary cells across the front gives
backprop something to copy from; whether the default should change is the principal's call (not changed here).
