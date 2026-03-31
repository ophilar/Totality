# Upstream Contribution Plan: Totality Modernization

This document outlines the strategic roadmap for contributing features and architectural improvements from the modernization fork back to the main Totality project.

## Strategic Approach
To maximize the likelihood of acceptance, the contribution is broken into four distinct, atomic Pull Requests. This allows the maintainer to review and integrate core infrastructure before handling more complex feature sets or breaking tech stack changes.

---

## PR #1: Database Modernization & Repository Pattern (CURRENT)
**Goal:** High-performance architectural foundation.
- **Engine:** Integrate `BetterSQLite3` for direct file access and WAL mode support.
- **Architecture:** Implement the **Repository Pattern** to decouple SQL logic from service logic.
- **Migration:** Provide a robust, verified migration path from `SQL.js` to `BetterSQLite3` to ensure zero data loss for existing users.
- **Compatibility:** Maintain React 18 / TypeScript 5 baseline to minimize integration friction.

## PR #2: Efficiency Metrics & Storage Debt
**Goal:** Introduce the core "Storage Optimization" value proposition.
- **Scoring:** Implement Bitrate-Per-Pixel (BPP) and efficiency scoring logic.
- **Metrics:** Calculate "Storage Debt" (potential space savings) per media item.
- **UI:** Add efficiency badges and space-saving icons to the library and dashboard views.

## PR #3: UX Performance & Virtualization
**Goal:** Support massive media libraries with 60fps performance.
- **Virtualization:** Implement `react-virtuoso` across all major library views (Movies, TV, Music).
- **Optimization:** Refactor the Dashboard from a monolithic component into atomic, lazy-loadable components.
- **Logging:** Integrate the structured `LoggingService` for better field diagnostics.

## PR #4: Tech Stack Modernization
**Goal:** Future-proof the project with the latest stable dependencies.
- **React:** Upgrade to React 19 (including state synchronization fixes).
- **Build Tools:** Upgrade to Vite 8 and TypeScript 6.
- **Styling:** Migrate to Tailwind CSS 4 for improved build speeds and modern CSS features.

---

## Verification Standards for all PRs
Every Pull Request in this sequence must meet the following criteria:
1. **Tests:** 100% pass rate on all existing and new unit tests.
2. **Build:** Clean production build without errors.
3. **Linting:** Zero lint errors; minimal warnings (restricted to unavoidable `any` types in legacy IPC).
4. **Migration:** Verified upgrade path for existing user databases.
