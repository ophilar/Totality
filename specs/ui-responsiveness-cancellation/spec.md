# UI responsiveness, provider status, playback targets, and cancellation

## User stories

- As a library user, I can type, scroll, switch sources, scan, and analyze without redundant refreshes or stale responses making the interface appear stuck.
- As a user configuring TMDB, I can tell whether a saved or edited credential was actually tested and whether a failure is authentication, connectivity, rate limiting, timeout, or cancellation.
- As a playback profile user, I can inspect and edit a target in a readable, scrollable form, copy a built-in target, preserve partial field input, understand network units, and choose the optimization default.
- As a user starting any long operation, I can cancel it and see whether work stopped or had already committed.
- As a user reviewing provider analysis, I can see per-item missing-resource and provider-outage outcomes without losing successful results or having partial work reported as total failure.

## Functional requirements

1. Library event subscriptions remain active through progress rerenders. Paginated lists have one refresh owner, updates coalesce, loaded depth is retained on background refresh, and superseded responses cannot overwrite current filters or views.
   Source/filter resets serialize against an executing read: discard the obsolete result, then issue one follow-up with the latest source and filters.
2. Library text filtering uses a 250 ms debounce; clearing applies immediately. Count, list, and summary use one source/filter snapshot. Refresh errors preserve current results and offer retry.
   Global search must hide results belonging to a previous query and show a visible, retryable error instead of logging failures only.
3. Long user actions expose progress and cancellation. Reuse TaskQueueService and existing request IDs where present. Direct renderer requests without an owner use a small owner-scoped main-process cancellation registry. Abort signals stay in main; IPC transfers request IDs.
4. Cancellation interrupts transport, retry/rate-limit waits, queued requests, and future batch dispatch. Completed commits remain and are reported; cancellation does not claim rollback. Cancellable exports own temporary output. Non-cancellable commit/external boundaries are identified before starting.
5. TMDB status represents actual testing of the exact draft key, uses the configured base URL and timeout, separates invalid credentials from service failures, supports cancellation and retesting, and never logs or broadcasts credentials. Credential changes require explicit Save or Cancel.
6. Playback target editing is guided by capability groups, scrollable at constrained viewport sizes, and has reachable Save/Cancel. Draft parsers preserve intermediate text and reject invalid tokens at save time. Built-ins are read-only and can be copied through the existing repository API. Advanced definition fields remain editable. Network values display Mbps and persist bits per second without rewriting existing profiles. No synthetic new-profile capability values are supplied. Default profile changes are explicit; stale or missing references are visible.
7. Collection 404s and MusicBrainz 503s retain scoped, item-level outcomes. Successful work is preserved and partial outcomes are not converted to overall failure.

## Interfaces and ownership

- Extend existing renderer-to-main inputs with request IDs only for direct long work that lacks queue/request ownership. Add one owner-scoped cancellation IPC operation and registry lifecycle cleanup.
- Add AbortSignal parameters to existing HTTP, retry, rate-limit, and provider call paths as optional internal parameters; keep current operation ownership and persisted schemas.
- Extend existing TMDB test IPC to accept an unpersisted draft credential and request ID, returning a typed outcome without the key. Add credential settings events containing presence only.
- Expose existing playback profile duplication through validated IPC/preload APIs. Do not add a profile persistence migration.
- Keep the existing profile fields and storage units. Reject invalid drafts through the existing validation boundary and return specific field errors.

## Success criteria

- A library event causes no duplicate paginated-list refresh. Frequent progress events do not unsubscribe listeners or starve the trailing refresh.
- Background refresh preserves loaded depth; rapid filter/source/view changes cannot publish old results.
- Every audited long user action has an owner, visible cancellation control, confirmed cancelled/completed state, and an explicit commit boundary.
- Cancellation aborts HTTP, retry and rate-limit delays, queued requests, and prevents unstarted batch work and stale UI writes.
- Saved TMDB values show untested until an explicit successful test. Credential rejection and provider/network failures have distinct outcomes.
- Playback fields remain reachable at 200% text scale and narrow/short window sizes. Built-in copy preserves its full definition; Mbps conversions round trip; editing retains commas/partial numeric text.
- A collection 404 leaves an item diagnostic and does not erase successful collection results. MusicBrainz 503 exhaustion is an explicit item/provider outcome.

## Verification

- Add focused regression tests for subscription stability, refresh coalescing/depth, latest-result wins, cancellation lifecycle and commit races, HTTP abort/retry cancellation, TMDB outcome mapping, profile draft parsing/copy/units/default selection, and partial provider outcomes.
- Use existing real integration infrastructure and genuine cancellation primitives. Do not add mocks, fake provider responses, or alternate production paths.
- Run focused tests while implementing; run `npm test` once and `npm run build` once at final verification. Avoid repeating type checks included in `npm test`.
- For live acceptance, compare the same library search/scroll/scan/analysis interactions before and after, inspect renderer long tasks and IPC/refresh counts, exercise playback UI at narrow/short layouts and 200% scaling, and test the configured TMDB key. Mark unavailable live-provider acceptance unverified rather than simulating success.
- Report passed, blocked, and unverified checks separately. No live database mutation is part of verification.

## Boundaries and assumptions

- Work stays on the existing non-main feature branch; preserve user changes and persisted settings/profile data.
- Saves and deletes are cancellable before commit only. Imports can stop between existing atomic units and report committed counts; external accepted commands and update installation cannot be recalled and disclose that before submission.
- An executing database read may not be interruptible by the current driver. Cancellation invalidates its generation, prevents further requests, and reports that the current read is finishing.
- No compatibility migration, automatic rematch, silent repair of old profile rates, or new default target is introduced.

## Refinement: Activity owns background operations

### User stories

- As a user, I can close an operation's originating view without losing background work, then inspect its current state or result in Activity.
- As a user, I see one cancellation control in Activity for each cancellable background operation, and the operation name remains visible while it cancels or finishes a commit.
- As a user, I can close AI Insights while a report runs and reopen the same report with its accumulated content and final result.
- As a user, I understand that stopping Sonarr polling does not recall a command Sonarr already accepted.

### Functional requirements

1. TaskQueueService remains the owner for queued scans, analysis, and optimization. Direct background operations use `OperationRequestRegistry` metadata, owner-scoped snapshots, revisioned state events, cancellation, terminal results, and dismissal; no second queue is introduced.
2. Registry results remain in memory for the application session until dismissed. Large results are retrieved only on request and are excluded from activity state events.
3. Renderer listeners subscribe before requesting the initial snapshot. A snapshot with an older or equal revision cannot overwrite an event already applied.
4. Closing an operation view detaches its listeners but does not cancel the operation. Renderer destruction aborts active cancellable requests; a request past its commit boundary settles and reports its actual outcome.
5. Activity includes duplicate scans, AI reports, timeline resolve/import/refresh, update downloads, and Sonarr command waits. It shows one row and one cancellation control per operation; Sonarr says “Stop waiting” and discloses the remote command boundary.
6. Queue pause, queue reorder, and queue clearing apply only to TaskQueueService tasks. Foreground searches, credential tests, imports/exports, and editable drafts keep their existing local cancellation or explicit Save/Cancel contract.
7. AI report state is not reset by closing the panel. Timeline results that finish after a source or view change are retained in Activity and are not applied to the changed context.

### Activity refinement acceptance

- Closing an operation view does not cancel a background request; Activity shows its eventual terminal outcome and can retrieve its result after reopening.
- Activity's initial snapshot cannot overwrite a newer event, cancellation shows “Cancelling…” until confirmed, and commit-bound work shows “Finishing…” without a Cancel control.
- Each background operation has exactly one Activity row and cancellation control. Quiet refreshes and foreground dialog operations do not appear there.
- AI report and resolved timeline results survive originating panel closure; Sonarr reports local wait cancellation while stating its remote command continues.
- Renderer teardown cancels active work and cleans the registry entry after settlement; work already committing is allowed to settle.
# Automatic TMDB validation refinement

User story: saved credentials are checked without requiring a manual Test action.
Requirements: validate the saved TMDB key at service startup and when its saved value changes; cancel superseded validation; publish session-local status without credentials; keep manual draft testing and retry. Do not revalidate on ordinary service initialization or block startup on the network.
Success criteria: one validation per saved credential change, old responses cannot update current status, and Settings displays automatic testing and terminal outcomes.
