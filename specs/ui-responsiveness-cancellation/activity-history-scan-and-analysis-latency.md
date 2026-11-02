# Activity history, scan outcomes, and analysis latency

## User story

As a library user, I can clear completed task history, distinguish a completed scan from a failed follow-up, and cancel a long analysis without seeing cancellation reported as failure. Exact file-analysis measurements remain unchanged while avoidable I/O and memory use are reduced.

## Functional requirements

1. Activity exposes a Clear history action for all completed task history, reusing the existing queue-history IPC. It does not clear queued or active work.
2. A cancelled analysis stage remains an explicit cancelled/skipped outcome, does not emit failure logging or an error notification for the cancellation itself, and preserves work committed before cancellation.
3. Post-scan analysis enumerates enabled libraries from the local database. Failure to queue that follow-up leaves the scan successful and returns a distinct, visible partial follow-up outcome.
4. Stream-byte and first-video bitrate metrics are calculated from one streaming FFprobe packet pass with named fields. Full audio volume analysis and all persisted metrics remain exact.
5. Hardware settings display verified encoders, not vendor-derived candidates. Unavailable encoder probes remain visible diagnostics.
6. Legacy timeline recipe caches whose ordering cannot be inferred losslessly remain intact and produce an explicit warning; no ordering is guessed.

## Success criteria

- Completed history can be cleared from Activity and remains cleared after queue state reload; pending and active tasks are unaffected.
- Cancelling a real analysis produces a cancelled task without an analysis-stage error log or failure notification.
- A successful scan does not contact a provider again merely to queue post-scan analysis; follow-up enqueue failures are visible separately.
- Real media fixtures produce the same stream byte totals and bitrate metrics before and after the single-pass implementation; packet output is processed incrementally.
- Only verified encoders are labeled available in Settings.
- Same-library profiling records before/after duration, packet-pass count, renderer long tasks, and cancellation completion latency. Unit tests alone do not establish live performance acceptance.

## Verification

- Add focused Activity, task-cancellation, scan-follow-up, FFprobe metric, and verified-encoder coverage using existing project infrastructure.
- Run focused tests during implementation, then `npm test` once and `npm run build` once.
- Keep the same user library and packaged app interactions for live before/after profiling. If unavailable, report live performance acceptance as unverified.
