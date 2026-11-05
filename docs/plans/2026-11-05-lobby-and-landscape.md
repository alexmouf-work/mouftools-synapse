# Multiplayer lobby and landscape only (2026-11-05)

Principal: "create a lobby before starting for multiplayer mode so that we can see usernames joining the lobby. use a
similar system to kahoot where the name of the user will pop up in a small container (which fits the text neatly) and
they all fill a space. this could be in a grid or just randomly with small overlaps. mock it up, including the name
entry before joining." · "make the name entry its own whole thing, separately shown after the code entry once the code
is entered." · "don't offer portrait mode." · "the mockups look really good. please build when ready."

Spec: `reference/multiplayer-lobby-mockup.html` (artifact KUvqqqbcXzdEm6noNCuieb, v4). Its bottom strip is mock-only.

## 1. Room code
- The Multiplayer card has one big 4-letter field (A–Z, upper-cased as typed), with no Join button. The fourth letter
  checks the room. A real room moves straight on to the name screen; while it checks, the field dims and is read-only.
- An unknown or full room shows "No room with that code. Check it with the host." (or "That room is full (100
  players).") and selects the letters so they can be retyped.
- "or", then Create a room and Back.

## 2. Name, its own screen
- A header band shows the room code, how many players are in, and Change code (back to the code screen).
- In the middle, on the field colour: "What should we call you?" ("Your room is ready. What should we call you?" for a
  new room). Under it a large name box: 1–16 characters, spaces collapsed, trimmed. Then "Everyone in the room sees
  this.", a counter "n / 16", a "Shows as" preview of the chip, and a full-width Go in.
- A name already in the room (case-insensitive) is refused: "Someone in this room is already called X. Try another
  name." The server checks this too.

## 3. Lobby
- **Header:** room code (large, letter-spaced); "Join at synapse.mouftools.com, then Multiplayer."; "n / 100" and
  "players · r ready"; a legend (filled square = brain handed in, hollow = still building). The host gets Start race
  (r), enabled at 2 or more ready. A player sees "You're in. Waiting for the host to start".
- **Field:** each player is a chip that fits its text: a square in their car colour (filled once their brain is in),
  then the name. Chips pop in (scale 0.35 → 1.1 → 1 over about 0.38 s; none if reduced motion is set).
  - Scattered layout (the default): each new chip tries 80 random spots and takes the one with the least overlap, so
    small overlaps appear only when the room is busy. Positions are kept as fractions of the free space, so the
    layout holds when the window is resized.
  - Font size follows the room: clamp(11, √(field area / n) / 6.2, 17) px.
  - Coordinator call: use rows (wrapped, centred) instead of scattered when the field is short (a phone) and there are
    more than 60 players.
  - Your own chip has an accent border and a soft accent fill.
- **Host:** tapping another player's chip offers "Remove <name>", which removes them from the room.
- **Footer:** Build your brain (it goes to the designer in match mode; after hand-in it reads "Brain handed in ·
  Edit"), a one-line note, and Leave room.
- Lobby music: the build pool, as now.

## 4. Landscape only
- No portrait mode anywhere. On a phone or tablet held upright (portrait and the shorter side under 900 px), a
  full-screen "Turn your phone sideways" card with a rotate icon covers the app. Nothing underneath gets taps, and
  music and sound keep playing.
- The manifest already says `"orientation": "landscape"`. Where the browser allows it (an installed app or
  fullscreen), `screen.orientation.lock('landscape')` is tried and a failure is ignored.
- Remove the portrait layout rules (for example training.css `(orientation: portrait)`) and the portrait screenshots
  from the checks. Desktop windows narrower than they are tall still get the card only when the shorter side is under
  900 px, so a tall desktop window keeps working.
