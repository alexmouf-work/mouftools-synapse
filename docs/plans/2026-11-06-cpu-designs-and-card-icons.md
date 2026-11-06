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
