# Tracks, the training view and match size (plan; §3 built in B6)

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
