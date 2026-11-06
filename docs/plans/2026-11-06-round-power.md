# Round power: the energy bar is always 0–100%, and 100% grows each round (2026-11-06)

Principal: "the % speed vs brain shouldn't be capped at 20, it should always be 100, but the amount that 100 represents
should increase. the car shouldn't go really fast at the beginning"

**Today:** a match round has a budget of 20 / 40 / 64% of a fixed 100-unit scale. The brain uses part of it, and the
car's speed cap is 100% − load (at least 10%). A small round-1 brain therefore leaves the car at about 90% of top speed,
and the bar reads "Brain 4–11% of 20%".

**New model (matches only; the sandbox is unchanged):**
- Each round has a **power** P: round 1 = 20 units, round 2 = 40, round 3 = 64, on the same scale as today's costs.
  The power is shared between the brain and the wheels.
- **The bar is always 0–100% of the round's power.** "Brain x%" is the brain's load at flat out as a share of P, and
  "Speed y%" is what's left (y = 100 − x). It is never "of 20%". Any design whose brain uses more than 100% of P at
  flat out is refused, as now.
- **The car's top speed comes from the power left over, in absolute units:**
  speed cap = max(floor, (P − load) / P_ref), with **P_ref = round 3's power (64)**.
  - Round 1's car tops out near a third of full speed, even with a tiny brain.
  - By round 3 a small brain lets the car approach full speed.
  - A heavy brain always costs speed.
  - The floor stays at 10% of full speed.
- **The sandbox keeps P = P_ref = 100,** so its speed cap (100% − load) and S1 are unchanged.
- **The designer and inspector show it plainly:**
  - the bar's two segments, with "Brain x% · Speed y%";
  - under the bar, a small line: "Round 1 power: top speed about N km/h" (that is, the car's flat-out top speed with
    this design);
  - in the inspector, each neuron's line "At maximum firing rate, uses z% energy", as a share of the round's power.
- **The CPU brains** train and race under the same rule, so regenerate them.

**Knock-on effects:**
- Match races and their goldens change (`match`, `round`, `phaseRaceTrack`); explain why in the commit.
- Training- and sandbox-phase goldens must stay identical, and so must S1.
- Report the speeds that result: top speed per round for the starter brain and for a medium brain, and how far the
  starter gets in a 30 s race in each round.
- Checks (affected only): types, purity, unit (energy), determinism, workbench (bar labels), race, training.
