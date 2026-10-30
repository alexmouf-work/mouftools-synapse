# Synapse

Wire a neural network, watch evolution train it, race it against four others. A browser game, and a study tool for
how neural networks learn. Lives at synapse.mouftools.com.

Status: milestone 1 (`docs/plans/2026-10-30-sandbox-loop.md`), step S1: the headless sim and evolution benchmark.
Nothing to play yet. The look is `reference/look-mockup.html`, the workbench `reference/builder-mockup.html` (open
them in a browser).

## Run
Node 22.
- `npm install`
- `npm run check` — types, purity, unit + trainer contract tests, determinism golden hashes, bench time.
- `npm run bench` — the S1 benchmark over seeds 1–20; writes `out/bench/` (report, fitness CSV, path SVGs).
- `npm run dev`, then open `/bench/` — the same benchmark in your browser (`?seed=1&workers=4&runs=2`).
- `npm run bench:browser` — that page in headless Chromium via Playwright, checked against the Node hash.
