# Synapse

Wire a neural network, watch evolution train it, drive it. A browser sandbox, and a study tool for how neural networks
learn. Lives at synapse.mouftools.com.

Milestone 1 (`docs/plans/2026-10-30-sandbox-loop.md`) is built: build a brain on the workbench, train it and watch
the population go from crashing to lapping, drive it on an unseen track, change it, train again. What exists is
described in `docs/ARCHITECTURE.md`; the rulings behind it are in `docs/CONTEXT.md`; what is next in
`docs/ROADMAP.csv`. The look and workbench designs are `reference/look-mockup.html` and
`reference/builder-mockup.html` (mock-ups, not part of the build).

## Run locally
Node 22.
- `npm install`
- `npm run dev` — the app at the printed URL (`/bench/` is the dev-only training benchmark).
- `npm run build` then `npm run preview` — the production build, served as Vercel will serve it.
- `npm run check` — everything that can fail a change: types, purity, unit and trainer-contract tests, determinism
  golden hashes, bench time, and the workbench, training, drive and production-build checks in headless Chromium
  (screenshots in `out/s2/`–`out/s4/`). Takes about 6 minutes in a 4-core container.
- `npm run bench` — the S1 evolution benchmark over seeds 1–20 (`out/bench/`); `npm run bench:browser` runs it in
  Chromium.

## Deploy (Vercel)
The site is static: `vite build` writes `dist/`. `vercel.json` sets the build (`npm ci`, `npm run build`, output
`dist`), a fallback of every unknown path to `index.html`, a one-year immutable cache for the hashed files in
`/assets/` and no-cache for `index.html`.
1. In Vercel: Add New → Project → import the GitHub repo `alexmouf-work/mouftools-synapse`. The settings come from
   `vercel.json`. Production branch: `main`. Multiplayer needs `SUPABASE_PROJECT_URL` and `SUPABASE_ANON_KEY` set in
   Vercel (they are mapped into the page at build time); `SUPABASE_SERVICE_ROLE_KEY` is not used by the site.
2. In the project's Settings → Domains add `synapse.mouftools.com`.
3. At the DNS host of mouftools.com add a CNAME record: name `synapse`, value `cname.vercel-dns.com`.
4. Every push to `main` then deploys; other branches get preview URLs.
5. Multiplayer: run `supabase/schema.sql` once in the Supabase dashboard's SQL editor (tables, row-level security, the
   room functions, and the daily job that deletes match data older than 30 days). Safe to run again.
