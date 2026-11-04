# Brain designer v2: design plan (for agreement before mock-ups)

Status: agreed in outline 2026-11-04; mock-up next. Nothing built. Rulings it rests on are in `docs/CONTEXT.md` (2026-11-04).

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
- Limits (2026-11-04): up to 10 hidden layers, 8 neurons a layer, each sense its own maximum. At a limit the "+" goes
  away (a full sense's tile loses its "+" and dims); no warnings. Columns share the width evenly unless the inputs or
  the car need more; with many layers the function chip shows its curve only and the bottom-row buttons shrink to fit.
  Under the 100% energy rule, about 8 layers of 3 tanh neurons is the practical most.
- The layer panel: the four functions, then space, then energy per neuron (no description line).
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
