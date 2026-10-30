# Synapse

Wire a neural network, watch evolution train it, race it against four others. A browser game, and a study tool for
how neural networks learn. Lives at synapse.mouftools.com.

Status: milestone 1 (`docs/plans/2026-10-30-sandbox-loop.md`): S1 (headless sim, evolution benchmark) and S2 (the
workbench), S3 (the training view) and S4 (the drive view) are built: build a brain, train it and watch the swarm
learn, drive it on an unseen track, change it, train again. Next: shipping to synapse.mouftools.com. The look is
`reference/look-mockup.html`, the workbench design `reference/builder-mockup.html`.

## Run
Node 22.
- `npm install`
- `npm run dev` — the workbench at the printed URL.
- `npm run check` — types, purity, unit + trainer contract tests, determinism golden hashes, bench time, and the
  workbench, training and drive views in headless Chromium (screenshots in `out/s2/` to `out/s4/`; takes several
  minutes).
- `npm run bench` — the S1 benchmark over seeds 1–20; writes `out/bench/` (report, fitness CSV, path SVGs).
- `npm run dev`, then open `/bench/` — the same benchmark in your browser (`?seed=1&workers=4&runs=2`).
- `npm run bench:browser` — that page in headless Chromium via Playwright, checked against the Node hash.
