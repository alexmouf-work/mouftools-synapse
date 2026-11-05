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
