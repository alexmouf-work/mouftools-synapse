# One sidebar for training and racing; a Main menu button (2026-11-05)

Principal: "add a main menu button." · "when in racing mode, keep the sidebar." · "let's swap the position of the map and
the brain during training, and keep it the same layout when in racing mode. The only difference will be that the
training graph will swap places with the race competitor list (showing the top 3 then the nearest racers to the user,
total of 10 racers shown). Make the sidebar take up 1/4 of the width rather than 1/5."

## 1. Layout (training, drive and race views)
- **Sidebar:** the left column is 1/4 of the width (`25vw`; it was `min(20vw, 280px)`). It is its own section, not an
  overlay, as before. The camera fills the other 3/4.
- **Training:** the sidebar holds the fitness graph (top) and **the map** (bottom). The highlighted car's **live brain**
  moves to the camera's bottom-right corner, where the map was. Its corner card is the same size the map's was, and
  it keeps its brain card look.
- **Racing (vs CPU, Multiplayer) and Drive:** the same layout. The only difference is that the sidebar's top shows
  **the racers list** instead of the fitness graph:
  - It lists exactly 10 rows, or fewer when there are fewer cars: places 1–3, then the racers nearest to you in the
    standings, with you among them. Where the two groups don't meet, a thin "⋯" row separates them. Your row is
    highlighted.
  - Each row shows the place, a colour square, the name, and the distance (signed) or the finish time.
  - With 10 cars the list is simply all 10.
- The floating race panel goes; what it held moves into the sidebar: position, lap or time, Skip to results, Back, and
  the sound toggles. Results and standings still open over the camera, as now.
- Phones held sideways: the sidebar stays 1/4. The map takes what height is left under the list or graph.

## 2. Main menu button
- A "Main menu" button goes on every screen except the title: the designer's top bar, the training/drive/race
  sidebar, and the Multiplayer lobby's footer. It returns to the title, and the music crosses to the title's.
- In the middle of a vs CPU match, or in a Multiplayer room, it asks first in the page: "Leave the match?" or "Leave
  the room?", with Leave / Stay. Leaving a room also calls leave_room. In the Sandbox it goes straight to the title,
  because the brain is saved anyway.
- It replaces the "Synapse" word-link back to the title. Back buttons that go one step back stay as they are.
