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
