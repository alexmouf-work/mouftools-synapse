# Follow a racer (2026-11-05)

Principal: "make it possible to click on a racer to follow their car with their brain."

- **Where:** during a race (vs CPU, Multiplayer), each row of the sidebar's racers list can be clicked or tapped,
  and so can a car's dot on the sidebar map (the nearest dot within 16 px).
- **What it does:**
  - The chase camera moves smoothly over about 0.4 s to that car and follows it.
  - The corner brain card switches to that racer's brain, firing live; its title reads "BRAIN · <name>".
  - That racer's row is outlined in the list. Your own row keeps its highlight, so you can always find yourself.
  - The sidebar's Position and Distance figures stay yours.
- **Back to you:** tap your own row, or the "Back to my car" button that shows in the sidebar while you follow
  someone else.
- **Drawn cars:** in a big room only the nearest cars are drawn in 3-D. "Nearest" now means nearest to the followed
  car, so the cars around it are drawn. The followed car is always drawn and is never a ghost.
- **Brains:** every client already has every entry's brain, because each client re-runs the race. The card shows
  that brain's activity, computed from the same replay. Nothing new comes from the server.
- **Edges:** following resets to your own car at each new race. A racer who isn't in this race (sat out) can't be
  followed, so their row isn't clickable. Keyboard: rows are buttons, so Enter or Space follows.
- **Not in training:** the training view keeps following its highlighted car, as now.
- **Check:** check:race follows a CPU racer. The camera target and the brain card's name change, the card's live
  values differ from your brain's, and "Back to my car" returns both. check:multiplayer covers the same in a room,
  including that the followed car is drawn when it's far from you.

## Broadcast camera in matches (2026-11-05)
Principal: "change match mode to use broadcast mode. make the broadcast camera start from further away and change shot
slightly less frequently."
- vs CPU and Multiplayer races use the broadcast camera (`tv`), not the chase camera. It follows the followed car
  (yours by default). The grid and countdown shot can stay as it is; broadcast takes over at Go. Drive (sandbox)
  keeps its Chase / Broadcast / Showroom choice, with Chase as its default.
- Further away: camera spots move out from 24–36 m off the centreline to about 40–60 m, and up from 4–13 m to about
  8–18 m. The framing widens from about 8 m to about 11 m of car-and-road, so the car stays clearly visible.
- Slightly less often: spots are spaced about 140 m along the track instead of 104 m. A shot is also held for at
  least 3 s before the camera cuts again, unless the car leaves the frame.
- Keep the bloom and NaN guards, and keep the spots clear of scenery (keepClear).
