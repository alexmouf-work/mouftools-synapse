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

## Built (2026-11-06)
- energy.ts: `speedCap(load, power = SANDBOX_POWER)` = max(10% of full speed, (P − load) / P_ref). P_ref is 64 (the
  last round's power) for a round and 100 for the sandbox. The sandbox's cap is bit-identical to before. `roundPower(n)`
  = CONFIG.rounds.budgets[n − 1]. The compiled `Net` carries `power` (`compile(g, power)`), and `Runner.tick` caps
  with it. `EpisodeSetup.power` / `PhaseOptions.power` carry it into training, inline and in workers.
  `RaceLength.power` carries it into races: `roundRace(n)` replaces `ROUND_RACE` for vs CPU and Multiplayer rounds.
  A round's training uses its round's power (trainingView), and so does its champion lap.
- Designer, in a round: the bar is 0–100% of P: "Brain x0–x1%" (resting to flat out, as in the sandbox) and
  "Speed (100 − x1)–(100 − x0)%". The 50/50 mark is hidden. Under the bar: "Round n power: top speed about N km/h",
  the car's flat-out top speed with the design. The inspector's "uses z% energy" is a share of P. The sandbox bar is
  unchanged. The refusal is unchanged: more than 100% of P flat out ("this round allows 20%").
- Resulting speeds (CONFIG.car.wheelSpeed 60 m/s = 216 km/h):

  | Brain (flat out) | R1 (P 20) | R2 (P 40) | R3 (P 64) | Sandbox |
  |---|---|---|---|---|
  | Starter, `defaultSpec()` (11.35) | 29 km/h | 97 km/h | 178 km/h | 191 km/h |
  | Medium: 3 wall + 1 hd · 4 tanh (16.9) | 22 km/h (floor) | 78 km/h | 159 km/h | 179 km/h |

  The starter trained on a round's 12M on its race track (seed 7, race seeds 1–3), 30 s alone from pole:
  R1 62 / 451 / 406 m, R2 986 / 972 / 974 m, R3 1500 / 340 / 1247 m.
- CPU brains regenerated under the rule, together with their new designs and the inverted long-range cell
  (docs/plans/2026-11-06-cpu-designs-and-card-icons.md, Built). Goldens: `phaseRaceTrack` (round 1's power), `round`
  (roundRace(1)) and `match` (the new CPU brains) change. `raceHeavy` and `raceEight` change for the long-range cell.
  Every other training-phase and sandbox golden is bit-identical (`phase`, `phaseBackprop`, actor-critic, A_RP,
  `phaseTemp2`, `race`, `track`), so S1 stands.
- Checks: tests/unit/energy.test.ts (round power); check:race asserts the bar's figures and line in rounds 1 and 2
  against Node.

## Review follow-ups (2026-11-06)
- **Refusal in shares of the round's power** (coordinator): "This design needs 118% of round 1's power.", the same
  rounded figure as the bar's flat-out "Brain" share (energy.ts `energyRefusal`). check:race asserts the toast and the
  bar agree. Multiplayer's 100% rule keeps its own wording.
- **The race timer reads the race's clock** (principal, again: "Finish" showed while the sidebar read 0:29). phaseTimer
  `driven` timers (vs CPU and Multiplayer races) are set by raceView's `drivePhase(secondsLeft, ended)`, in the same
  update as the sidebar's clock. The timer shows the whole seconds left rounded up, and the sidebar shows the time
  gone rounded down, so the two always add up to 30. "Finish" shows only once the race has ended, the same `ended`
  that makes the sidebar say "finished". The cause: the timer ran on the wall clock from Go, while a check's hold or
  seek moved only the race's clock. check:race watches both, on two pages, at every change of the page: they agree
  at every sampled moment, and "Finish" shows only after "finished".
- **Brain card symbols** about twice the size: 14–22 px, to fit the inputs' spacing, in the text colour. The nodes
  sit further right to make room. check:race asserts at least 14 px.
- **Sandbox Stop** (principal: "in sandbox mode, the stop button during training isn't obvious"): a full-width red
  "■ Stop training", 52 px, bold, directly under the Main menu / sound row. It reads "Stopping…" until the best so
  far is saved, then gives way to Drive / Keep training / Back (44 px). Esc stops too. Matches have no Stop.
  check:training asserts the colour, size, place, Esc, "Stopping…" and the 44 px buttons
  (out/s3/stop-button.png).
