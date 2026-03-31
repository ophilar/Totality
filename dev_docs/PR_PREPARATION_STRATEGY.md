# PR Preparation Strategy: Totality Modernization Fork

## Phase 1: The "Architectural Foundation" PR
- **Goal:** Replace monolithic `DatabaseService` with Repository Pattern & `better-sqlite3`.
- **Why:** Low-risk, high-impact infrastructure improvement. Provides a clean baseline for feature-rich PRs.
- **Constraints:** Keep React 18/TS 5 in this PR to avoid dependency rejection.

## Phase 2: The "Efficiency & Debt" PR
- **Goal:** Introduce Bitrate-Per-Pixel (BPP) scoring, "Storage Debt" calculation, and UI Badge components.
- **Why:** Delivers the primary value of the fork (helping users save space).
- **Dependencies:** Requires Phase 1 (Repository Pattern).

## Phase 3: The "UX & Performance" PR
- **Goal:** Backport `react-virtuoso` virtualization and `LoggingService`.
- **Why:** Massive performance wins for large libraries (Music/Movies). Pure performance optimization.

## Phase 4: The "Modernization" PR
- **Goal:** Upgrade to React 19, Vite 8, Tailwind CSS 4, and Electron 41.
- **Why:** Long-term project health. Most controversial; kept separate to avoid blocking feature PRs.

## Current "Polishing" Requirements (Pre-PR Checklist)
- [ ] **Monolith Refactoring:** Split `Dashboard.tsx` (76KB) into sub-components.
- [ ] **Lint Resolution:** Replace `any` types with proper interfaces/types.
- [ ] **TS Expectation:** Swap `@ts-ignore` for `@ts-expect-error` with architectural justifications.
- [ ] **Migration Verification:** Test the upgrade path from Upstream v0.3.1 to Fork v0.4.0.
