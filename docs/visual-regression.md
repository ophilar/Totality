# Visual regression — upstream baseline versus candidate

The [visual comparison workflow](../.github/workflows/visual-regression.yml) compares actual Electron applications, using `master` (0.4.4) as the reference and the checked-out candidate branch as the target. It runs on pull requests to any branch when relevant files change and supports manual dispatch.

It installs the application dependencies, builds both applications, creates local media fixtures with FFmpeg, imports them via the real Electron IPC/scanner, and carries the reference SQLite database into the candidate for migration. It captures desktop, tablet and mobile pages through Chromium/Playwright and records screenshot differences and interaction failures.

The HTML report artifact is `totality-visual-comparison` (retained for **3 days**); extract it and open `index.html`. Screenshots are diagnostic: intentional redesigns require review, while missing screenshots, broken navigation, or unsuccessful scans fail validation.

## Local Linux verification

Install Node 22, FFmpeg/FFprobe, Xvfb, Chromium/Playwright 1.64.1 and Sharp. Build both checkouts using `npx vite build`, then use `scripts/visual-regression.mjs fixtures`, `capture`, and `report` as configured in the workflow. The workflow provides the tested setup, including an ephemeral keyring and the database handoff.

## Coverage

The runner exercises navigation and representative dashboard, library, wishlist and settings scenarios. It does not yet exhaustively verify pagination, dense libraries, every dialog or every error state. Approve intentional visual differences during review; do not treat changed pixels alone as a failure.
