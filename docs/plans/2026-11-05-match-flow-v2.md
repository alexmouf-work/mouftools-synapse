# Match flow v2: no buttons, fresh weights each round, 20 s training; useful boundary directions; no lasers (2026-11-05)

Principal: "please change the interface so that in match mode (vs cpu, multiplayer), the user doesn't have buttons to
train or skip things. Also, when doing successive rounds, reset the brain's weights so that the training can
effectively make use of the added neurons. make the training 20s per round instead of 10." · "change the way the
boundary vector cells work so that they effectively pick useful directions to cover, rather than random directions.
don't show lasers coming out of the car."
This replaces "weights carry over between rounds" (2026-10-30 and the rounds plan) and the rounds plan's 10 s training.

## Stage M1 (vs CPU, and every mode where it applies)
1. **Only the timers move a match on.** In vs CPU and Multiplayer, remove Train, Keep training, Drive, Stop, Skip to
   standings, Next round and Race again. Build ends at 0 and training starts by itself; training ends at its 20 s;
   the race starts after the countdown; standings show for 8 s, then the next round's build starts. Main menu stays,
   and asks first. After round 5 the final standings keep Play again / Main menu, because the match is over.
   - Leave the designer's editing controls and the trainer picker alone. The sandbox keeps all its buttons.
2. **Fresh weights every round.** Each round's training starts from new random weights, biases and fields for the
   design as it stands, so added neurons are used from the start. The design itself (cells, layers, functions)
   carries over. CPU brains train the same way for each round's design.
3. **Training lasts 20 s per round** (round timer "Train" 20).
   - Raise T to the largest multiple of 0.5M that neuroevolution spends within about 12 s on this machine, about 2×
     the current 6M. Report the number.
   - At 20 s, training stops wherever it has got to and keeps the best agent so far (ruling 2026-11-04: stopping
     equals reaching the limit). A slow device gets less training but still races on time.
   - Regenerate the CPU brains at the new T, keeping the same skill spread (fractions of T).
4. **Boundary vector cells cover useful directions.**
   - A brain's boundary vector cells, untrained, point along a fixed table by count. The table is mirror-symmetric
     about the nose, weighted to the front, and spans out to the sides as the count grows. Widths are set so that
     neighbouring fields just meet.
   - Proposed table, which the builder may refine with a short S1 comparison (state the result):
     1 → 0°; 2 → ±30°; 3 → 0°, ±45°; 4 → ±20°, ±60°; 5 → 0°, ±30°, ±75°; 6 → ±15°, ±45°, ±80°;
     7 → 0°, ±25°, ±55°, ±90°; 8 → ±12°, ±35°, ±60°, ±90°.
   - Adding or removing a boundary vector cell re-spreads all untrained ones to the table for the new count. The
     random starter and Reset use it too. Learned fields (sandbox training) are kept until the next training.
   - In a match the fields reset to the table each round, along with the weights.
5. **No lasers.** Remove the boundary-cell beams drawn from the car in every view (drive, race, training).

## Stage M2 (Multiplayer on the same timed rounds)
- The host's Start match begins the same 5 rounds for everyone, with each phase's start fixed on the server's clock.
  Clients run the phases from that shared schedule, so there are no buttons there either.
- At the end of each train phase every client hands in its brain for that round. The server freezes that round's
  entries when the race's countdown begins; a player with nothing in sits the round out with 0 m.
- The standings and totals are the same as vs CPU. Players who join mid-match watch until the next round's build.
- Schema: add round-scoped brains and entries to the synapse_ objects, keeping the file idempotent. The principal
  re-runs it.

## Built: M1 (2026-11-05)
- **Timers only (vs CPU):** the designer has no Train button in vs CPU (`body.rounds #train`), the race view has no
  Skip at all (removed; only vs CPU ever showed it), the standings have no buttons and move on after 8 s; the final
  standings keep Play again / Main menu. Main menu asks first. Multiplayer keeps its buttons until M2 brings it onto
  the timed rounds (rooms train once, by hand, as before).
- **Fresh weights every round:** a match trains every round from fresh weights, biases and fields
  (`trainingView.ts`: a match starts from `zeroGenome(design)`); the design carries over. The edit ops no longer carry
  weights under a match rule (`carryWeights` removed): every edit leaves an untrained brain, as in the sandbox. The CPU
  brains train the same way (each round's design from fresh).
- **20 s training:** "Round n of 5 · Train" counts 20 (red under 5). A round spends `CONFIG.rounds.T` = 12,000,000
  car-ticks (twice the S1 budget `CONFIG.train.T`, which stays 6M so S1 stays comparable). At 0 training stops where it
  got to (`stopTraining`) and keeps the best agent so far; check:race stops one at gen 14 and the race starts on time.
  Measured here (4-core container, 3 workers): evolution alone on the /bench page 6M in 3.70 s, 12M in 7.18 s; a whole
  round in the game view (SwiftShader drawing the view on the same cores) 12M in 18.7 s, 101 generations. **Call:** the
  plan's rule read on /bench alone would allow about 20M (12 s), but the game draws while it trains and 20M would hit
  the 20 s stop on this machine, so T is 12M ("about 2×"). Lower it if devices are cut off at 20 s.
- **CPU brains** regenerated at the round T with the same shares (5–100%), fresh each round: 12–121 generations,
  7.1 min with 4 workers. Median 30 s distance alone on ten race tracks mostly 1.1–1.4 km; a few go the wrong way on
  some tracks (Hopfield R1 −8 m, Hebb R4 50 m, Werbos R4 558 m, Hopfield R5 695 m). Not tuned.
- **Boundary vector cells:** untrained directions from `senses.ts BOUNDARY_DIRS`, the proposed table as written
  (1 → 0°; 2 → ±30°; … 7 → 0°, ±25°, ±55°, ±90°; 8 is in the table, the cap is 7); widths 0.6 × the gap to the nearest
  neighbour (neighbours cross at half activation), 20–60°; one cell keeps 60°. Landmark cells keep the even spread.
  Adding or removing a cell re-spreads the untrained ones to the table (as before for "never learned"). Not refined:
  S1's brains have one boundary cell (0°, 60°, unchanged), so S1 can't compare tables.
- **No lasers:** the drive and race views pass no beams to the car (`beams: []`); check:drive asserts none are drawn.
- **Signed speed cell in the UI:** the designer's speed graph runs from −top to +top forward speed against −1..+1
  ("forward speed (m/s)"), with the gain as before; the description reads "+1 at top speed forwards, −1 at top speed
  backwards". The live brain card (drive, race, training) prints a speed cell's signed value under it (its flashes
  show the rate, |value|, which is also what it costs). check:workbench asserts the graph's axes.
- **S1, evolution** (seeds 1–20, T 6M, the default brain): identical to before, as its one boundary cell is at 0°, 60°
  either way: (a) 1303 m ×27, (b) 12/20 (bar 15), (c) 19/20, (d) Minimal 16/20, gate 20/20. Not tuned.
- **Goldens:** `raceHeavy` and `raceEight` change (the heavy brain's 3 boundary cells now point along the table),
  `match` and `round` change (the regenerated CPU brains); track and every phase golden are unchanged.
- **Checked** (principal 2026-11-05: the affected systems only): types, purity, unit, determinism, check:workbench,
  check:training, check:drive, check:race. Not run: audio, preview, legal, icons, title, multiplayer, bench (untouched).
