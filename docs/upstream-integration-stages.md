# Upstream integration stages (development-only)

Upstream `bbidwell85/Totality` is the sole authority for release tags, installers, and update feeds. Branches in `ophilar/Totality` are review snapshots, not releases. Upstream maintainers choose versions.

## Ordered review boundaries

1. `upstream/01-toolchain-modernization`: Vite, Vitest, TypeScript, CSS tools, ESLint→Oxlint, ESM configs, required lint fixes. Keep runtime media features unchanged.
2. Native dependencies: Electron, better-sqlite3, electron-updater, platform packaging; verify real database migrations and installers.
3. Renderer dependencies: React, react-window, Lucide and relevant source adaptations; verify UI and all platforms.
4. Data integrity/architecture: identity migrations, database contracts, IPC hardening and safe path authorization.
5. Compatibility decisions: direct-play versus server-transcoding, capability probes and playback targets.
6. Optimization planning: evidence-backed candidate discovery, language policies, savings, measured quality samples. Read-only first.
7. Execution: FFmpeg transcoding/remux, queue recovery, verification before replacement and explicit destructive-operation boundaries.
8. Duplicates: detection, retention policies, approval workflow and robust safety tests.
9. UI/integration: provider wiring, optimization controls and real Electron/Playwright visual regression.

## Acceptance criteria

Each layer must be reviewable without downstream source and pass `npm ci`, unit tests, TypeScript typechecking, renderer build and lint. Native and execution stages additionally require cross-platform packaging and real-media/database migration tests. Distinct failures must be corrected at the earliest affected layer, then propagated through the stack.

The original `timelines`, `optimization`, `0.7`, and `0.9` branches remain unchanged as reference snapshots. Do not cherry-pick the monolithic 0.6 feature commit as a substitute for extracting independent source changes.
