# Match polish: 3 rounds, best distance, same track, cameras, POV, race timing, sidebar sizes (2026-11-05)

Principal: "race on the same track that the car trains on." · "change the camera positions so that they're placed with
direct line of sight to the track, no trees or stands in the way." · "swap between broadcast and POV (camera on top of
the back of the car so that it looks like a car-mounted cam)" · "the race says finish before it actually finishes.
make sure that time is measured relative to the start timestamp." · "make it only 3 rounds, and do the best distance
travelled rather than total." · "adjust the UI so that the map and the leaderboard are equal sizes, and make the main
menu / music / sfx buttons much larger and easier to interact with." (Also "fix the workshop interface when loading
back into it": the designer re-layout fix, landed with the loading fix.)

## 1. Three rounds, scored by best distance
- A match is 3 rounds: build 60 s, then 20 s, then 20 s; train 20 s; race 30 s; standings 8 s.
- Budgets: 20%, 40% and 64% (round 1, ×2, ×3.2, keeping the old first and last).
- Score: each player's **best single-race distance** across the rounds; ties go to the higher total. The standings
  show "Race n" and "Best" columns (and the running best). The final standings show the best. Labels read
  "Round n of 3".
- The same for vs CPU and Multiplayer. The shared schedule (src/common/schedule.ts) and the schema's numbers change
  to match: the schema stays idempotent, and the principal re-runs it. Regenerate the CPU brains for 3 rounds.

## 2. Race on the training track
- In a match, each round's training runs on that round's race track, and only that one, so the brain learns the lap
  it will race. The map setting ("New track each round" / "One family" / "One track") still picks the round's track.
  The sandbox is unchanged: training on the chosen track, then another track of its family.

## 3. Cameras
- **Line of sight:** every broadcast spot must see the stretch of track it covers. Cast rays from the spot to the
  road samples it covers. Any tree, grandstand, billboard, gate or hill in the way is either moved out of the
  corridor (keepClear corridors from spot to road) or the spot is moved or dropped. A unit or check test asserts that
  no scenery box meets a spot's sight lines.
- **Broadcast ↔ POV:** races cut automatically between broadcast shots and an onboard POV camera. The POV sits on top
  of the back of the followed car, just above the rear wing, looking forward over the car with a little of the car
  in view, rigidly mounted with slight vibration. Suggested pattern: broadcast for 5–8 s, POV for 4–6 s, with no cut
  in the first 2 s after Go and no cut sooner than 3 s. Following another racer follows them in both shots.
  NaN/bloom guards stay.

## 4. Race timing
- The race clock is measured from the race's Go timestamp. Its display, its 30 s end and the "finished" state all
  come from the same Go time, so "Finished" appears only when the sim has actually run 30 s (600 ticks) and the cars
  have stopped. Find why it said finished early (likely the countdown's time or the timer's start being used as the
  race's start) and fix it at the source. check:race asserts that "finished" shows only once the race clock reaches
  0:30 and the replay is at its last tick.

## 5. Sidebar
- In the race and training views, the racers list (or fitness graph) and the map each take **half** of the sidebar's
  height.
- The Main menu, Music and Sound effects buttons become **much larger**: at least 44 px tall, with large icons and
  text. They move to their own row at the top of the sidebar, Main menu on the left and the two toggles on the
  right, with clear gaps. The same goes for the designer's top bar and the lobby footer wherever they're small.

## Built (2026-11-06)
- **§1 Three rounds, best distance.** `CONFIG.rounds`: count 3, build 60 / 20 / 20 s, budgets 20 / 40 / 64%.
  `common/sim/match.ts` `matchScore` (best single race, total) and `byScore` (best, then total) order vs CPU's and a
  room's standings; the table reads Place · Name · Race n · Best; labels "Round n of 3". `common/schedule.ts` follows
  the config; supabase/schema.sql has the same numbers (`array[60,20,20]`, `synapse_round_freeze(p_at, 3)`, every round
  check 1–3, the tables' checks dropped and added again, rounds 4–5 rows of an older match deleted first). The schema
  test (local Postgres 16: the previous version with a 5-round match in it, the new file over it, then twice more)
  passed: rows of rounds 1–3 kept, a round-4 row refused, schedule 0 / 127.5 / 215 s, freeze 3 at 258 s, over at
  294.5 s, a round-4 brain refused ("no such round"). tests/unit/schedule.test.ts checks the SQL's round checks too.
  CPU brains regenerated for 3 rounds (`CPU_VERSION` 3; round 1's are unchanged, so the `round` golden is too; the
  `match` golden, a race of the last round's brains, changes). Median 30 s alone on ten race tracks, weakest to
  strongest budget: R1 826–1421 m, R2 965–1367 m, R3 592–1329 m.
- **§2 Race on the training track.** A match's round trains on one track: its race track, generated as that race's
  track (`EpisodeSetup.raceCars`, so the pads sit where the race has them). vs CPU knows the race has 10 cars; a room
  counts the players in since the round's build (a player who leaves or hands nothing in can move the race track's
  pads, never its layout but in a rare pad rejection). The prewarmed scene is that track. New golden `phaseRaceTrack`.
  Cost: on one track a generation is half the car-ticks, so a round's 12M runs about 200 generations instead of 100.
  Node: the same time (6.2 s against 6.1–6.7 s on 3 workers). In this container's headless Chrome (SwiftShader,
  1920×1080) a round took 30 s instead of 19 s, because every generation waits on the main thread, which software
  rendering keeps busy; the round's 20 s timer stops it where it got to, as before. A round now records ghosts for
  the view at most every 0.6 s (the view shows one for 2 s at least; display only), which saved 2 s of the 13.
- **§3 Cameras.** `render/sight.ts`: obstacles are each mesh's (and instance's) own box under its own transform; a spot
  covers a stretch of road (the car about 12 samples before it, ±80 m) and the first candidate (outside, then inside;
  offsets 40–60, 50, 30, 60 m; heights 8–18, 14, 20 m) whose sight lines to every sample of it, at roof height on the
  centreline, miss the stand, crowd, gates, boards, lights and chevrons is taken; otherwise the one with the longest
  clear run through the middle, covering only that; under 50 m, no spot. Trees keep out of every spot's corridor
  (`scenery.ts`, the canopy's widest box plus a margin). tests/unit/sight.test.ts: 13 race tracks, every family, 226
  spots, 17,151 sight lines clear of every box, trees included, and over the terrain; spots cover 96% of the road.
  The race director (`DriveRig` mode `race`): broadcast 5–8 s, POV 4–6 s (lengths from the track seed), no cut in the
  first 2 s or sooner than 3 s after the last, on real seconds; where no spot covers the car, the POV. The POV is on
  top of the back of the followed car, 0.33 m over the rear wing, looking forward over it, rigid with a slight
  speed-scaled vibration (none with reduced motion); following another racer cuts both shots to them. The drive
  view's Broadcast camera keeps the old rule but prefers spots that cover the car. The canopy's coat is softer: from a
  broadcast spot above the grid it glinted to 1.43 (bloom audit).
- **§4 Race timing.** Cause: playback time was summed from frame times capped at 0.25 s, while the race timer counted
  real seconds from the frame after Go; under load the replay fell behind, so the timer said "Finish" (and the round
  moved on) while the cars were still racing. Now the race clock is measured from Go's timestamp (`goRef`): playback,
  the race timer (`startPhaseTimer`'s new `until` = Go + 30 s; a room's no longer retimed from the server clock during
  the race) and "finished" all come from it. check:race watches the page: "finished" first shows at the replay's last
  tick with the clock at 0:30, and "Finish" exactly 30 s after Go.
- **§5 Sidebar.** Training, race and drive sidebars: a top row with Main menu on the left and Music and Sound effects
  on the right, each at least 44 px (the text and padding narrow on a 211 px sidebar); the fitness graph or the
  status and racers list, and the map, each take half of what is left (the race list scrolls inside its half on a
  short screen). Main menu and the toggles are 44 px everywhere else too: the workbench's top bar (scaled with the
  workbench, `--unscale`), the lobby's footer, vs CPU's settings, the title.
- Checked: types, purity, unit (all), determinism (goldens updated: `match`, because the last round's CPU brains
  were regenerated, and the new `phaseRaceTrack`; every other golden unchanged), race, training, multiplayer,
  workbench, title, drive, audio; the schema on local Postgres 16. The principal re-runs supabase/schema.sql.
