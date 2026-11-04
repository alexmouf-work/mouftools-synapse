# Build order for everything agreed (2026-11-04)

Principal: "please build all the changes and push to development when ready." One builder, one stage at a time; each
stage lands on `development` only after the full `npm run check` passes, then the coordinator reviews it and starts
the next. The mock-ups in `reference/` and the plans below are the spec; `docs/CONTEXT.md` holds the rulings.

| Stage | What | Spec |
|---|---|---|
| B1 | Arial only, site-wide (no web fonts, canvas and 3-D text included; 400/700; tabular figures) | CONTEXT 2026-11-04 |
| B2 | Brain v2 engine: the five senses (boundary vector, landmark, head direction, grid, speed), one function per layer (Linear, ReLU, Sigmoid, Tanh), speed from firing per tick at the halved costs, sandbox without an energy limit (speed floor 10%), vs CPU/Multiplayer at 100%; up to 8 layers × 8 neurons; default brain; S1 re-benchmark; new goldens | `2026-11-04-brain-designer-v2.md` |
| B3 | Brain v2 designer UI, as `reference/brain-v2-mockup.html`: tray and symbol cells, inspector graphs with axes, one-line descriptions, max-firing energy lines, neuron slider, + and − rules, bin, Reset with confirm, Learning Rule strip, trainer picker, Train asks for generations (sandbox), square corners, touch, landscape stage | mock-up + plan |
| B2b | Learned bias in every neuron and wheel | brain v2 plan §3ab |
| B2c | Title screen first (brought forward): the page opens on it; music from the title on, quick smooth cross-fades, keeps playing when the tab isn't focused; Privacy · Terms · Cookies and music credits in a rail along the title's foot (out of the Learning Rule strip). Sandbox works; vs CPU and Multiplayer show as "soon" until B7/B8 | `2026-11-04-sound.md`, `reference/title-screen-mockup.html` |
| B2d | Larger input cells on the board (radius 16, symbol 1.7× radius, columns spaced to fit); "Train again" → "Keep training"; Temperature slider in the Train popup (§3ac) | mock-up v26 |
| B6 (brought forward) | Training view side panel: left section ≤ 1/5 of the width, its own section not an overlay, fitness per generation over a map of every shown car; random agents from each generation; camera fills the rest | `2026-11-04-tracks-training-matches.md` §3, `reference/training-view-mockup.html` |
| B2e | Receptive fields learn (brain v2 plan §3ad); inspector graphs draw the learned field | plan §3ad |
| B4 | Trainers T2 actor-critic, T3 A_RP (T1 backprop is in) | `2026-11-04-trainers.md` |
| B5 | Track families (loop, kidney, hairpin, chicane, dogleg, clover, figure eight) and the figure eight's decks | `2026-11-04-tracks-training-matches.md` §1–2, `reference/track-shapes-mockup.html` |
| B7 | Title screen (Multiplayer blue, vs CPU yellow, Sandbox plain) and vs CPU: 10 cars, countdown, winner music on a win | same plan §4–5, `reference/title-screen-mockup.html` |
| B8 | Multiplayer: rooms with codes, up to 100 players, nearest cars drawn, corner map, countdown; Supabase | same plan §4, `2026-11-04-legal-pages.md` (keys) |

Notes
- B8 needs the database set up in the Supabase project (tables, row-level security). The builder writes the SQL; the
  principal runs it in the Supabase dashboard (the service role key stays in Vercel). Its checks run against a local
  stand-in; the real service is first tried on the preview.
- The match-data deletion promised in the privacy policy (30 days) is part of B8.
- Order revised 2026-11-04 ("show me the training panel thing please"): B2c → B6 → B2d → B2e, then B4, B5, B7, B8.
