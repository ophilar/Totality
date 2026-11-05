# Visual regression: 0.4.2 versus 0.5

This comparison executes **real Electron applications**, not render mocks. The GitHub Actions workflow `.github/workflows/visual-regression.yml` runs for PRs targeting `v0.5.0-clean` and can be started manually.

## Data and capture model

1. FFmpeg creates real movie, episode and music files from the version-controlled recipe in `scripts/visual-regression.mjs`.
2. The 0.4.2 application imports these files through its actual Electron IPC, scanner and task queue, populating a private SQLite database.
3. After 0.4.2 shuts down, the 0.5 candidate starts in a **separate user-data directory**. Its initial database is replaced with a copy of the 0.4.2 snapshot, and 0.5 then performs its real migrations.
4. Both versions' PIN-protected web servers are opened sequentially by Playwright's Chromium at fixed desktop (1440×900), tablet (820×1180) and mobile (390×844) viewports. This tests the actual responsive web UI without hitting Electron's minimum window width.
5. Each matched scenario produces a 0.4.2 screenshot, a 0.5 screenshot, a magenta pixel-difference overlay and a success/failure record.

The workflow artifact is `totality-042-vs-05-visual-report`; extract it and open `index.html`. User profiles, application databases and media are not uploaded.

## Review protocol

Pixel differences are diagnostics, **not regressions by themselves**: v0.5 has intentional redesigns. Missing screenshots and interaction failures fail the check. Review every change as improvement, regression, equivalent alternative, or intentional 0.5 redesign, and record conclusions in the PR.

The accepted v0.5 baseline must be created **after** design review. This initial workflow does not automatically replace it with v0.4.2 snapshots.

## Local commands (Linux)

Install Node 22, FFmpeg, Xvfb, Playwright 1.64.1, Chromium and Sharp. Build both checkouts (`npx vite build`) and run:

```sh
node scripts/visual-regression.mjs fixtures /tmp/totality-media
xvfb-run -a node scripts/visual-regression.mjs capture /path/to/baseline /tmp/totality-media /tmp/totality-report 0.4.2 -
BASE_DB=$(node -e "process.stdout.write(require('/tmp/totality-report/0.4.2.json').dbPath)")
xvfb-run -a node scripts/visual-regression.mjs capture /path/to/candidate /tmp/totality-media /tmp/totality-report 0.5 "$BASE_DB"
node scripts/visual-regression.mjs report /tmp/totality-report
```

## Explicit limitations

* The suite covers baseline navigation to dashboard, Movies, TV, Music, wishlist, Settings, and a search state where available. It does **not yet** assert all sorting, filtering, dialogs, pagination, error/loading states, or source switching.
* Mobile Dashboard and Settings are not offered in the same navigation layout; they are excluded from matching scenarios.
* The fixture dataset is intentionally small, and thus does not validate pagination or dense libraries.
* The comparison needs a stable OS/font stack. Changed-pixel percentages measure differences, not design quality.
* A broken app, failed real scan or absent UI selector is reported as a failure; the runner does not fabricate replacements.
