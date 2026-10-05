# UI interaction ownership and correctness

## User stories

- As a user resolving duplicate media, I can tell whether files will be deleted and whether each requested deletion actually completed.
- As a user searching all media, I see results only for my current query and can distinguish no matches from a failed search.
- As a keyboard user, I can open media, use menus and dialogs, navigate destinations, and mark notifications read without a pointer.
- As a user running background work, I find one cancellation control in Activity and retain its truthful final outcome.
- As a user at a small window size or high zoom, I can reach the active content and all controls.

## Functional requirements

1. Duplicate resolution validates group membership and retention policy before deletion. It returns a typed outcome with committed counts and item errors, performs asynchronous filesystem deletion, marks a group resolved only when its requested action completes, and leaves partial groups pending.
2. The registered `mediaSearch` IPC route is the sole global-search request path. Settled queries alone update visible results; search exposes waiting, searching, empty, and error states and implements the combobox keyboard/ARIA contract.
3. Clickable media rows/cards and dashboard rows have semantic keyboard-operable primary actions. Secondary menu actions remain separate. Main destinations are navigation; actual tab controls retain their tab semantics.
4. Modal overlays have an accessible name, contained and restored focus, background isolation, and operation-appropriate Escape/close behavior using the existing focus hook.
5. Activity renders persisted notifications as the sole analysis-notification source. Queued-work cancellation and queue management live in Activity; originating views link there. Notification loading errors are visible and retryable; history clearing and notification clearing are explicitly named.
6. Empty dashboard wording does not claim health without evidence. Toasts announce status and keep actionable errors until dismissed. Useful text is selectable and renderer motion honors reduced-motion preferences.
7. At supported narrow widths/high zoom, side panels behave as deliberate drawers and dense list/timeline layouts keep content reachable. Playback profile save reuses one profile-list result and dirty-state updates occur only when the value changes.

## Success criteria

- Policy-blocked, fully deleted, keep-canonical, partial-delete, and failed duplicate resolutions each produce an accurate state and message; a partial group remains reviewable.
- An older search response never replaces a newer query. Failed searches cannot be presented as no-match results.
- All identified primary row/card actions work with Enter/Space; dialogs contain focus and return it to the opener; notifications are keyboard operable.
- Each queued operation has one cancellation control in Activity. Each generic analysis job creates one persisted notification, without nested duplicate notifications.
- At 1000×600 and 200% text scaling, no active control is clipped or obscured. Reduced motion disables nonessential movement.
- Focused integration tests use the real test database/filesystem and existing Electron IPC infrastructure. Full tests and one packaged build pass. Live renderer performance comparison is reported separately and is not inferred from unit tests.

## Boundaries

- Preserve existing retention policy, search result behavior, task queue ownership, and persisted settings/profiles. No schema migration, compatibility path, new queue, or dependency upgrade.
- Cancellation is available before duplicate deletion commit begins. Once filesystem deletion starts, show the committed/remaining outcome without promising rollback.
- Implement on a non-main branch and preserve the existing Activity worktree edits.
