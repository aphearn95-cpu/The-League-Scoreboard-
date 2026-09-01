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
- **Boogie Bowl panel** — at the bottom of Standings: shows the 1-seed's
  saved Round 1 opponent preference (if one's been saved) and the resulting
  bracket logic, plus a ranking builder anyone can use to generate the file
  contents to save. See "Setting the 1-seed's Boogie Bowl preference" below.
- **Playoffs** — once the week selector reaches Week 14, the Scoreboard tab
  switches to a "Playoffs & Boogie Bowl" section: the live Boogie Bowl
  matchup (seed 4 vs seed 5, Week 14 only), the two 2-week Round 1 matchups
  once the 1-seed's saved preference resolves them, and — once Round 1
  wraps up — the 2-week Championship and 3rd Place matchups for Weeks 16-17.
  Everything live-updates and folds in projections the same way the regular
  season scoreboard does.
- **Consolation standings** — below the playoff bracket during Weeks 14-17:
  every team that isn't in the final four (seeds 6+, plus whoever loses the
  Boogie Bowl) competes on total points scored across all four playoff
  weeks, no head-to-head. The list live-sorts itself with the current
  highest scorer on top, and each row shows the running total plus its
  week-by-week breakdown. The Boogie Bowl loser is added once that game is
  final.
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

## Setting the 1-seed's Boogie Bowl preference

Near the bottom of the Standings tab is a "Boogie Bowl" panel. Once the
1-seed knows which of seeds 3, 4, and 5 they'd rather face in Round 1
(seeds 4 and 5 play into that spot first), anyone can use the ranking
builder there to order the three teams and click **Generate file to save**.
That produces a small JSON snippet — copy it, then save it as a new file
named `boogie-bowl.json` in the repo (same **Add file → Upload files** flow
you used to deploy the site). Once that file exists, every visitor sees the
saved preference and the resulting bracket logic.

There's no login and nothing locks automatically — anyone can update the
file at any time, including to fix a mistake after Week 14 starts. That's
intentional: this is meant as a shared, honor-system tool for the league,
not an access-controlled one.

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
  Seeding for the playoff bracket and consolation standings is locked in at
  Week 13's final standings.
- Round 1 losers (the two teams that lose their Week 14-15 matchup) play
  each other for 3rd place in Weeks 16-17, alongside the Championship.
