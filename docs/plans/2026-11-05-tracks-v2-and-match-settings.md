# Tracks v2, track choice, match settings, names and the host (2026-11-05)

Principal: "make the tracks longer, and give them all a bit more variation in shape. I want each track (except the
figure 8) to have a straight section, a curve and some other interesting features like hairpins or other stuff. make
it more interesting please. Offer track selection at any time in sandbox mode, and in the settings before starting a
match vs CPU / multiplayer stuff. Make sure that the player has to choose a name before the game starts in CPU mode
too. make sure that one player is a host for the multiplayer game, and that they can choose settings like max players
and map."

## Stage T1: tracks v2 (sim)
- **Longer:** laps of about 2.0–3.0 km, up from 1.25–1.75 km. The figure eight scales too and keeps its bridge.
- **Every track except the figure eight must have all of these,** checked by the validator; a failure moves to the
  next sub-seed:
  - a **straight** of at least 250 m, which the start sits on;
  - at least one **long sweeping curve**: 90° or more of turn at a radius of 60 m or more;
  - at least **two features** from this list, at least one of them a hairpin or a chicane:
    - **hairpin:** 150° or more of turn within 120 m;
    - **chicane:** an S of two opposite turns of at least 30° each within 120 m;
    - **esses:** three or more alternating turns;
    - **double apex:** one corner with a straighter middle;
    - **decreasing-radius corner.**
- **More variation:** each family's shape varies more between seeds. That means wider control-point jitter and
  aspect, random mirroring and rotation, and features placed by the seed (where along the lap, which kind, how tight),
  so two tracks of one family no longer look alike. The seven families stay as the overall forms.
- The rules that keep a track drivable are unchanged: minimum radius, parts apart, pads off the grid, the figure
  eight's crossing angle.
- Make a contact sheet of six seeds per family, as before (scratchpad/b5/sheet.png), labelling each track's length and
  features. Unit tests: every family over 200 seeds meets the rules, and the feature detector finds known shapes.
- **Knock-on effects:** goldens change, so say why in the commit. Regenerate the CPU brains on the new tracks. Re-run
  S1 and report it without tuning. Episodes stay 60 s. The checks that cover tracks, training, drive, race and
  determinism run; the rest don't (affected systems only).

- **Built: T1 (2026-11-05).** `src/common/sim/track.ts`. Every family but the figure eight is now a skeleton of
  straights and corners drawn by the seed (number of corners, angles, radii, straight lengths), not the mock-up's
  fixed control points; the seed then places the features on it (`decorate`: which kinds, where, how tight), scales the
  straights to a lap of 2.15–2.85 km and closes the lap by the least weighted change to its straights. The lap is traced
  exactly (arcs and lines), so the Catmull-Rom is gone. Families keep their forms: loop (4–6 corners), kidney (a side
  pushed in), chicane (a chicane on the long back straight), dogleg (a step in one side), hairpin (a tongue with a
  left and a right hairpin), clover (three leaves; a tip may be a hairpin) and the figure eight (two lobes drawn
  separately, far straights 280–380 m, crossing at 70–110°). Random rotation and mirroring as before.
  - **Feature detector** `detectShape(curv, ds)` on the smoothed curvature, with the plan's definitions (hairpin
    ≥ 150° within 120 m; chicane: two neighbouring opposite turns ≥ 30° each within 120 m; esses: three or more
    alternating; double apex: one corner of two turns; decreasing radius: second half ≥ 1.3× as curved; sweep ≥ 90° at
    ≥ 60 m). Same-way turns < 25 m apart are one corner; alternating corners < 25 m apart are a chain. The validator
    rejects a lap (next sub-seed) without a ≥ 250 m straight for the start, a sweep, two features or a hairpin/chicane;
    `Track.features` carries what it found (for T2's picker). Laps measured 2.00–2.90 km (the validator allows 2–3).
  - **Measured over 200 seeds per family:** no failures; mean retries dogleg 5.9, kidney 4.6, loop 2.9, clover 2.6,
    chicane 1.0, hairpin 0.9, eight 0; all seven families generate 1400 tracks in ~3 s.
  - **Contact sheet** (six seeds per family, length and features labelled, features marked: red hairpin, blue chicane,
    purple esses, orange double apex, teal decreasing radius; black dot = start): `scratchpad/t1/sheet.png`.
  - **Knock-on:** the teacher still laps every track cleanly (0 wall ticks over 60 unseen tracks) but at 1.07–1.39
    laps a minute, so its unit test asks for a lap, not 1.5. check:drive's figure eight is now seed 311 (the T=1M
    seed-7 brain passes under at tick 297 and over at 770; seed 13 is still an eight, but that brain no longer
    reaches its crossing). Scenery measures the track's reach from its centre and puts ridges, terrain edge, trees
    and clouds beyond it (tracks now reach ~600 m from centre; the old ridge ring began at 500 m). CPU brains
    regenerated (scripts/sim/cpuBrains.ts). Every golden changes (all run on tracks).
  - **Fixed on the way:** the drive view's hand-ended countdown (`endCount`, used by seek and the checks' audits) set
    Go to `performance.now()`; a rAF timestamp can be earlier than that, so one frame put the car back on the line.
    Go is now in the past for every later frame (check:drive's "over the bridge" height had read 0 m).
  - **Checked:** types, purity, unit (incl. 200 seeds × 7 families and the detector's known shapes), determinism
    (goldens regenerated), check:training, check:drive, check:race. Not run (unaffected): workbench, preview, legal,
    audio, icons, title, multiplayer, bench.
  - **S1 re-run, evolution:** seeds 1–20, T 6M, the default brain (`npx tsx scripts/sim/bench.ts`; `out/bench/report.md`).
    Not tuned.

    | S1, evolution, seeds 1–20, T 6M | B5 (seven families) | T1 (tracks v2) |
    |---|---|---|
    | final training fitness, median | 2839 (20/20 ≥ 500) | 2876 (20/20 ≥ 500) |
    | gate: end ≥ 1.5× start | 20/20 | 20/20 |
    | (a) median 30 s on the unseen track | 1303 m (×27 gen 1) | 1390 m (×11.4 gen 1) |
    | (b) ≥ 80% of a lap in 30 s | 12/20 (need 15) | **0/20** (need 15) |
    | (c) end ≥ 2× gen 1 | 19/20 | 19/20 (seed 3: 2008 → 3018) |
    | (d) Minimal (1 boundary, 1 linear) ≥ 50% of a lap | 16/20 | 17/20 |
    | 60 s: ≥ 1.6 laps / Minimal ≥ 1 lap | 13/20 / 12/20 | 0/20 / 16/20 |
    | (f) same seed → same hash; 1 vs 4 workers | pass | pass |
    | phase time, Node 4 workers, median (max) | 4.24 s (5.09) | 2.96 s (3.18) |
    | the teacher alone, 30 s on the unseen track, median | 1497 m | 1492 m |

    Brains drive as far as before in 30 s (1390 m median, more than B5's 1303 m), but a lap is now 2–3 km, so the
    lap-relative bars can't be met: the teacher itself covers 1492 m in 30 s, about 62% of a median lap, so (b)'s 80%
    and the 60 s 1.6 laps are out of reach for any brain. Those bars were set for 1.25–1.75 km laps; they need restating
    in metres or as a fraction of the teacher (a call for the principal, not made here). Brains that fall short: seed 15
    (487 m) and seed 19 (58 m) on their unseen tracks.

## Stage T2: choosing tracks, match settings, names, the host (UI and schema)
- **Track choice in the sandbox:**
  - A "Track" button in the designer's top bar, available at any time, opens a picker. It shows the seven families
    as small map previews, plus "Random". Each family has a "Shuffle" that draws another track of that family, with
    a bigger preview of the chosen track, its length and its features.
  - The choice is remembered on the device (`synapse.track`: family and seed).
  - It sets the track Drive uses, and training's first track. Training's second track is another track of the same
    family, so brains don't learn one lap by heart.
- **Match settings before vs CPU:** title → vs CPU opens a settings screen first:
  - **Your name:** required, 1–16 characters, as in Multiplayer. It's remembered on the device (`synapse.name`) and
    prefilled next time, but must be there before Start.
  - **Map:** "New track each round" (default), "One family", which picks a family with a new track of it each round,
    or "One track", which picks a family and shuffles to a specific track used for all five rounds.
  - **Start match** begins round 1's build. Main menu goes back.
- **Multiplayer host and settings:**
  - The room's creator is the **host**. The lobby shows a "Host" tag on their chip and "Host: <name>" in the header.
  - If the host leaves, the player who joined earliest becomes host. The server does this.
  - The host has a **Settings** panel in the lobby: **max players** (2–100, default 100; never below the number
    already in) and **Map**, with the same three options as vs CPU.
  - Others see the settings read-only. Settings lock when the match starts and unlock for Play again.
  - The server enforces max players on join ("That room is full (n players).").
- **Storage:** `synapse.name` and `synapse.track` are new. Add them to the cookie policy's table and bump
  NOTICE_VERSION so returning visitors see the notice again. Both are strictly necessary, so the notice informs
  rather than asks.
- **Schema:** add room settings (max_players, map mode, family, track seed), host handover, and a function for the
  host to set settings. Keep the file idempotent and test it as before (local Postgres: over the previous version,
  then twice more). The principal re-runs it.
- **Checks (affected only):** check:workbench (picker), check:race (settings screen, name required, map modes),
  check:multiplayer (host tag, settings, max players enforced, host handover), check:legal (cookie table and
  notice version), types and unit.

## No building before the match (2026-11-05, part of T2)
Principal: "don't offer building of a brain before the match starts. building is only available when the match has
started."
- **Multiplayer lobby:** remove "Build your brain" and its note. Remove the brain-in / still-building legend and the
  filled or hollow ready squares, since nobody has a brain before the match; chips show the colour as a plain square.
  The header shows "n / max players" and no ready count. Start match needs at least 2 players in the room.
- **vs CPU:** the settings screen has no designer and no Build. The designer opens only when round 1's build begins.
- **Between matches:** the final standings offer Play again and Main menu, and nothing else. Play again goes back to
  the lobby (Multiplayer) or the settings screen (vs CPU), not to a designer.
- The server stops reporting `ready` in the lobby state before a match; brains exist only per round.

## A fresh random brain at the start of every game (2026-11-05, part of T2)
Principal: "make sure that when the player starts a game, the brain starts off randomly initiated and fresh."
- When a vs CPU or Multiplayer match starts, including Play again, round 1's build opens on a new random starter:
  `starterSpec` (2–6 inputs, always one boundary vector cell, 3 tanh, 4 wheels), drawn from a fresh crypto seed. It is
  no longer the fixed `defaultSpec()`. Its weights, biases and fields are freshly initialised at random, and nothing
  carries over from the sandbox brain or an earlier match.
- The starter must fit round 1's budget. If a draw doesn't, draw again with the next seed. checks: 2000 seeds all
  fit, or the redraw finds one within a few tries.
- The checks keep using `defaultSpec()` through their fixture hook, so goldens don't move. check:race asserts that
  two match starts give different, valid starters within the budget, and that the sandbox brain is untouched.
- **Built (landed ahead of T2, 2026-11-05):** `rounds.ts matchStarter()`: round 1 of every vs CPU match (Play again
  included) and a Multiplayer player's first round open on `starterGenome()` (starterSpec from a fresh crypto seed),
  drawn again if it is over round 1's budget (never needed: a unit test finds all 2000 seeds' starters within 20%).
  Nothing comes from the sandbox brain. **Call:** "freshly initialised" is the game's untrained new brain (every
  weight, bias and field parameter 0, as every new brain and Reset are); there is no random-weight initialiser, and
  since match-flow v2 each round's training starts from `zeroGenome` of the design anyway, so random weights would not
  reach the race. The checks' hook is `?starter=default` (dev server only): check:race's Node-compared match starts
  from `defaultSpec()` through it; check:race asserts two starts without it differ, are valid starters within the
  budget, and leave the sandbox brain as it was. Checked: types, unit, check:race, check:multiplayer.
