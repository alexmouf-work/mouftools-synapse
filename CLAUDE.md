# Working rules

- Work on `main`, commit there the whole way through (principal, 2026-10-30).
- Plans first: one plan per feature in `docs/plans/`; one builder at a time, building only on the principal's go.
- Rulings are verbatim in `docs/CONTEXT.md`; read it before design changes. What's next: `docs/ROADMAP.csv`.
- The sim (`src/common/`) must stay deterministic: no Math.random/Date/performance, no engine trig (use fmath),
  no Float32. Multiplayer will re-run races on every client, so one drift breaks fairness.
- One NaN pixel blacks out the whole frame through bloom: assert finite sim state and InstancedMesh capacity.
- Say what was checked vs only built. Run the checks before every commit. Docs change in the same commit.
- `reference/` holds mock-ups: off the build path, never published.
