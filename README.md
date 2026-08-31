# League Median Tracker

A live scoreboard + season standings page for your Sleeper league's "median team"
setup. Pulls directly from Sleeper's public API — no login, no backend, nothing
to host except plain static files.

It's pre-configured for **The League** (Sleeper league ID `1387827434572754944`,
2026 season).

## What it does

- **Scoreboard** — one card per matchup for the selected week, styled like
  Sleeper's own board. The median team's card shows its live score and, in
  small text, which real team it's currently "tracking."
- **Median math** — each week, 10 of your 11 real teams play in 5 head-to-head
  matchups; the 11th plays the median team. The median team's score is the
  **5th-highest score among those other 10 teams**. To decide *which* team is
  currently 5th while games are still being played, the app ranks teams by a
  live-updating projection (final projection for players whose game hasn't
  kicked off yet, actual accrued points for players whose game has started or
  finished) rather than by raw live score — so an early Thursday-night outlier
  doesn't wrongly grab the median slot. Once every game in the "other 10"
  finishes, that projection-based ranking always resolves to the true final
  5th-highest score.
- **Click a matchup** to see both lineups starter-by-starter with live
  points, same as Sleeper's matchup detail view. Click the median matchup and
  you'll see exactly which team it's mirroring and why.
- **Standings** — season record/PF/PA for all 11 real teams, with two cut
  lines: one between seeds 3 and 4 (Boogie Bowl bye) and one between seeds 5
  and 6 (playoff cut). The median team is pinned in its own section at the
  bottom with its own record/PF/PA, but isn't seeded.
- **Auto-refreshes** every 30 seconds while the page is open.

## Deploying to GitHub Pages (2 minutes, no command line)

1. Go to [github.com/new](https://github.com/new) and create a new repository
   (public or private both work). Name it anything, e.g. `league-median`.
2. On the new repo's page, click **Add file → Upload files**, then drag in
   all 5 files from this folder (`index.html`, `style.css`, `sleeper-api.js`,
   `scoring.js`, `app.js`). Commit the upload.
3. Go to the repo's **Settings → Pages**. Under "Build and deployment,"
   set **Source** to "Deploy from a branch," pick the `main` branch and
   `/ (root)` folder, then **Save**.
4. GitHub will give you a URL like `https://yourname.github.io/league-median/`
   within a minute or two. That's your shareable, bookmarkable link.

To update it later (e.g. if you ask me for changes), just re-upload the
changed files through the same "Add file → Upload files" flow and commit —
GitHub Pages redeploys automatically in under a minute.

## Updating for a new season

Sleeper issues a brand-new league ID every season. When that happens, open
the page, click the **⚙ settings** icon, and paste in the new league ID —
no need to touch the code or redeploy.

## Notes / limitations

- This is a fully static, client-side page — it fetches from Sleeper's API
  directly in your browser. There's no server, so "live" only updates while
  the tab is open (it polls every 30s).
- Custom league scoring is respected everywhere: projected points are
  computed from your league's actual scoring settings, not generic
  standard/PPR numbers.
- Standings only count fully completed weeks; the in-progress week is shown
  live on the Scoreboard tab but not folded into the standings table yet.
- The Boogie Bowl bracket itself (who actually plays whom) isn't simulated —
  only the two seed-based cut lines are drawn, since the real pairings depend
  on the 1-seed's pre-ranking decision each year.
