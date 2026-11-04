# Tracks, the training view and match size (plan; nothing built)

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
- **Random agents from each generation**: as each generation is evaluated, a random handful of its agents (as many as
  before: 5–20 by device) drive on the track, **all as ghosts**. ("5 cars" was withdrawn the same day: "let's keep it
  as many cars as we had before, but load them more lazily so that we don't have a lag spike".)
- **Loaded lazily**: car meshes are made once and reused; each generation's paths are prepared a few cars per frame (or
  off the main thread) ahead of when they're needed, so a new generation never causes a frame spike.
- **Show whatever we've got, not just "round number" generations** (2026-11-04): every generation is available to show,
  not only the story's picks (1, 10%, 25%, 50%, final). Each generation records the paths of the few agents the view
  might show (the random handful, recorded as part of that generation's evaluation), and the view always moves to the
  newest finished one.
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

## 4. Matches ("Multiplayer"), and VS Computer
- **vs CPU**: you against nine computer brains, 10 cars on one track, offline. The computer brains come from
  trained presets of varied skill.
- **A countdown before every race** (both modes): the starting grid, two by two behind the line, the players listed,
  then 5…1, Go.
- **Up to 100 cars per match.** Every client re-runs the whole race (the sim is deterministic), so fairness holds.
- **Only the nearest cars are drawn as 3-D cars** (5–20 by device, as in training), nearest to the camera's car. The
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
