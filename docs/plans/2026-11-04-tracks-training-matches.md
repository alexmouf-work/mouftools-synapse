# Tracks, the training view and match size (plan; §3 built in B6, §1–2 in B5)

Status: drafted 2026-11-04 from the principal's requests (verbatim in `docs/CONTEXT.md`). Mock-ups:
`reference/training-view-mockup.html`, `reference/track-shapes-mockup.html`. To be built after the trainer work lands,
one builder at a time, on the principal's go.

## 1. More track shapes
- A track's seed picks a **family**, then jitters it with the seeded Rng: Loop (today's), Kidney, Hairpin, Chicane,
  Dogleg, Clover, Figure eight. Each family is a set of control points; everything after that is today's pipeline
  (closed Catmull-Rom, resample every ~2 m, validate, retry on the next sub-seed).
- The validator keeps its rules (length, tightest corner, one long straight for the start, room for pads). The
  near-overlap check exempts only a declared crossing (section 2).
- Cost: every track's golden hash changes and the learning benchmark (S1) is re-run across the families. Saved brains
  keep their seed but may get a different track; sandbox brains don't store tracks, so nothing breaks.

## 2. The figure eight, without simulating a third dimension
The sim stays flat. What makes the crossing work is that a car always knows which road it is on:
- **The car can't jump roads.** It already finds its place on the track by searching only a few samples either side
  of its last one (`locate(…, idx, 3)` in `track.ts`). At the crossing both roads are near, but only the one it is on is
  in that window, so it stays on its own pass.
- **Walls come from its own road.** Wall contact is the car's sideways offset from its own centreline, so the other
  road's edges can't touch it, and it can't cut the corner across the crossing: leaving its road is a wall hit.
- **Each sample has a deck**: 0 on the ground, 1 on the bridge (the second pass over the crossing and its ramps).
  Wall segments carry their sample's deck. A boundary vector cell's ray skips walls on the other deck, so a car under
  the bridge doesn't "see" the bridge's parapets, and a car on it doesn't see the road below.
- **Height is drawn, not simulated.** The renderer lifts the bridge with cosine ramps (as today's elevation is
  render-only), adds pillars and parapets, and draws cars on the lower road beneath the deck; the map draws the deck
  last, with lower cars hidden under it.
- **Generator rules for a crossing:** crossing angle 60–120°, both passes nearly straight through the crossing and
  ramps, no start line, gate or pad on the ramps.
- Deterministic: the deck is a pure function of the sample index; no new floating-point paths.

Built (B5, 2026-11-05):
- **Families.** `familyOf(seed)` picks one of the seven evenly (seeds 1–700: 91–112 each); every sub-seed keeps it.
  Loop is today's generator unchanged (a loop seed gives the same track as before). Kidney, hairpin, chicane and
  dogleg use the mock-up's control points, each jittered ±0.015 of the shape's units, stretched ×U(0.88, 1.12) one way
  and ÷ the same the other, scaled so the control polygon is a 1250–1750 m lap, turned by a seeded angle and mirrored
  half the time. Clover and figure eight are drawn by heading in metres, then turned and mirrored.
- **Where the shapes differ from the mock-up** (only where the validator's rules need it; worth a look): the mock-up's
  kidney (a dented circle) and clover (a round trefoil) have no 150 m straight at any size that fits the length rule,
  so the kidney's long side is flat and the clover is three leaves on long straight stems (170–182 m stem out, round
  the tip at 52–60 m, the stem back, a 28–38 m bend the other way at the waist). The hairpin is shorter, with its three
  turns wider half-circles (the mock-up's hairpin turn is about 16 m round at track size; the rule is 25 m); the
  chicane's kink is a gentler step. Point jitter is ±0.015 (±0.035 put the hairpin's turns under 25 m).
- **Retries** (mean sub-seeds to a valid track, seeds 1–150): loop 14 (as before), clover 6, hairpin 3, dogleg 1,
  kidney, chicane and figure eight 0. Each family passes the generator test on 40 seeds; the 1000-seed test passes.
- **The figure eight.** Two lobes (a corner, a 180–215 m far straight, the mirror corner), radius 38–50 m, and the
  crossing between them at 75–105°. Validated: exactly one self-crossing (segment pairs more than 60 m apart along the
  track that cross at a real angle; collinear pieces of one straight would otherwise "cross" by round-off), at 60–120°,
  both passes within 1/150 m⁻¹ of straight for 75 m either side; the near-overlap rule exempts only pairs from the two
  passes' 75 m reaches; no start, gate or pad within them.
- **Decks.** The second pass from the start is the bridge: deck 1 within 20 m (flat) + 55 m (ramps) of the crossing,
  a pure function of the sample index. Each sample also has a layer: 0 open, 1 the lower pass's 75 m reach, 2 the
  bridge's. Wall segments carry it; a boundary ray from a car on layer 1 skips layer-2 walls and the reverse; from
  layer 0 it sees every wall (`hiddenLayer`, `castRay(…, skip)`). My call: "skips walls on the other deck" applied
  everywhere would make a car at the foot of a ramp see a gap in its own walls where its road changes deck, so the
  skip is limited to the crossing's two reaches; outside them the other pass is over 60 m away, out of every sense's
  range. A car finds its sample within ±3 of its last one and hits its own road's wall, so it can't change roads or cut
  across (unit test: straight through on either pass, and turned onto the other road at the crossing).
- **Height is drawn, not simulated.** The bridge rises on cosine ramps to 7 m over the crossing (`trackMesh.liftOf`);
  its walls are the parapets; an underside (1.2 m below the deck) and pillar pairs every 14 m that stand clear of the
  road below. Cars' height and pitch come from their recorded progress (paths now record it; `sampleOf`, `liftAt`),
  never a nearest-sample search, so a car at the crossing is drawn on its own road. The training map draws the road,
  the cars on the ground, the deck (white edge, soft shadow) over them, then the cars on the bridge. The drive view's
  beams skip the other deck as the sim's rays do. Stadium pieces (stand, boards, lights, camera spots) go on whichever
  side is clear of the rest of the track (the hairpin's and clover's other roads can be close), none by the crossing.
  Tracks now face any way, so the grandstand's pale tiers and crowd are toned down (a near-white tier facing a low
  sun reached 1.61 against the bloom threshold of 1.3 at the drive check's start; now 1.24).
- **Checked:** unit tests (families, crossing, decks, ray skip = brute force, keeping the road, bridge geometry finite
  with pillars off the lower road); determinism goldens regenerated (every track changed) plus a heavy brain racing
  on a figure eight; the drive check drives track 13 (a figure eight) under and over the bridge (car drawn at 0 m and
  7 m, bloom audit clean, screenshots `out/s4/eight-*.png`). The training view on a figure eight was looked at, not
  checked by a script.
- **S1 re-run, evolution** (seeds 1–20, T 6M, the default brain; the tracks are now any family): see the table below.

| S1, evolution, seeds 1–20, T 6M | B2e (loops only) | B5 (seven families) |
|---|---|---|
| final training fitness, median | 3106 (20/20 ≥ 500) | 2839 (20/20 ≥ 500) |
| gate: end ≥ 1.5× start | 20/20 | 20/20 |
| (a) median 30 s on the unseen track | 1403 m | 1303 m (×27 gen 1) |
| (b) ≥ 80% of a lap in 30 s | 15/20 | **12/20** (need 15) |
| (c) end ≥ 2× gen 1 | 19/20 | 19/20 |
| (d) Minimal (1 boundary, 1 linear) ≥ 50% of a lap | 18/20 | 16/20 |
| 60 s: ≥ 1.6 laps / Minimal ≥ 1 lap | 12/20 / 14/20 | 13/20 / 12/20 |
| (f) same seed → same hash; 1 vs 4 workers | pass | pass |
| phase time, Node 4 workers, median (max) | 3.86 s (6.00) | 4.24 s (5.09) |
| the teacher alone, 30 s on the unseen track, median | ~1550 m | 1497 m |

The tracks got harder (hairpins, chicanes, the clover's waists): the median brain still learns 27× over its first
generation, but three fewer seeds reach 80% of a lap in 30 s, so (b) now misses its bar of 15. The eight that miss
are spread over the families (unseen track: 2 chicane, 3 hairpin, 7 chicane, 8 figure eight, 11 loop, 12 dogleg,
17 figure eight, 19 clover; `out/bench/seed-NN.svg`). Not tuned (no sweeps this stage); the principal may want to
weigh it.

## 3. Training view (supersedes section 10 of the brain designer v2 plan)
- **Stop = finishing early** (2026-11-04): "if the car is training and the user stops it mid-train, we take the best
  performing agent that was discovered so far, and that becomes the one that is allowed to drive. stopping the training
  should be functionally equivalent to hitting the limit on the number of generations." Stop ends the run exactly as
  reaching the chosen generation count does: the best agent found so far (its best evaluated fitness, any generation)
  is saved as the brain, and Drive and Keep training appear. Keep training continues from it. Stopping inside a
  generation counts only the generations already evaluated.
- One **info panel on the left**, full height, **at most a fifth of the width**, a section of its own (not an
  overlay); the camera fills the rest of the screen. Nothing on the right.
- **Every agent of each generation**: as each generation is evaluated, its agents drive on the track, **all as
  ghosts**, as many as the old view showed: the whole population of 64. ("5 cars" was withdrawn the same day: "let's
  keep it as many cars as we had before, but load them more lazily so that we don't have a lag spike". An earlier
  version of this plan said "5–20 by device", which misread it; corrected in B2d.) A weak device shows fewer only if
  its frame budget forces it.
- **Loaded lazily**: car meshes are made once and reused; each generation's paths are prepared a few cars per frame (or
  off the main thread) ahead of when they're needed, so a new generation never causes a frame spike.
- **Show whatever we've got, not just "round number" generations** (2026-11-04): every generation is available to show,
  not only the story's picks (1, 10%, 25%, 50%, final). Each generation records the paths of the agents the view
  shows (recorded as part of that generation's evaluation), and the view always moves to the newest finished one.
- **Never the same generation twice; its number big and white** (2026-11-04): each generation is shown at most once,
  in order (skipping is fine, repeating never is; at the end the champion's lap plays, not generation 1 again). The
  generation shown is a large white number centred at the top of the camera view (Arial bold, with a soft shadow for
  legibility).
- **Newer generations sooner, each starting further along** (2026-11-04, revises the whole-episode replay below): when
  a newer generation is ready, the view moves on to it promptly (after a short minimum, about 2 s, so it doesn't
  flicker) instead of finishing the old replay. Each generation's replay starts later in its episode than the one
  before, so the cars appear progressively further round the track as training goes on: the start offset grows with
  the generation's share of the run, capped so there are always a few seconds left to watch.
- **Fast playback (12×, so a generation takes about 5 s), as much of the course as possible** (superseded in part,
  see above): the shown cars replay their whole 60 s episode at 12×, so you see how
  far they really get, not just the first bend. Then the next generation's five start. If training runs ahead of the
  replay, the view skips to the newest finished generation rather than queueing. The accelerating playback (v2 plan, section 10) is dropped: "didn't really look how I
  wanted".
- **Top half: fitness per generation**, best and mean. The x-axis spans the whole run, so the line's reach shows
  progress; "gen n of N" and Stop sit in its header (Stop becomes Drive/Back when done). Axis titles; axes through 0.
- **Bottom half: the brain** (2026-11-04: "show the map in the bottom right, and the BRAIN in the bottom left, swapped
  for the map"): the highlighted car's brain, live: senses → layers → wheels, wires coloured by weight, every cell
  flashing at its firing rate as that car drives.
- **The map moves to the camera's bottom-right corner**: a small panel (about 28% of the view's width, at most 300 px,
  4:3) with the whole track, every shown car as a dot, the highlighted one ringed ("12 of 120"). It replaces "nothing
  on the right".
- Replaces today's status panel and graph panel. Still to settle: where the highlighted car's brain goes, if anywhere
  (my default: nowhere during training; it's in the drive view).

Built (B6, 2026-11-04): the panel, the map, the big number and the playback as above, with these specifics:
- Ghosts per generation: B6 showed 20 / 12 / 5 by device (from the misread above); since B2d every device shows the
  whole population of 64. The workers record them as part of that generation's evaluation: their track-0 paths and
  weights, and the firing of the one furthest along, which is the highlighted car (yellow among the cyan ghosts;
  ringed on the map; its brain in the panel). The main thread only compiles one net per generation, and a new
  generation's ghosts are added in 16 a frame (the highlighted one first), so it causes no frame spike;
  check:training measures the worst frame while they come in against the median frame. Even the software renderer
  (SwiftShader in the checks) stays within that, so no device class shows fewer.
- Playback at 12× (60 s episodes, 5 s a generation). A newer finished generation takes over after 2 s. The start
  offset is (g − 1)/(N − 1) of the latest start that leaves 2.5 s to watch (30 s into the episode), never
  shrinking. With nothing newer the frame holds (ended cars stay faintly where they stopped). At the end the
  champion's lap loops as the solid car.
- Stop aborts the pool (the generation being evaluated is dropped) and saves the best agent evaluated so far, as
  the generation limit there would (a unit test pins it against a run asked for that many generations). For
  evolution that is the last generation's champion (elites keep their score, so best fitness never falls; checked
  on seeds 1 and 7). For backprop it is the best-scoring check, which can differ from a finished run's final
  weights; this matters only once backprop is used with Stop.
- The finish line: a chequered band of four rows of 1 m squares on the road, and a chequered flag on a black pole
  each side in the run-off (render/finish.ts); both in the 3-D view and the map, inside the bloom audit.
- "Only the first bend" (2026-11-04) was the display, not the training: the old story showed each generation for
  2.6 s at 3×, which is the first 7.8 s of its 60 s episode, 140–290 m on seed 7's track 0, whose first bend is at
  146 m. The same run's champions cover 825 m (gen 10), 2.15 km (gen 25) and 3.1 km (gen 100) in the full minute, on
  a 1.3 km lap.

## 4. Matches ("Multiplayer"), and VS Computer
- **vs CPU**: you against nine computer brains, 10 cars on one track, offline. The computer brains come from
  trained presets of varied skill.
- **vs CPU calls (coordinator, 2026-11-05, to keep B7 moving; the principal can change any of them):**
  - Flow: title → vs CPU → the designer in match mode (the energy limit applies: no design over 100% at flat out;
    Train spends the fixed budget T, no generations popup) → when training ends, **Race** → grid and countdown →
    race → results (place, time, distance) with Race again / Back.
  - The nine CPU brains are trained offline by a script with evolution, at budgets spread from about 5% to 100% of T,
    on a mix of random starters and sighted designs. They are stored as JSON in src/assets. Each race draws a random
    track from any family.
  - Names: You, plus nine fixed CPU names on the brain theme (Axon, Dendrite, Soma, Myelin, Glia, Cortex,
    Ganglion, Thalamus, Hippo).
  - Grid: two by two behind the line, about 8 m between rows and ±2.5 m across. Slot order is drawn from the race
    seed. No boost pad on the grid or in the first 50 m.
  - Cars pass through each other (no car-to-car contact): each car's sim runs independently, so it stays
    deterministic and fair.
  - Race: 2 laps, capped at 120 s. Ranked by finish time, then by progress at the cap. First place plays the winner
    music.
- **Built (B7, 2026-11-05)** to those calls; specifics and my calls (each can be overturned):
  - The match designer refuses edits past 100% flat out (as planned) and, if the brain it opens with is already past
    it, says so and won't train it. Train goes straight to training (no popup) at temperature ×1 (the slider lives
    in the popup). **My call:** vs CPU training always starts the design from scratch (weights, biases and learned
    fields at 0, a fresh seed, phase 0), as the CPU brains did, so a brain trained longer in the sandbox brings no
    extra training to a race; the result is saved as the brain (the same save as the sandbox's). The training view
    ends with Race and Back; Keep training and Drive are hidden (more training would break the equal budget).
  - The grid: front row 4 m behind the line (**my call**: the calls give the spacing, not the front row), rows 8 m
    apart rounded to whole samples (~2 m), ±2.5 m across, even slots on the left. A race track keeps pads from 40 m
    behind the line (the back row is 36 m back) to 50 m after it; it is `generateTrack(seed, true)`, so training and
    drive tracks and every existing golden are unchanged.
  - Progress counts from the line (a car on the grid starts negative), so 2 laps is 2 × the lap from the line, and a
    back-row car drives its extra metres, as on a real grid. Finish time is to a fraction of a tick. Every car drives
    the whole 120 s (after the flag it carries on); the race ends with the last finisher or at the cap; then the
    results. **My additions:** Skip to results, and Back in the race panel (leave mid-race).
  - Drawn: your yellow car with its beams; the CPUs as solid cars, one colour each (also their swatch in the
    standings). A car within 8 m of the chase camera isn't drawn (on the grid, the car behind yours filled the
    screen). The map is the training view's, every car a dot, yours ringed.
  - Winner music: as you cross the line first; if no one finishes and you lead at the cap, when the results show.
  - The CPU brains (`scripts/sim/cpuBrains.ts`, ~40 s): budgets 5, 10, 17, 25, 35, 47, 60, 80, 100% of T, alternating
    random starters and four sighted designs (3–5 boundary vector cells, a speed cell or a landmark cell, one or two
    layers of 4–6 neurons; 11–25% flat out). Median progress in 120 s alone from pole over ten race tracks: Axon 2085 m,
    Dendrite 4223, Soma −4696, Myelin −5409, Glia 4688, Cortex 4992, Ganglion −5287, Thalamus 1183, Hippo 5779 (two
    laps ≈ 2.5–3.8 km).
  - **Worth a ruling:** three of the nine (Soma, Ganglion, Myelin) drive the wrong way round on most race tracks, and
    the rest on some. They lap their own training tracks forwards; on a new track nothing in their senses says which
    way the lap goes (only the landmark cell sees the line), so a brain that learned "wall on the left" turns round
    when the track is the other way. Player brains do the same (it is the S1 (b) gap, B5). A car going backwards ranks
    by its (negative) distance, shown as such in the results. Not tuned or hand-picked: the brains are what the
    script's fixed seeds give.
- **Built (B8, 2026-11-05): Multiplayer**, per §4–5 and the legal plan. Rooms with a 4-letter code (A–Z), up to 100
  players; your name (1–16 characters) on the card. Calls I made where the plans are silent (each can be overturned):
  - Flow: Create or Join → the lobby on the title screen → Build and train (the match designer, the same fixed
    budget from scratch as vs CPU) → Hand in → the host's Start race (enabled once one brain is in) → every client
    computes and plays the race → results → Back to room; the host can start again (each player's latest brain).
    The host is the room's creator. A race freezes its entries when it starts, so a brain handed in later waits for
    the next. A client not in the lobby when a race starts isn't pulled into it (the lobby says so); one that arrives
    late joins the race where it is.
  - Go is 12 s after Start, on the server's clock; the countdown is the same two-beat 5…1 Go as vs CPU but timed to
    that moment (it can't follow each client's music).
  - A brain that isn't valid or is past the match limit is left out of the race by every client the same way.
  - Drawn: the nearest 11 others to your car as solid cars (the vs CPU field fits), the rest as map dots. 11 is the
    rig's pool, not a measured per-device number; the 3-D cost of each car was not measured per device.
  - Results go back to the room (place, time, distance), as the privacy policy says. Nothing is kept in the browser.
  - **Needs a ruling:** the grid stays two by two as planned, so 100 cars make 50 rows: the back row starts 396 m
    behind the line, often round corners, and the pad-free zone covers only the first 40 m behind it (it was sized for
    ten). A wider grid for big rooms, or a longer pad-free zone, would each change the plan.
  - **Cost, measured** (`scripts/sim/raceCost.ts`, this 4-core Xeon VM, one thread): 10 cars × 120 s 135 ms, 100 cars
    × 120 s 1.09 s in Node; in headless Chrome (check:multiplayer) about 1.2–1.5 s on the main thread. A phone was
    not measured; at a few times slower it still fits inside the 12 s before Go, though the page is frozen while it
    computes (a worker would fix that if it matters).
  - Not done: the real Supabase project (the principal runs `supabase/schema.sql`); the checks use the local stand-in.
- **A countdown before every race** (both modes): the starting grid, two by two behind the line, the players listed,
  then 5…1, Go.
- **Up to 100 cars per match.** Every client re-runs the whole race (the sim is deterministic), so fairness holds.
- **Only the nearest cars are drawn as 3-D cars** (a number by device, to be measured; training shows all 64), nearest to the camera's car. The
  rest exist only as dots on a **map in a corner**, the player's own car highlighted.
- To check before building: the cost of 100 brains × 60 s on a phone. Measured, not assumed; the match screen can
  show the race once it's computed if a weak device needs it.
- Supabase variables are set in Vercel (`SUPABASE_PROJECT_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`);
  how they reach the build safely is in `2026-11-04-legal-pages.md`.

## 5. Title screen (mock-up `reference/title-screen-mockup.html`)
- "Synapse", one line ("Build a brain. Train it. Race it."), three buttons: **Multiplayer** (blue, the accent), **vs
  CPU** (yellow), **Sandbox** (plain, quieter). "vs CPU" replaces "VS Computer"; Multiplayer replaces "Match".
- Multiplayer opens: **Create a room**, or **join** with a 4-letter room code; "Up to 100 players"; Back.
- Behind the card, a quiet fully wired brain whose cells flash at their own rates (still if reduced motion is set).

## 6. Sandbox: no training budget; the player chooses how long (2026-11-04)
- Sandbox has no limit on training. **Train opens a popup**: "Train for how many generations?" with 10, 25, 50, 100,
  250, 500, 1000; **100 is selected by default**; Cancel or Train. (Mock-up: brain designer v2.)
- The engine trains for that many generations instead of spending the fixed experience budget T. vs CPU and
  Multiplayer keep a fixed, equal budget, so races stay fair.
- My reading: "unlimited budget" is the training budget, not the brain's energy limit (designs still can't pass
  100% flat out). To confirm.

## 7. The finish line (2026-11-04)
"make the finish line have a nice checker pattern on the ground, and give the flag a checker pattern too with a black
stem. put the flag on either side of the finish line." A chequered band across the road at the finish, one chequered
flag on a black pole at each side of the road, in the 3-D scene (training, drive, races) and drawn as a chequered
line on the maps.
