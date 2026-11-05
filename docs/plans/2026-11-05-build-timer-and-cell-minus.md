# vs CPU build timer, and a minus on the selected cell (2026-11-05)

Principal: "add a small minus symbol in a bubble on the top right corner of the neuron that's currently selected, without
showing any if no neurons are selected." · "I don't see the timer for the build phase anywhere (I'm playing vs CPU on the
latest dev build). please make that extremely obvious, and count down from 30."

## 1. Minus on the selected cell (designer, every mode)
- The selected cell gets a small "−" bubble on its top-right edge. This covers input cells and hidden neurons, not the
  wheels. It is drawn in the same style and colours as the board's other "−" bubbles, but smaller (about 0.45× a
  cell's radius) so it doesn't hide the cell.
- Tapping it removes that cell, the same as the inspector's bin (`rm` / `rmN`). Selection then clears.
- No cell selected means no bubble. A cell that can't be removed (the last neuron of a layer) gets no bubble, as the
  bin is hidden there too. The inspector's bin stays.
- Touch target at least 32 px. Keyboard: the bubble is focusable after the cell, and Delete or Backspace on a selected
  cell does the same.

## 2. Build timer (vs CPU)
- Opening the designer for vs CPU starts a 30 s build timer. It must be impossible to miss: a big countdown at the
  top centre of the screen in the vs CPU yellow, reading "Build time" over a large number (30, 29, …). It is at least
  as tall as the Train button's row, with large tabular figures.
- In the last 10 s it turns red. In the last 5 s it pulses once a second (none with reduced motion) and each second
  plays a short tick on the Sound effects bus.
- At 0 it shows "Time's up" and starts Train itself with the design as it stands. Edits past the limit are already
  refused, so the design is always valid. Pressing Train earlier stops the timer.
- The timer runs only while the vs CPU designer is on screen, and starts at 30 again each time a new vs CPU build
  begins (title → vs CPU, and "Race again" when it goes back to building). Back to the title cancels it.
- Multiplayer and Sandbox: no timer (Sandbox is untimed by ruling; Multiplayer waits for the host). Coordinator call,
  open to change.

## Built (2026-11-05)
- §1: the selected cell's "−" (`designer.ts` `removal()`, shared with the inspector's bins and the Delete/Backspace
  key). Radius 0.45× the cell (≥ 5.5 px for neurons), drawn right after its cell so it is the next thing focused; touch
  target 33 px on screen at least. Enter or Space now presses any focused board button, and focus survives the redraw.
- §2: built as a reusable phase countdown, `src/client/ui/phaseTimer.ts` (`startPhaseTimer({ label, seconds, red,
  pulse, upText, host, onZero })`, coordinator 2026-11-05: the rounds stage uses it for every phase). vs CPU's build
  timer is "Build time", 30 s, hosted in the rule strip (which grows to 48 px while it shows, so it sits top centre
  between the top bar and the board). Tick: `sfx.ts` `tick()`, a short C♯6 on the effects bus. "Time's up" shows for
  0.8 s, then Train starts. Check hook: `window.__phase` (state, label, text, red, pulse, `skipTo(s)`).
- Calls made: the timer starts afresh every time the vs CPU designer opens, including Back from training or from the
  race (each is a new build); "Race again" still races at once (it doesn't go back to building). If time runs out on a
  design past the limit (a sandbox brain brought into vs CPU), it says why and Train starts by itself as soon as an
  edit brings the design within.
- Checked: check:workbench (the "−" only on a selected removable cell, its place and size, it and Delete remove the
  cell) and check:race (timer at 30 in yellow top centre, red at 10, pulse and tick at 5, "Time's up", Train starts
  itself; Train pressed earlier and the title cancel it), plus types, purity, unit, check:audio and check:title.
