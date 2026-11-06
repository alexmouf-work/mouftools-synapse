# Lobby music, Linear by default, a long-range boundary cell in place of the landmark, the arrow's spin (2026-11-05)

Principal: "while in the lobby waiting for the game to start in multiplayer, use the same music as the title screen." ·
"default the processing method to linear." · "swap the landmark cell for a long-range boundary vector cell. come up with
an appropriate icon for it." · "make the head direction cell's icon rotate the correct direction (following the arrow
around)"

1. **Lobby music:** the Multiplayer lobby, before a match and between matches, plays the title's music (the lounge).
   Going title → lobby carries straight on. main.ts `lobby()` and the lobby's `show` call `setMode('build')`; make
   them 'lounge'. The match's build phases keep their music.
2. **Linear by default:** every new hidden layer starts as Linear, and so does the random starter's hidden layer (the
   first visit, Reset, the start of every match). `defaultSpec()` stays as the checks' fixture, so goldens don't move
   for that reason.
3. **The long-range boundary vector cell replaces the landmark cell** everywhere (sim, designer tray, inspector,
   saves, CPU brains, docs):
   - **What it senses:** the same as a boundary vector cell, but out to **60 m**. Its learnable range is 30–80 m
     (the short cell's is 5–20 m). It fires faster as a wall comes closer within that range. It looks ahead to the
     next bend while the short cell watches the walls nearby.
   - **Directions:** it uses the same useful-direction table as the boundary vector cell, by its own count.
   - **Limits and cost:** max 5 cells, like the landmark. Cost about the same as a boundary vector cell, a little
     more for the longer rays (set it in config, about 1.25×).
   - **Name and line:** "Long-range boundary vector cell". Its description: "fires faster as a distant wall comes into
     range".
   - **Icon:** the boundary cell's brick wall shown small and far off, with a dashed sight line running to it from a
     small eye or lens in the foreground. One reading of "the same wall, seen from far away". It's built in the same
     low-poly 3-D style as the other symbols, and gently animated: the dashes travel toward the wall.
   - **Saves:** a saved brain's landmark cells load as long-range boundary cells, with their weights kept and their
     fields reset to the table.
   - **Knock-on:** goldens using landmark cells change, so say why. Regenerate the CPU brains. The starter's draw
     replaces landmark with the long-range cell. Re-run S1 and report it, without tuning.
4. **Head direction icon:** the 3-D arrow spins the way its arrowhead points. The ring's arc runs counter-clockwise
   to the tip, so the group's z-rotation must increase with time: `g.rotation.set(0.9, 0, t * 0.4)`, not `-t * 0.4`.
   Check it by eye in a screenshot pair.

Checks (affected only): types, purity, unit, determinism, workbench (tray, inspector, icon), training and race (if
the CPU brains change), audio (lobby music).

## Built (2026-11-06)
1. The lobby (main.ts `lobby()` and the lobby's `show`) plays the lounge; a latecomer watching a match keeps the
   build music. check:audio: title → Multiplayer keeps the lounge.
2. New layers (`insertLayer`) and the random starter's layer are Linear; `defaultSpec()` keeps tanh as the fixture.
3. Sense id `far` (in the landmark's place, so the parameter layout is the same): `boundaryValue` at 60 m, learnable
   30–80 m (`FIELD_BOUNDS.farRange`), the boundary table by its own count, max 5, cost 1.875 (1.25×); backprop
   learns its range only, as the short cell's. "Long-range boundary vector cell" / "Fires faster as a distant wall
   comes into range." Icon `farwall` (symbols.ts): a small brick wall far off and a lens in front, dashes travelling
   to the wall (out/s2/far-cell.png). Saves and genome JSON with landmark cells load as long-range cells, weights
   kept, fields reset (`spec.ts migrateGenome`; unit test). The landmark sensor and its gradient are gone. CPU brains
   regenerated (median 30 s alone, weakest to strongest budget: R1 891–1421 m, R2 594–1367 m, R3 723–1329 m).
   Goldens: `raceHeavy` and `raceEight` (the heavy brain had 2 landmark cells, now 2 long-range cells), `match` and
   `round` (the CPU brains) change; every training-phase golden (evolution, backprop, actor-critic, A_RP, ×2, race
   track) is unchanged.
   - **S1:** unchanged. S1 trains `defaultSpec()` (one boundary, one head-direction cell, tanh), which this stage
     doesn't touch, and the phase goldens of all four trainers on it are bit-identical, so the T1 table stands
     (docs/plans/2026-11-05-tracks-v2-and-match-settings.md, T1): median final fitness 2876, (a) 1390 m, (b) 0/20,
     (c) 19/20, (d) 17/20, (f) pass. Not re-run.
4. The head-direction arrow turns with z increasing (`t * 0.4`): out/s2/hd-spin-1.png → hd-spin-2.png.
- The workbench's top bar, tighter since match polish's 44 px buttons clipped the energy split's figures at 1440×900.
- Checked: types, purity, unit, determinism, workbench, audio, race, training.

## Long-range cell inverted (2026-11-06)
Principal: "the long range BVC should fire more when something is further away, less when it's close. this is an
inversion of the short range BVC."
- The long-range boundary vector cell's activation is the inverse of the short cell's response. With d the distance
  to the wall along its field and R its range (60 m by default), it fires d / R, capped at 1. It reads 1 when no wall
  is within range (open road), and near 0 with a wall close by. The short cell is unchanged.
- Description: "fires faster the further away the wall is (up to 60 m)". The inspector's graph and polar field are
  drawn inverted to match.
- The field gradients (fieldgrad.ts) follow the inverted response. A finite-difference unit test checks them.
- Goldens with long-range cells change. This lands before the CPU brains are regenerated (round-power stage).
