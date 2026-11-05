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
