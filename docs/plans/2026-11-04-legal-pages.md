# Privacy, terms, cookies (built 2026-11-04)

Principal: "give the site a privacy policy and terms of service … normal looking slugs (eg synapse.mouftools.com/privacy)
… keep them simple, add cookie policy and make sure that we comply with UK GDPR, adding a cookie banner at the bottom
when first accessing the site." Controller: Alexander Moufarrige; contact alexander@enkefalos.co.uk (principal's
choice).

- Pages: `privacy.html`, `terms.html`, `cookies.html` (Vite inputs), served at `/privacy`, `/terms`, `/cookies` by
  rewrites in `vercel.json` placed before the app catch-all; the `.html` addresses redirect (308) to the slugs.
- Linked from the workbench's side panel (`.legal-links`), from each other, and from the notice. The title screen,
  when built, links them too.
- The notice (`src/client/legal/notice.ts`) shows at the bottom on the first visit. Synapse stores only what is
  strictly necessary (`synapse.brain`, `synapse.notice`) and sets no cookies, so under PECR there is nothing to consent
  to: the notice informs and links the policy; OK dismisses it for good (`synapse.notice` = version). Bump
  `NOTICE_VERSION` when what Synapse stores changes. If non-essential storage ever arrives (analytics, say), the notice
  must become a real choice (accept / reject, equally easy) before anything is stored.
- Policies state what is true now, plus matches as planned: room code, display name, brain and result go to Supabase,
  deleted within 30 days. **When matches are built, the build must delete match data within 30 days**, and if the
  Supabase client stores anything in the browser, the cookie table and `NOTICE_VERSION` change in the same commit.
- Check: `npm run check:legal` (in `npm run check`): built pages, slug routing via a stand-in for Vercel's router,
  redirects, notice first-visit/dismiss/remember, workbench links, no cookies, phone width, dark mode, console clean.

## Supabase keys (for match mode; names only, values live in Vercel)
`SUPABASE_PROJECT_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are set in Vercel. Vite only exposes
`VITE_*` variables to the browser, so the build maps the URL and anon key in explicitly (`define` in vite.config.ts).
**The service role key never goes to the browser**: it is used only in server functions (`/api`), if at all; row-level
security on every table is what keeps the anon key safe.
