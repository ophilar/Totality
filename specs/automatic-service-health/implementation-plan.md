# Automatic service health, quieter background work, and remaining UI fixes

## 1. Goal, decisions, and delivery boundaries

Reduce repeated user interaction by automatically checking saved service configuration, source availability, playback settings, tool capabilities, and update availability. Complete the outstanding responsiveness, Activity, cancellation, provider-outcome, and live acceptance work.

**Agreed behavior**

- Run health checks at startup, after saved configuration changes, after reconnection or system resume, and when a real request reveals a service failure.
- Do not add periodic health polling. Preserve existing library monitoring and update-check schedules.
- Validate credentials automatically after **Save**. Unsaved drafts retain explicit Test, Save, and Cancel.
- Show automatic failures inline in existing service/source cards and status indicators. Do not create automatic popups or health-check Activity entries.
- Keep scans, analysis, AI reports, imports, exports, transcoding, repairs, remote commands, update downloads, and installation explicit.
- Preserve all saved credentials, profiles, source identities, and settings. Do not select replacements, migrate data, or silently correct stored values.

**Implementation boundaries**

- Continue on the current non-main branch and preserve unrelated edits.
- Record this specification before implementation. Append work, design, and roadmap entries.
- Reuse existing services, providers, repositories, IPC handlers, task queue, and operation registry.
- Add small, separately reviewable changes in this order: shared health contract; credentials; sources; playback validation; capabilities; refresh/results; updates; cancellation audit; live acceptance.
- Use installed library APIs verified against official documentation. Do not introduce unrelated dependency upgrades.
- Current test/build success does not close live acceptance. Maintain separate passed, blocked, and unverified records.

## 2. Automatic checks and shared status

### Session-local health contract

Extend the existing TMDB validation pattern into a small shared status contract used by current operation owners. This is a value/type and notification contract, not another scheduler, task queue, or service registry.

Each status contains:

- Subject identity: service ID or source ID.
- State: `not-configured`, `not-tested`, `checking`, `ready`, `invalid-credential`, `permission-denied`, `unavailable`, `rate-limited`, `timed-out`, or `cancelled`.
- Readable diagnostic, check time, and revision.
- Optional retry time only when supplied by the provider.
- Internal configuration generation, excluded from renderer events.

Each existing service owns its current status, controller, and configuration generation. `SourceManager` owns source health.

**Rules**

- Credential presence never implies validity.
- `ready` means the particular authenticated/read operation succeeded; it does not promise every feature or future request will succeed.
- An authentication rejection marks credentials invalid. Permission, quota, rate-limit, timeout, connectivity, server, and malformed-response failures remain distinct.
- Item-level 404/not-found results do not mark an entire service unavailable.
- Credential values, tokens, PINs, and authenticated URLs never appear in events, diagnostics, or logs.
- Validation is session-local. Persist configuration, not validity claims.
- A configuration change aborts the previous check and invalidates its generation before scheduling the new one.
- Old responses cannot update status even if the underlying request finishes after cancellation.
- Automatic checks do not block window creation, initial library display, or ordinary database reads.
- Use existing per-provider concurrency and rate-limit owners. Do not attach independently cancellable requests to another operation’s in-flight promise.
- During an identical automatic check, repeated lifecycle triggers request one pending recheck rather than launching overlapping work.
- Disabling/removing a service or source cancels its check and removes it from automatic scheduling.

### IPC and renderer integration

Add the minimum shared health interfaces:

- Get the current health snapshot.
- Subscribe to revisioned health updates.
- Retry a saved service/source check through its existing owner.
- Extend existing draft-test requests with request IDs and cancellation where missing.

Subscribe before requesting the initial snapshot. Apply revisions so an older snapshot cannot overwrite a newer event.

Use shared serializable types for main, preload, and renderer. Keep `AbortSignal` and credentials in main. Foreground draft tests use the existing direct-request cancellation registry; automatic checks use service-owned controllers.

Settings, source cards, library indicators, and capability-dependent controls consume the same owner state. Remove local validity claims and independent copies of health logic.

A collapsed card must show its actual state, including **Checking**, **Invalid credential**, or **Unavailable · credential status unknown**. Expanded cards show the diagnostic and last check time. Retain Retry/Test for recovery.

### Credential and provider checks

| Service | Automatic check and implementation |
|---|---|
| TMDB | Reuse the implemented `/configuration` check. Complete shared-status integration, timeout/cancellation reporting, and library indicators. Ordinary `initialize()` calls must not schedule checks. [TMDB documentation](https://developer.themoviedb.org/reference/configuration-details). |
| Gemini | Replace content generation during credential testing with the existing model-list request. Reuse its configured endpoint and the installed SDK/request facilities. Report credential access and selected-model availability separately; do not switch models automatically. Listing models does not prove generation quota or successful inference. [Gemini documentation](https://ai.google.dev/api/models). |
| Sonarr/Radarr | Reuse authenticated `/api/v3/system/status`. Add optional cancellation to `testConnection()` and preserve structured HTTP failure information. Check each saved service independently. Do not issue search commands during validation. |
| OMDb | Move renderer-side fetches into `OMDbMetadataProvider`. Reuse its request construction and response classification. Use the existing minimal title lookup as the check input; authentication rejection, no matching item, and quota exhaustion must remain distinguishable. Do not save returned metadata. |
| TVDB | Move the renderer login check into `TVDBMetadataProvider`, using its existing key/PIN authentication. Invalidate its cached token when either saved value changes. Reuse a successfully obtained token for the exact saved configuration; draft-test tokens remain isolated. Distinguish rejected credentials from subscription/permission failures. [TVDB documentation](https://support.thetvdb.com/kb/faq.php?id=78). |
| MusicBrainz | Check service reachability through the existing MusicBrainz service and rate limiter. Replace the renderer’s artist-name probe with a minimal documented browse request. This is availability testing, not key validation. Preserve the application User-Agent and existing bounded retry policy. [MusicBrainz documentation](https://musicbrainz.org/doc/MusicBrainz_API). |
| Plex and other media sources | Check through provider-owned authenticated requests as described below. Do not maintain a separate Plex credential verdict disconnected from its source configuration. |
| AniList/TVmaze | Keep existing real request outcomes visible. Because these providers require no user configuration, do not add unconditional startup requests solely to display a healthy badge. |

For settings containing multiple related values, publish configuration changes only after the existing Save operation has committed the complete configuration. Do not test partially saved Sonarr URLs/keys or TVDB keys/PINs.

Remove the current setting-change side effects that silently launch post-scan analysis or Gemini completeness generation. Saving credentials should save and validate configuration; it must not implicitly start unrelated analysis or paid generation.

### Automatic source availability

Extend existing provider connection methods with an explicit lightweight health-check mode and optional signal. Keep current names and preserve explicit connection-test behavior.

- `SourceManager` schedules checks for enabled configured sources after initialization, connection configuration changes, enablement, explicit reconnection, and system resume.
- Reuse existing provider HTTP/database clients, timeouts, and credential ownership.
- Automatic checks never discover/select replacement servers, refresh library contents, authenticate with saved passwords, or rewrite connection configuration.
- Sources lacking an authenticated session report **Authentication required** with the existing connection action.
- Plex uses an authenticated server resource request. A successful identity endpoint alone must not be presented as proof that the token grants library access.
- Jellyfin/Emby/Kodi use their current read-only connection/authentication endpoints.
- Local folders use asynchronous directory access/read checks. Do not recursively count files: the current local connection test traverses the tree and is unsuitable for startup health.
- Kodi-local, Kodi-MySQL, and MediaMonkey use existing connection facilities with a minimal read. Close temporary handles on success, failure, and cancellation.
- Keep connection timestamps and token persistence within explicit connection flows. Health checks remain session-local.
- Offline sources retain cached library data with a visible source-status message.
- Existing monitoring responses update source health, avoiding duplicate network probes. Monitoring keeps its existing enabled setting and intervals.
- Resume/reconnection triggers coalesce within the existing source lifecycle. Renderer navigation and opening Settings do not independently retrigger checks.

## 3. Playback, capability detection, refresh, Activity, and updates

### Playback profiles and target selection

Make validation automatic while retaining explicit persistence.

- Extract the existing IPC profile schema into a shared authoritative module. Main-process create/update handlers and renderer validation use the same schema.
- Preserve raw draft strings while typing. Parse through one draft-to-definition conversion; run schema validation against the resulting candidate without changing the draft.
- Show field-level errors after a field is left and a complete error summary on Save. Do not interrupt partial numeric input or comma entry.
- Save converts Mbps to persisted bits per second once. Opening/editing preserves stored values, including existing 100 Mbps and 0.1 Mbps definitions.
- Empty HDR/subtitle lists remain permitted where the schema permits them. Empty required lists and invalid numeric tokens remain visible errors.
- New drafts contain no invented capabilities. Boolean choices and audio output path begin unresolved until the user chooses them, or the user explicitly copies a profile.
- Built-in profiles remain read-only. “Create editable copy” uses repository duplication and preserves Plex identity and container rules.
- Use the existing guided cards for video, HDR, audio, subtitles, network, and advanced settings.
- Provide one scrollable content region and a reachable Save/Cancel footer.
- Replace browser confirmation with **Save / Discard / Keep editing** when switching profiles or closing with changes.
- Save failure retains the draft and selection. Cancel restores the selected saved profile.
- Validate the default target at startup and after profile/default-setting changes. Report missing, stale, or invalid targets with an explicit selector.
- Main-process optimization entry points enforce the same target validity. Do not automatically select another profile.
- Keep main-process default-profile deletion enforcement.

### Tool and encoder capabilities

Reuse `TranscodingService.getCapabilities()` and existing analyzer/GPU detection.

- Detect availability and capabilities once per application session after initial UI readiness.
- Reuse the existing capability promise for consumers.
- Invalidate only after configured executable changes, tool installation/update, explicit Refresh, or system resume.
- Thread cancellation through executable probes and GPU/process detection.
- Detection must not persist a GPU choice. Remove the current setting write when no selection exists.
- Preserve an explicitly saved GPU choice. If unavailable, report the condition and present the selector.
- Report missing tools and encoder probe failures accurately. Failed refreshes retain the previous snapshot as visibly stale, rather than claiming it is current.
- Update capability-dependent controls automatically from the snapshot.
- Optimization controls remain accessible for eligible local files; preflight determines whether execution is possible.
- Reuse existing encoder verification outputs and temporary-file cleanup. Do not perform library scans or production transcoding during detection.

### Library responsiveness and automatic refresh

Complete the existing refresh implementation rather than adding another owner.

- `usePaginatedData` remains the only owner of paginated list invalidation.
- Browser listeners own statistics, completeness, selected details, and task state.
- Stabilize subscriptions using `useEffectEvent` for event-time callback reads while retaining actual subscription dependencies. [React guidance](https://react.dev/reference/react/useEffectEvent).
- Progress updates must not resubscribe, cancel debounce timers, or reload library data.
- Coalesce mixed task completions into one invalidation per affected dataset.
- Allow one active refresh and one pending follow-up invalidation.
- Preserve loaded page depth, visible data, selection, and scrolling during background refresh.
- Expose initial loading and background refreshing separately.
- Use the existing 250 ms search debounce for lists and summaries; clearing applies immediately.
- Capture one source/filter snapshot for count, list, summary, and associated detail reads.
- Apply generation checks to summaries, completeness, global search, episodes, and albums.
- Source/filter/view changes invalidate previous work and stop subsequent page requests.
- Where a database statement cannot be interrupted, discard its result and accurately indicate that cancellation is finishing the current read.
- Genuine errors retain previous data with visible Retry. Do not clear the library or silently show data for the wrong context.
- Automatic refreshes and superseded reads stay outside Activity.

### Activity and restored results

Complete the implemented refinement and verify its remaining edge cases.

- Keep queue-owned work in `TaskQueueService`; direct background work remains in `OperationRequestRegistry`.
- Retain duplicate scans, AI reports, explicit timeline operations, update downloads, and Sonarr waiting until dismissed.
- Use one Activity row and one cancellation control per operation.
- Closing an originating view detaches listeners without cancelling background work.
- Reopening retrieves the operation’s captured inputs, current state, and available result.
- AI reopening restores report type, accumulated content, and terminal outcome.
- Preserve accumulated AI content when a report fails or is cancelled. The current terminal-result assignment must not overwrite retained partial text with an absent result.
- Timeline results retain their captured source/filter context. Apply them only when the current view matches; otherwise offer View result.
- Cancellation preserves the operation name and shows **Cancelling…** until confirmed. Commit shows **Finishing…** with no misleading Cancel.
- Queue pause/reorder/clear controls affect only queued work.
- Sonarr uses **Stop waiting** and explains that its accepted command continues remotely.
- Renderer destruction aborts cancellable work; an entered commit boundary settles before cleanup.
- Retention remains application-session scoped. Do not add cross-session report persistence or restoration.

### Update availability

Refine `AutoUpdateService`; retain its existing automatic startup and four-hour check schedule.

- Honor the existing saved automatic-check setting without creating another scheduler or preference.
- Coalesce simultaneous automatic and manual checks.
- Ensure both startup timer and interval are cleared during cleanup.
- Show availability through the existing update indicator and Settings state.
- Remove repeated automatic update notifications; show automatic failures inline.
- Correct “will install on restart” text because automatic installation is currently disabled.
- Keep download explicit and cancellable in Activity.
- Keep installation explicit and show its shutdown boundary before activation.
- Do not silently download/install or change the saved update policy.
- Use installed `electron-updater` cancellation/events, not APIs from a newer major version. [Version 26 update documentation](https://www.electron.build/v26/docs/features/auto-update/).

## 4. Cancellation and provider-outcome completion

Create an action audit covering every user-started operation. Record its owner, UI location, cancellation API, commit boundary, terminal outcome, and verification evidence.

**Required categories**

- Scans, collection/series/music analysis, optimization, preflight, compatibility checks, and process execution.
- Metadata searches and draft credential tests.
- Source authentication, discovery, connection tests, and remote commands.
- AI chat, reports, and associated requests.
- Timeline resolve/import/refresh.
- Duplicate analysis.
- Database imports/exports.
- Update checks, downloads, and installation.
- Settings/profile drafts and atomic saves/deletes.

**Cancellation requirements**

- Thread existing task/request signals through provider methods, HTTP clients, retry waits, rate-limit waits, concurrency queues, filesystem batches, and spawned processes.
- Remove cancelled queued requests and stop dispatching subsequent batch items.
- Cancellation is never retried or reported as an ordinary failure.
- Foreground searches/tests/imports/exports remain local and cancel on dialog closure before commit.
- Automatic checks supersede quietly and need no Activity row or extra Cancel button.
- Saves/deletes have a cancellable draft or confirmation stage. Once atomic commit starts, report the actual result.
- Imports stop before commit or between existing atomic units and report committed counts.
- Exports remove only the current operation’s temporary output.
- Already accepted remote commands continue remotely. Stop waiting cancels polling only.
- Preserve verified committed results and report partial work accurately.

**Provider outcomes**

- Keep missing TMDB collections as item-level diagnostics containing their stored identity.
- Preserve successful collection results and stored data; no title rematching or deletion.
- Partial batches remain partial rather than being converted into an overall failure.
- MusicBrainz 503 retries remain bounded, rate-limited, interruptible, and visible in task details.
- Exhausted retries produce explicit failed/deferred items.
- Remove provider paths that turn HTTP/network failures into indistinguishable empty results where the caller needs to distinguish absence from failure.
- Extend existing outcomes only where necessary; do not introduce substitute metadata or compatibility paths.

## 5. Verification, acceptance, and completion criteria

### Focused checks

Use existing real integration infrastructure, temporary databases/files, and actual cancellation primitives. Do not add mock providers, fabricated responses, or alternate production paths.

Verify:

- Startup and saved-change checks occur once; ordinary initialization and navigation do not duplicate them.
- Subscribe-before-snapshot races preserve the latest revision.
- Removing/replacing configuration cancels previous work and rejects stale responses.
- Health checks do not change saved configuration, launch analysis, or generate AI content.
- Local source health does not recursively enumerate the library.
- Related credentials are checked only after a complete Save.
- Draft Test remains cancellable and cannot overwrite the saved configuration’s status.
- TVDB token invalidation follows both key and PIN changes.
- Profile validation uses one schema; typing, copies, Mbps, advanced fields, and unsaved-change decisions preserve data.
- Capability detection does not select or persist a GPU.
- Refresh coalescing, loaded depth, stale-response rejection, and visible errors hold.
- Activity retains partial AI/timeline results and survives originating-view closure.
- Cancellation works before dispatch, during requests/waits/processes, between items, and on both sides of commit.
- Queue controls cannot affect direct operations.
- Update checks coalesce and cleanup removes scheduled callbacks.

Provider-specific error scenarios that cannot be reproduced against actual available services are **blocked**, not simulated as passed.

### Live acceptance

- Use the actual library for read-only inspection and real renderer measurements.
- Capture a baseline from the current runnable build before further fixes; repeat identical search, scrolling, source switching, refresh, and Activity interactions afterward.
- Record renderer long tasks, interaction timings, IPC counts, and dataset refresh counts. Report measured changes without invented thresholds.
- Require elimination of duplicate reloads and refresh starvation. Tests alone cannot establish that freezing is fixed.
- Verify automatic startup and saved-key validation through the packaged UI with redacted logs.
- Compare stored settings/source configuration before and after automatic checks to establish that checks have no unintended writes.
- Exercise playback editing at narrow widths, short heights, and 200% text scaling. Every field and Save/Cancel must remain reachable.
- Exercise background closure/reopening, partial results, cancellation confirmation, and result dismissal.
- Verify every action category in the cancellation audit. Destructive media operations use disposable real files/databases through normal application paths.
- Existing unavailable credentials, servers, providers, update releases, or inaccessible desktop controls are recorded as blockers with the exact remaining acceptance step.

### Delivery

Run focused checks during each contained change. After the final implementation, run the full test command once and one packaged build; do not repeat type checks already included.

Append final passed, skipped, blocked, and unverified outcomes to project logs and roadmap. Keep the work incomplete until the provider/Plex cancellation audit, live freeze verification, playback layout, automatic credential checks, and Activity acceptance are resolved.
