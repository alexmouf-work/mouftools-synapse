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

## Built: M2 (2026-11-05)
- **One schedule on the server's clock** (`src/common/schedule.ts`): the host's Start match sets the match's start
  (`match_at`, the server's now); every phase follows at a fixed time. Round 1: build 60 s, train 20 s; rounds 2–5:
  build 20 s, train 20 s; then, every round, hand in 3 s, the race's countdown 5 s (the entries freeze as it begins),
  the race 30 s, the cars hold 1.5 s (as vs CPU), standings 8 s. The final standings start 469.5 s after Start match.
  Each client runs one 100 ms ticker against its estimate of the server's clock (`net/rooms.ts serverNow`, from every
  reply) and moves the match on from it; the phase timers only show the time left and are re-set to the schedule
  whenever they drift more than 0.3 s (`phaseTimer.ts retimePhase`). `ui/rounds/roomRounds.ts` runs it.
- **No buttons:** a room's match uses vs CPU's views (`body.rounds`: no Train; the training view and standings without
  buttons). Each round: the designer in match mode under `CONFIG.rounds.budgets` (the design carries over, fresh
  weights every round; round 1 starts from the starting brain), Train at the build's 0, training on `CONFIG.rounds.T`
  that stops at the train phase's end and keeps the best so far, which is handed in then
  (`synapse_submit_round_brain`). A design still over the budget at 0 never trains and sits the round out.
- **Entries:** the server freezes a round's entries as its countdown begins: the first `synapse_round_entries` request
  after the freeze time writes them (under the room's row lock, in join order) and every later request gets the same
  text; a brain is refused after the freeze ("too late"), before the round ("too early"), and from a player who
  joined after the round's build began ("not in this round"). Every client keeps the valid brains within the round's
  budget, computes the race (`ROUND_RACE`, track seed `derive(match seed, 0x50d5, n)` as vs CPU) and counts down to
  the server's Go. Anyone with nothing in, or a brain left out, has 0 m that round.
- **Standings and totals as vs CPU** (signed distance; the table and title shared via `rounds.ts showStandings`): every
  player in the round (the entries, plus everyone in the room from the round's build), best total first, then this
  round's distance, then the name (unique in a room), so every client lists them in the same order. Each player's
  round result (match, round, place, distance, total) goes to the room as before.
- **Joining mid-match:** you watch from the lobby ("Watching"; the round's countdown in its bar; "You join at round n's
  build"), then the round's race without a car, and its standings (the rounds before you came are run from their
  frozen entries); you play from the next round's build. Joined during round 5's build or later: you watch to the end.
- **Main menu** asks "Leave the room?" first, everywhere in the match. After round 5 the final standings stay with Play
  again (the host: the next match for everyone in the room; the server refuses one while a match is still being
  raced) and Main menu; the winner music plays if you lead.
- **Lobby:** Start match (the host, 2 or more in the room) replaces Build your brain, Hand in and Start race; the
  "brain handed in" legend and filled chips are gone.
- **Schema** (`supabase/schema.sql`, still idempotent; **the principal re-runs it**): `synapse_rooms` gains `match_no`,
  `match_seed`, `match_at`; new tables `synapse_round_brains` (a player's brain per round, deleted with the player
  until frozen) and `synapse_round_entries` (each round's frozen entries), both with row-level security and no grants,
  deleted with the room (the 30-day purge covers them); new functions `synapse_start_match`,
  `synapse_submit_round_brain`, `synapse_round_entries` (anon) and helpers `synapse_round_start`,
  `synapse_round_freeze`, `synapse_match_over` (not callable); `synapse_join_room` returns when you joined and
  `synapse_room_state` the match and each player's join time. Tested on a local Postgres 16 (stub `anon` and
  `authenticated` roles, pgcrypto in `extensions`, a stub `cron` schema; the `pg_cron` line left out there): run over
  the previous version with a room and a race in it, then twice more, and twice on an empty database, with no errors;
  then as `anon`: every refusal above, entries null before the freeze and identical after, a brain withdrawn by
  leaving before the freeze, a new match clearing the last one's brains, the helpers and tables not reachable.
  `tests/unit/schedule.test.ts` checks the schema's numbers against `CONFIG`. `scripts/checks/standin.ts` implements
  the same rules.
- **Calls made:** hand in 3 s and countdown 5 s (the plan names neither: 3 s covers the stop and the request, the
  race takes about 0.4 s to compute for 96 brains); Start match needs 2 in the room (as Start race did); round 1's
  build starts at the press, without a lead-in. The single-race functions (`synapse_submit_brain`,
  `synapse_start_race`, `synapse_race_entries`) and their columns are kept, because the build on `main` still calls
  them; drop them once `main` has moved on.
- **check:multiplayer** now plays a whole match, jumping ahead with `__phase.skipTo` (in a room it moves that client's
  view of the server's clock as far; the check moves the stand-in's clock to match, and holds the standings while it
  reads them): Start match → round 1's build on both (60 s, no Train), Train by itself, no buttons, the best brain
  handed in at the train phase's end, refusals for a later round and after the freeze, the race = Node on every page
  (97 in; one bot past the budget left out, one with nothing in at 0 m), Go at the server's moment, the 100-car
  drawing and sidebar checks, standings = Node with no buttons for 8 s; a latecomer in round 2's build watches, then
  plays rounds 3–5; Main menu asks "Leave the room?"; the final standings = Node's totals with Play again for the host
  only; Play again starts match 2 on every page; Leave. The latecomer's page makes its 3-D stage first (a vs CPU
  round's race, then Main menu): SwiftShader took about 25 s to make one mid-match, while the server's clock ran on.
  Noted, not fixed: a page whose first tap is in a `?view=race` race (checks only) gets a music error, as the audio
  clock is still near 0.
- **Checked** (the affected systems): types, purity, unit, determinism, check:multiplayer, check:race (shared standings,
  race view and phase timer), check:title (main.ts routing). Not run: workbench, training, drive, preview, legal,
  audio, icons, bench.

## Built: M2 fix, 10-row tables (2026-11-05)
Coordinator's review of the M2 screenshots: in a 96-player room the standings panel reached the top of the camera,
and the round's timer covered its title and headers. Principal: "only show 10 racers at a time, not all of them. same
rules as before where we always show podium then also show the nearest ones to the player."
- **10 rows at most** in every standings and results table (each round's standings and the final standings, vs CPU
  and Multiplayer, and the race view's results panel). The rows are chosen by the sidebar's racers-list rule, through
  the same function (`raceView.ts listRows`, via `tableRows`): places 1–3, then the rows nearest yours in the table's
  own order (standings by total, results by place), with a "⋯" row where the two groups don't meet. Watching (no row of
  your own), or 10 players or fewer, it shows the top 10. Nothing scrolls.
- **Clear of the timer:** while a countdown shows (`body.timed`), the panel starts below the timer's box plus a gap
  (`training.css`: 50 px plus the timer's number size), at 1440×900 and 844×390. The final standings (no timer) stay
  centred.
- **Checks:** a shared probe (`scripts/checks/fixture.ts` `STANDINGS_LAYOUT`, `standingsClear`). check:multiplayer: a
  98-player table (96 raced) shows exactly 10 player rows and the "⋯", places 1–3 and your row, clear of the timer at
  both sizes, each page's rows = Node's standings picked by the same rule written out in the check; the final
  standings likewise on all three pages. check:race: vs CPU's standings show all 10 rows, clear of the timer at both
  sizes.
- **Hand-in made earlier:** a run of check:multiplayer had one page's round 3 brain refused, as it reached the stand-in
  after the freeze (that page was busy drawing under SwiftShader; the 3 s window after training was not enough).
  Training that finishes its whole budget before the 20 s is final, so its brain is now handed in at once; a run
  stopped at the train phase's end is handed in then, as before. A failed hand-in is tried once more if the freeze is
  still more than 0.5 s away. The check prints the page's reason if a brain is refused.
- **Checked:** types, check:multiplayer, check:race.
