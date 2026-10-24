# Media for Mirador

A Mirador app plugin (plugin API 2) for editing videos with the agent. See README.md for what it does and how to run it.

- Bun and TypeScript everywhere, strict; imports carry their `.ts`/`.tsx` extensions. React 19 for the view.
- `bun run typecheck`, `bun run test` and `scripts/e2e.sh` before every commit. The e2e runs in a Mirador test host from
  the Mirador checkout in `MIRADOR_DIR`, with Mirador's Playwright.
- Names over comments: keep comments for a genuine "why" that a name can't carry.
- Every change comes with tests: logic gets unit tests, and what the user sees gets e2e coverage.
- Words the user or the agent reads: plain words and sentence case.
- Commits: authored by the owner only, `perdos <erdos.peter.bme@gmail.com>`, with no AI attribution or trailers. One
  plain sentence saying what the user gets.
- The view runs in Mirador's sandboxed canvas frame: no network, no forms (a `<form>` never submits there), no
  localStorage but `window.mirador.storage`. Files reach it through `window.mirador.mediaUrl` and `readFile`.
