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
