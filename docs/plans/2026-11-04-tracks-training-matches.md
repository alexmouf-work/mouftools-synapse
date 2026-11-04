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
- One **info panel on the left**, full height, **at most a fifth of the width**, a section of its own (not an
  overlay); the camera fills the rest of the screen. Nothing on the right.
- **Random agents from each generation**: as each generation is evaluated, a fresh random handful of its agents (5–20 by
  device) drives on the track. The accelerating playback (v2 plan, section 10) is dropped: "didn't really look how I
  wanted".
- **Top half: fitness per generation**, best and mean. The x-axis spans the whole run, so the line's reach shows
  progress; "gen n of N" and Stop sit in its header (Stop becomes Drive/Back when done). Axis titles; axes through 0.
- **Bottom half: the map**: the whole track with every shown car as a dot, one highlighted ("12 of 120").
- Replaces today's status panel and graph panel. Still to settle: where the highlighted car's brain goes, if anywhere
  (my default: nowhere during training; it's in the drive view).

## 4. Matches
- **Up to 100 cars per match.** Every client re-runs the whole race (the sim is deterministic), so fairness holds.
- **Only the nearest cars are drawn as 3-D cars** (5–20 by device, as in training), nearest to the camera's car. The
  rest exist only as dots on a **map in a corner**, the player's own car highlighted.
- To check before building: the cost of 100 brains × 60 s on a phone. Measured, not assumed; the match screen can
  show the race once it's computed if a weak device needs it.
- Match mode still waits for the Supabase project URL and anon key.

## 5. Title screen (mock-up `reference/title-screen-mockup.html`)
- "Synapse", one line ("Build a brain. Train it. Race it."), two buttons: **Sandbox** and **Match**.
- Match opens: **Create a room**, or **join** with a 4-letter room code; "Up to 100 players"; Back.
- Behind the card, a quiet fully wired brain whose cells flash at their own rates (still if reduced motion is set).
