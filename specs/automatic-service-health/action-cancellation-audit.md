# User-started operation cancellation audit — 2026-10-03

This audit is intentionally conservative. “Implemented” means the code has an owner and cancellation path; automated tests do not establish live UI acceptance. Any unverified category remains an open delivery item.

| Operation | Owner and UI | Cancellation path | Commit / external boundary | Terminal result and evidence | Status |
|---|---|---|---|---|---|
| Library scans | `TaskQueueService`; Activity and source/library controls | Existing task ID cancellation | Per-item database writes already completed remain; stop before dispatching later work | Queue task terminal state; queue tests | Implemented; live UI unverified |
| Series, collection, music analysis | `TaskQueueService` and service request signal; Activity | Existing task cancellation; abort-aware provider waits | Existing committed diagnostics/results remain | Completed/partial/cancelled task outcome; focused provider/task tests | Partial; audit all nested provider/database paths |
| Optimization and process execution | `TaskQueueService`, `TranscodingService`; Activity | Existing task cancellation and process termination signal | Replacement activation/journal commit is irreversible once entered | Task outcome plus recovery journal; existing transcode/recovery tests | Partial; packaged cancellation unverified |
| Preflight and compatibility checks | Existing optimization/compatibility owners; originating controls | No uniform direct-operation request contract established | Read-only until an approval or submission is committed | Current IPC error/result; no full cancellation regression evidence | Open |
| Match Fix metadata search | `MetadataMatchingService` and metadata providers; local Match Fix dialog | Renderer request ID, owner-scoped registry cancellation, and provider signal propagation; Cancel/close/unmount controls | Read-only; match save remains a separate action | Explicit cancelled outcome, without generic IPC failure logging; focused tests/full suite passed; packaged UI acceptance open | Implemented in code |
| Metadata detail/identity lookup and match save | Existing provider and database IPC owners; item/detail views | Signal/request coverage is still incomplete; match save has a separate write boundary | Match persistence begins only after explicit selection | Remaining provider and save paths need audit | Open |
| Saved credential health and draft tests | `TMDBService` and `SavedServiceHealthService`; Settings | TMDB draft and saved provider retry use request cancellation; saved checks are main-process-owned | No configuration write before explicit Save | Revisioned safe status and timestamps; full suite passed | Implemented in code; live credentials unverified |
| Source authentication, discovery, and connection tests | Provider/`SourceManager`; source setup and source cards | Health checks supersede stale renderer results; interactive auth/discovery does not have a consistent request cancellation API | Source/config writes occur in existing authentication or selection flow | Health result is inline; auth/discovery terminal behavior lacks coverage | Open |
| Sonarr/Radarr commands | `ArrIntegrationService`; Arr actions and Activity wait row | Sonarr command wait cancellation aborts polling/request; search operation is not recalled remotely | Remote command acceptance is irreversible; “Stop waiting” leaves it running | Cancelled wait says the command continues; real local HTTP regression | Partial; Radarr wait/action audit open |
| AI chat and reports | `GeminiService` / `GeminiAnalysisService`; chat/report UI and Activity | Request IDs and operation registry cancellation | Provider generation may finish remotely; local report persistence remains owner-controlled | Cancelled/failed reports retain accumulated text; focused Activity tests | Implemented in code; live closure/reopen unverified |
| Timeline resolve/import/refresh | Timeline IPC and operation registry; timeline view and Activity | Request ID cancellation through supported fetches and between matching batches | Snapshot persistence is the commit boundary | Cancelled or completed result retained; real-database cancellation regression | Implemented in code; live UI unverified |
| Duplicate analysis | `DeduplicationService`; duplicates view and Activity | Request ID and abort signal | Repository persistence is the commit boundary | Cancelled/failed/completed result retained; focused registry and duplicate tests | Implemented in code; live UI unverified |
| Database import/export | Database IPC and operation registry; data-management dialogs and Activity | Request ID; import checks abort before transaction commit, export owns/removes its temporary output | Import transaction commit; export final-file publication | Transactional outcome/committed counts; real database tests | Implemented in code; live UI unverified |
| Update check/download/install | `AutoUpdateService`; update settings and Activity download row | Download uses installed updater cancellation token; automatic/manual checks coalesce but are not cancellable | Download can stop; installation becomes non-cancellable after shutdown starts | Inline status and download terminal state; unit tests | Download implemented; check cancellation and packaged UI open |
| Settings/profile edits | Renderer drafts and existing settings/profile IPC | Discard/Cancel before Save; no cancellation once the atomic write starts | Existing individual setting/profile save boundary | Save errors retain drafts; profile schema and flow tests | Partial; multi-setting atomicity and save race open |
| Filesystem imports, exports, and media actions | Feature-specific IPC/service owners | No complete action inventory or common signal coverage | Per-file/per-record commit boundary varies | Incomplete evidence | Open |

## Remaining acceptance

- Implement or explicitly close every open row with a real owner, request identity, cancellation propagation, and terminal outcome.
- Verify cancellation on both sides of each commit boundary using the real database/filesystem/provider infrastructure.
- Exercise every operation’s single visible cancellation control, “Cancelling…” confirmation, and result retention in the packaged UI.
- Do not count a request as cancelled while its owner is still finishing a non-interruptible read or commit.

## 2026-10-04 saved-provider health audit update

| Operation | Owner and UI | Cancellation path | Commit / external boundary | Terminal result and evidence | Status |
|---|---|---|---|---|---|
| Automatic saved-provider health (OMDb, TVDB, MusicBrainz, Sonarr, Radarr) | `SavedServiceHealthService` invokes the existing provider/connection owners; Settings displays revisioned session status | Configuration changes supersede active checks; a user-started retry exposes Cancel and waits for its provider owner to settle | Read-only requests; credentials are read from saved configuration and never returned in health events | Safe status category, timestamp, and message; Settings regression and full suite passed | Implemented in code; live credentials/provider acceptance unverified |

Automatic checks are quiet and do not create Activity entries. Closing Settings detaches its listener; the main-process health check continues for the saved configuration. Provider outage/credential acceptance requires live application configuration and remains unverified by the automated suite.

## 2026-10-04 metadata search cancellation audit update

| Operation | Owner and UI | Cancellation path | Commit / external boundary | Terminal result and evidence | Status |
|---|---|---|---|---|---|
| User-initiated metadata search in Match Fix | `MetadataMatchingService` → `CompositeMetadataProvider` → existing metadata providers; local Match Fix dialog | Renderer request ID is registered in main; Cancel search, dialog close, Escape, outside click, and unmount use the existing owner-scoped cancellation endpoint. Signal reaches supported network calls and MusicBrainz retry/rate-limit waits. | Search is read-only. A response completing after cancel is discarded by the dialog. | Focused metadata/MusicBrainz tests and full suite passed; installer built. | Implemented in code; packaged live cancellation remains unverified |

Metadata match persistence is a separate user-confirmed action and is not cancelled after its save begins. Source authentication/discovery, compatibility/preflight, Plex publication, and other open rows remain outstanding.

## 2026-10-04 Plex playlist sync cancellation audit update

| Operation | Owner and UI | Cancellation path | Commit / external boundary | Terminal result and evidence | Status |
|---|---|---|---|---|---|
| Plex playlist sync | `PlexPlaylistSyncService`; timeline panel links to Activity | Activity request ID; AbortSignal reaches listing, create, append, and sequence verification; cleanup removes a staged playlist before publication | Publishing the verified staging playlist title and deleting the selected old playlist form the non-cancellable commit sequence | Completed/cancelled/partial/failed state retained in Activity; cancellation exercised through the local HTTP integration server; full suite and packaged build passed | Implemented in code; packaged Plex/Activity live acceptance unverified |

Cancellation cleanup failure is explicitly partial, with the publication recovery record retained for the next sync. Source authentication/discovery, preflight/compatibility, and other long-running actions remain open audit rows.

## 2026-10-04 local Jellyfin/Emby discovery audit update

| Operation | Owner and UI | Cancellation path | Commit / external boundary | Terminal result and evidence | Status |
|---|---|---|---|---|---|
| Automatic local Jellyfin/Emby UDP discovery | `UdpDiscoveryService`; Jellyfin/Emby setup dialog | Request ID uses the existing owner-scoped registry; dialog close/unmount cancels and closes the active socket/timer. No Activity item or new control. | Read-only network broadcast; discovered results are discarded after detach | Real-socket cancellation regression, existing discovery tests, setup-dialog tests, TypeScript, and packaged build passed. Full test run had an unrelated intermittent `AutoUpdateService.test.ts` worker crash. | Implemented in code; packaged dialog-close acceptance unverified |

This closes only automatic UDP discovery. Authentication, manual URL testing, Plex discovery/authentication, and persisted source creation remain open.

## 2026-10-04 cancellation-surface correction

The preceding discovery row records an implementation detail, not a product requirement. Local Jellyfin/Emby discovery is a short, read-only UDP lookup and does not need request-ID cancellation plumbing or a user-facing control. Keep its existing bounded discovery behavior and discard a late result after the setup view detaches; do not add Activity entries.

Automatic timeline loads and saved-service health checks are quiet maintenance work. They must not create Activity rows or expose Cancel. Timeline source changes may supersede an earlier read internally. Service health remains inline, shows Checking while active, and offers Retry after a failure or on explicit user request.

Activity cancellation is reserved for substantial, explicitly initiated background jobs with clear work to stop. Dialog-local searches/tests use their existing dialog controls. Accepted remote commands and writes past their commit boundary report the actual outcome; they do not promise cancellation. Plex playlist cleanup must retain its recovery record and report a partial/unresolved result when the remote server may still be processing playlist creation.

The discovery request-ID/IPC cancellation path and saved-service-health cancel endpoint were removed. Automatic timeline resolution now remains absent from Activity while explicit refresh/import stays visible. Source navigation behavior remains the existing behavior: automatic discovery selects a sole server but does not advance to server selection merely because multiple servers respond.
