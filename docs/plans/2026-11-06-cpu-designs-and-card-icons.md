# Varied CPU brain designs; input symbols on the brain card (2026-11-06)

Principal: "the CPU brains need to incorporate multiple layers, multiple types of processing styles and need to vary
the number and type of input neurons that they use. currently the brains have a huge number of input neurons, a medium
number of hidden layer 1 neurons, and then outputs, almost always." · "the brain graph in the corner should also show
the input neuron types."

## 1. CPU designs
- Each of the nine CPU racers gets its own **design style**, which stays recognisable across the rounds and grows as
  the round's power grows. The designs vary along every axis:
  - **Inputs:** 2–8 cells of varied types and mixes. Some lean on boundary cells, some mix in long-range, head
    direction, grid or speed cells. No CPU has a huge input layer.
  - **Hidden layers:** 1–3, with varied widths (2–8). Taper and bottleneck shapes both appear.
  - **Functions:** a mix of Linear, ReLU, Sigmoid and Tanh across layers and across CPUs. No two CPUs share the same
    combination of layer shape and functions.
- Suggested styles, one per racer, as a starting point:
  - **McCulloch:** small, Linear only.
  - **Pitts:** 2 layers of ReLU.
  - **Hebb:** wide single Tanh.
  - **Rosenblatt:** 1 Sigmoid layer, many boundary cells.
  - **Holland:** 3 layers, mixed functions.
  - **Werbos:** a deep, narrow Tanh stack.
  - **Barto:** ReLU → Tanh with a speed cell.
  - **Sutton:** long-range cells plus head direction, 2 layers.
  - **Hopfield:** a balanced 2–3 layer mix, the strongest.
  The builder may adjust them so that every design fits each round's power and still learns.
- **Skill** still comes from the training share (5–100% of T), as now. Every design fits its round's power under the
  round-power rule. The draw is seeded, so it's reproducible.
- **Reporting:** a table of each CPU's design per round (inputs by type, layers with widths and functions), plus their
  race distances. No CPU should end up stuck at 0 m or driving the wrong way because of its design; if a design
  can't learn, change the design, not the skill share.
- This lands together with the round-power stage's CPU regeneration, so the brains are regenerated once.

## 2. Input symbols on the brain card
- The corner brain card (training, race, drive, and following a racer) draws each input node with a small flat symbol
  of its type, the same as the designer's tray icons:
  - **boundary:** a brick wall
  - **long-range:** a distant wall with a sight line
  - **head direction:** a curved arrow
  - **grid:** the hexagon of discs
  - **speed:** a gauge
- The symbols are drawn in 2-D on the card's canvas, not as the 3-D symbols. The node circle stays, and the symbol
  sits inside it or just to its left, legible at the card's size.
- Live firing still shows on the node.
- Check: check:race asserts that the card's input count equals the brain's input count, and that each input is drawn
  with its type's symbol (exposed through a test hook).

## Built (2026-11-06)
1. scripts/sim/cpuBrains.ts gives each racer its own design per round (`STYLES`), checked before training: 2–8 inputs,
   1–3 layers 2–8 wide, within the round's power. Trained under round power (docs/plans/2026-11-06-round-power.md)
   with the long-range cell inverted, so the set is regenerated once (`CPU_VERSION` 4). Shares of T unchanged.
   Distances: 30 s alone from pole on ten race tracks, smallest / median.

   | Racer | Style | R1 (P 20) | R2 (P 40) | R3 (P 64) |
   |---|---|---|---|---|
   | McCulloch | small linear | 2 wall · 2 lin; 253 / 261 m | 3 wall · 3 lin; 323 / 694 m | 3 wall + speed · 4 lin; 1056 / 1108 m |
   | Pitts | two ReLU layers | 2 wall · 3 relu → 2 relu; 296 / 311 m | 3 wall · 4 → 2 relu; 670 / 676 m | 4 wall + speed · 5 → 3 relu; 994 / 1203 m |
   | Hebb | wide tanh | 2 wall · 4 tanh; 337 / 338 m | 2 wall + hd · 6 tanh; 762 / 780 m | 3 wall + hd + grid · 8 tanh; 1086 / 1269 m |
   | Rosenblatt | sigmoid, many walls | 4 wall · 2 sig; 350 / 379 m | 6 wall · 3 sig; 812 / 837 m | 7 wall + speed · 4 sig; 1127 / 1269 m |
   | Holland | three mixed layers | 2 wall · 2 relu → 2 sig → 2 tanh; 355 / 395 m | 3 wall + speed · 3 → 2 → 2; 802 / 856 m | 3 wall + far + speed · 4 → 3 → 2; 1218 / 1333 m |
   | Werbos | deep narrow tanh | 2 wall · 2 → 2 tanh; 414 / 418 m | 3 wall · 2 → 2 → 2 tanh; 858 / 866 m | 3 wall + hd · 3 → 2 → 2 tanh; 910 / 1346 m |
   | Barto | ReLU → tanh, speed | 2 wall + speed · 2 relu → 2 tanh; 391 / 410 m | 3 wall + speed · 3 → 3; 917 / 927 m | 4 wall + speed · 5 → 3; 1311 / 1371 m |
   | Sutton | long range + heading | 2 far + hd · 3 sig → 2 lin; 327 / 382 m | 3 far + hd · 4 → 2; 812 / 880 m | wall + 3 far + 2 hd · 5 → 3; 1234 / 1316 m |
   | Hopfield | balanced mix | 2 wall + far · 3 tanh → 2 relu; 250 / 424 m | 3 wall + far + speed · 4 → 3; 869 / 884 m | 4 wall + far + hd + speed · 5 tanh → 3 relu → 2 lin; 1311 / 1383 m |

   Every brain moves forward on every track (the smallest distance is 250 m). Round 1's distances are short because
   round 1's power caps the car near a third of full speed or below. tests/unit/match.test.ts checks the design rules,
   that no two racers share a layer shape and functions, that all four functions appear, and that designs only grow.
2. The corner brain card (drive/brainPanel.ts, used by the training, race, drive and follow cards) draws each input
   cell's flat 2-D symbol just left of its node (drive/senseGlyph.ts: brick wall, distant wall with a dashed sight
   line, curved arrow, hexagon of discs, gauge). `BrainPanel.glyphs` records what was drawn; `__race.cardGlyphs()`
   exposes it. check:race asserts the followed CPU's card and your own card draw one symbol per input, of its type.
