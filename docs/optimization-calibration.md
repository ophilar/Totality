# Calibration: optimization profile and runtime acceptance

The active learned profile is `optimization-profile.json` under the Electron user-data directory. Packaged quality gates, quality domains and sampling configuration remain authoritative in `src/main/config/defaults.json`. The learned profile is a versioned JSON snapshot of scoped candidate priors; database settings are used for task diagnostics, not active calibration. Old database calibration is not consumed.

Each prior records source/library/type, actual codec/HDR/bit depth, playback policy and full target profile, encoder capability fingerprint, measurement/search versions and fingerprint, sampling windows, quality policy, container and video transformation in its scope key. An exact match can seed bounded candidate search. Final choice must pass current-file measured quality, playback and positive savings checks. Calibration measures using production sample windows and the configured calibration candidate budget; holdouts are distinct titles sampled across technical strata. An eligible prior requires at least one matching passing holdout from a distinct title and no observed matching failing holdout. Completed measurement evidence is retained even when the overall representative preflight fails, so rejected holdouts cannot be discarded.

Starting recalibration publishes an empty profile before inventory. The complete validated result is published by flushed same-directory temporary-file rename after checkpoint cleanup. An interrupted task remeasures from scratch rather than activating unverifiable checkpoint evidence. An empty/failed run leaves no active priors. Existing source files are not modified by calibration.

## Acceptance
- Confirm deterministic representative selection on reversed inventory; verify different libraries, HDR, playback definitions, GPU snapshots, metric versions and sample settings cannot share evidence.
- On real library and GPU, record baseline first probes, calibrate, verify changed initial probes for a matching scope and unchanged final safety gates. Verify exact scope mismatch retains ordinary search.
- Check empty inventory, failed probes, cancellation and process interruption before and after profile publication; inspect JSON and restart the task.
- Verify real playback target, GPU encoding and output quality on representative files. Record device, library, candidate outcomes and timings.
- Status: implementation and regression tests authored; real-library/GPU execution, interruption recovery and test execution remain pending.
