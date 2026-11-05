# Working rules

- Work on `development` (principal, 2026-11-04: "let's work on a development branch for now"); `main` is what
  synapse.mouftools.com serves and only moves when the principal says so. Commit as the principal, no AI references.
- Plans first: one plan per feature in `docs/plans/`; one builder at a time, building only on the principal's go.
- Rulings are verbatim in `docs/CONTEXT.md`; read it before design changes. What's next: `docs/ROADMAP.csv`.
- The sim (`src/common/`) must stay deterministic: no Math.random/Date/performance, no engine trig (use fmath),
  no Float32. Multiplayer will re-run races on every client, so one drift breaks fairness.
- One NaN pixel blacks out the whole frame through bloom: assert finite sim state and InstancedMesh capacity.
- Say what was checked vs only built. Before every commit run the checks for the affected systems only, not the whole
  suite (principal, 2026-11-05): types and purity, plus the checks covering what changed (determinism and unit tests
  for sim changes; a view's browser check for UI changes). Docs change in the same commit.
- `reference/` holds mock-ups: off the build path, never published.
