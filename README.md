# Job Search Dashboard - Free, Independent Web App

A self-running job search dashboard that costs nothing and needs no Claude/Cowork session to
operate once it's live. Runs on GitHub's free tier end-to-end.

**Honest scope note:** this uses **Adzuna** (free instant API key) and **RemoteOK** (fully
public, no key) as data sources, because those are the only job-board APIs that are genuinely
free and independently usable outside this session. The Dice/Indeed/ZipRecruiter searches we
ran together in chat use connectors tied to this Claude session - they are not portable API
keys I'm able to hand you, and Dice in particular does not offer free public API access to
individual signups. **This app is a supplement to, not a replacement for, running searches here
with me** - it will not have Dice's C2C staffing-firm volume. Use both.

## What it does

- A GitHub Action runs on a schedule (every 6 hours by default, edit the cron in
  `.github/workflows/update-jobs.yml` to change it), or on demand from the Actions tab.
- It searches Adzuna + RemoteOK using the keyword queries in `candidates.json` (edit this file
  to add candidates, change keywords, or adjust match/exclude rules - no code changes needed).
- Per the team's "don't miss anything" goal: nothing that matches is silently dropped. Every
  result that hits at least one required keyword and no excluded keyword is kept, scored, and
  shown - low-confidence or contract-status-unclear results are labeled, not deleted.
- Results are written to `data/jobs.json` and the whole folder is published to GitHub Pages -
  a public URL you can open on your phone, bookmark, whatever, no login needed.

## One-time setup (about 10 minutes, all free)

1. **Get a free Adzuna API key** (optional but recommended - skip and RemoteOK-only still
   works): go to https://developer.adzuna.com/signup, sign up (no card required), copy your
   `App ID` and `App Key`.
2. **Create a GitHub account** if you don't have one: https://github.com/signup (free).
3. **Create a new repository** on GitHub (e.g. `job-search-dashboard`), and push everything in
   this `webapp/` folder to it as the repo root:
   ```
   cd webapp
   git init
   git add .
   git commit -m "Initial job search dashboard"
   git branch -M main
   git remote add origin https://github.com/<your-username>/job-search-dashboard.git
   git push -u origin main
   ```
4. **Add your Adzuna credentials as repo secrets**: on GitHub, go to your repo →
   Settings → Secrets and variables → Actions → New repository secret. Add two:
   - `ADZUNA_APP_ID`
   - `ADZUNA_APP_KEY`
5. **Enable GitHub Pages**: repo → Settings → Pages → under "Build and deployment", set
   Source to "GitHub Actions".
6. **Run it once manually**: repo → Actions tab → "Update job listings" → "Run workflow" →
   Run workflow. Wait ~30 seconds, then your dashboard is live at
   `https://<your-username>.github.io/job-search-dashboard/`.

After that, it updates itself every 6 hours automatically, forever, for free. No further action
needed - just open the URL whenever you want to check it.

## Adding more candidates or changing keywords

Edit `candidates.json` directly on GitHub (or locally + push) - no code changes required. Follow
the same rule from `skills/search-jobs-accurately/SKILL.md`: pull `mustHaveAny` terms from the
actual resume text, and use `excludeIfAny` to keep out adjacent-but-wrong product lines (like
Dynamics CRM/CE polluting a Business Central/NAV search).

## Limitations to know about

- Adzuna's free tier is capped at a few hundred calls/day - fine for this use case (a handful
  of queries every 6 hours), but don't add dozens of candidates with many keyword queries each
  without checking Adzuna's current limits.
- RemoteOK is remote-only by definition - it won't surface onsite/hybrid roles.
- Neither source has Dice's density of C2C-specific IT staffing listings. Treat this dashboard
  as continuous background coverage between the more thorough Dice-powered runs done in chat.
- Every row should still go through `verify-posting` (live-browser check) before anyone applies
  or an outreach draft goes out - this app finds candidates, it doesn't confirm liveness.
