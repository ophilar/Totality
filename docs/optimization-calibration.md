# Calibration: optimization profile and runtime acceptance

> Current contract: see **Pareto calibration revision** and its implementation checkpoint below. Earlier sections are dated implementation history; balanced-only and two-probe calibration have been superseded.

The active learned profile is `optimization-profile.json` under the Electron user-data directory. Packaged quality gates, quality domains and sampling configuration remain authoritative in `src/main/config/defaults.json`. The learned profile is a versioned JSON snapshot of scoped candidate priors; database settings are used for task diagnostics, not active calibration. Old database calibration is not consumed.

Each prior records source/library/type, actual codec/HDR/bit depth, playback policy and full target profile, encoder capability fingerprint, measurement/search versions and fingerprint, sampling windows, quality policy, container and video transformation in its scope key. An exact match can seed bounded candidate search. Final choice must pass current-file measured quality, playback and positive savings checks. Calibration measures using production sample windows and the configured calibration candidate budget; holdouts are distinct titles sampled across technical strata. An eligible prior requires at least one matching passing holdout from a distinct title and no observed matching failing holdout. Completed measurement evidence is retained even when the overall representative preflight fails, so rejected holdouts cannot be discarded.

Starting recalibration publishes an empty profile before inventory. The complete validated result is published by flushed same-directory temporary-file rename after checkpoint cleanup. An interrupted task remeasures from scratch rather than activating unverifiable checkpoint evidence. An empty/failed run leaves no active priors. Existing source files are not modified by calibration.

## Acceptance
- Confirm deterministic representative selection on reversed inventory; verify different libraries, HDR, playback definitions, GPU snapshots, metric versions and sample settings cannot share evidence.
- On real library and GPU, record baseline first probes, calibrate, verify changed initial probes for a matching scope and unchanged final safety gates. Verify exact scope mismatch retains ordinary search.
- Check empty inventory, failed probes, cancellation and process interruption before and after profile publication; inspect JSON and restart the task.
- Verify real playback target, GPU encoding and output quality on representative files. Record device, library, candidate outcomes and timings.
- Status: implementation and regression tests authored; real-library/GPU execution, interruption recovery and test execution remain pending.


## Living implementation and acceptance plan — 2026-11-28

Objective: address all six user-reported calibration gaps on `0.9.0`, preserving measured quality and playback safety. Baseline: `62fd2830d073dfb3dd9a19f3e19df09214a571f0`. Scope: measured optimization policy, calibration queue, transcoding integration, configuration, profile persistence and tests. Release, unrelated maintenance and changes to media files are outside this task.

| Work unit | Dependencies | Acceptance | Evidence / state |
| --- | --- | --- | --- |
| C1: representative selection and activation invalidation | Baseline inspection | Reversed inventory produces identical distinct-title selection; old priors inactive before inventory, including empty/failed runs | [f477491](https://github.com/ophilar/Totality/commit/f4774913776e7bd4efb3cba6d3d83821432d5c11), source-reconciled |
| C2: scoped search prior and JSON ownership | C1 | Exact context matches change first probe under bounded search; mismatches use ordinary search; current-file gates remain decisive; changes invalidate search cache identity | [cbcd823](https://github.com/ophilar/Totality/commit/cbcd82395234a8ccc6d846a168c8e5f7cf7d26b2), source-reconciled |
| C3: holdout veto and profile publication | C2 | Independent passing holdout required; matching observed failure vetoes; staged files never become active | [5ca0e84](https://github.com/ophilar/Totality/commit/5ca0e8436b8f40a41662d83ce3db0d12f452ff55), source-reconciled |
| C4: executable verification | C1–C3 | Targeted regressions, typecheck, lint and full suite pass at exact revision | Pending |
| C5: runtime acceptance | C4 | Real Electron, target playback, GPU/software encode, interruption/restart and matched baseline comparison | Pending; [#164](https://github.com/ophilar/Totality/issues/164), [#165](https://github.com/ophilar/Totality/issues/165) remain open |

### Decisions and risks

- Reject historical output-size tie-breaking: use calibration to initialize the bounded search, never to override measured output-quality or playback gates. The effect on actual selected quality, storage savings and elapsed time is a hypothesis until measured.
- Reject reuse of unscoped database records and resume from unverifiable calibration checkpoints. A resumed calibration remeasures. This deliberately trades additional encoding work for evidence validity; old database records are not authoritative.
- Use production sample windows to make scope comparison exact. Retain the configured two-candidate calibration budget. Its adequacy, the fraction of scopes receiving an eligible prior, and calibration cost require runtime evidence.
- Quality domains and gates are packaged policy; learned entries are user-data JSON. They are distinct owners, not two writable sources of the same parameters. Profile activation is a flushed temporary write and rename, not proof of power-loss durability.
- Current calibration is balanced/automatic and the configured playback policy; it does not train all quality profiles or playback modes. A different profile must not borrow the evidence.
- Review finding corrected in C3: a representative preflight failure could discard completed rejection evidence. Incomplete or unavailable holdouts may still reduce coverage; report them separately and do not imply exhaustive generalization.

### Exact restart

On the supported local Totality checkout, update `0.9.0` and record the actual revision. Run:

```sh
git switch 0.9.0
git pull --ff-only
git rev-parse HEAD
npx vitest run tests/unit/services/MeasuredOptimizationPolicy.test.ts tests/unit/services/OptimizationCalibrationProfile.test.ts
npm run typecheck
npm run lint
npm run test:run
npm run electron:dev
```

Use the installed repository dependencies and the supported FFmpeg/FFprobe toolchain. Record OS, GPU/device fingerprint, FFmpeg and measurement fingerprints, playback profile, source/library scope, sample settings, candidate sequence, measured quality, savings and timing. Do not transcode/replace source media merely to calibrate. Exercise the existing calibration task with an empty active profile, then compare fresh preflights on matching and nonmatching scopes. Confirm rejection gates and real target playback. Cancel and terminate/restart Electron before publication and after publication; inspect the active JSON and verify the recovered task's behavior. Include a failing holdout, empty inventory and incompatible target. Record coverage and failures, open narrowly scoped defects if reproduced, and rerun invalidated checks. Preserve the existing safe-operation and historical-report acceptance work.

At this checkpoint no new automated-test or runtime/device evidence has been obtained for C1–C3. GitHub source inspection and branch readback are the only verified evidence; prior test results on other revisions do not transfer. Product acceptance is open. No release or upstream merge is implied.


## 2026-11-28 — Pareto calibration revision (approved)

Supersedes balanced-only calibration and independent holdout searches above. Baseline `d751cdb53ab8b51719088af2703a7a77a4603114`; prior source audit establishes defects, not runtime reproduction. User requires all quality profiles as choice points on a common measured Pareto frontier.

Design: measure the same configured candidate catalogue on distinct training and holdout titles, with full quality metrics rather than profile-specific early rejection. For each context and candidate, require complete evidence on every selected representative in that context, including independent training and holdout titles. Aggregate rates and quality conservatively across titles, retain non-dominated choices, and choose the smallest validated rate satisfying each profile's gates. The profile is a search prior, never permission to activate an unmeasured output. Use the existing metric/encoder pipeline; do not create another optimizer. Explicit encoder policies filter the shared catalogue by verified encoder/device/preset. Calibration must not publish production reviews or overwrite library quality scores.

| Unit | Dependency | Acceptance | State |
| --- | --- | --- | --- |
| P1: shared context and Pareto policy | audit | full candidate evidence, independent holdouts, per-profile frontier choices | planned |
| P2: measurement integration | P1 | identical calibration catalogue across titles, all verified GPU/software encoders, isolation, honest failures, partial diagnostics | planned |
| P3: production consumers | P1/P2 | profile-aware priors, direct parameter integration, complete cache identity and playback evidence, cleanup and diagnostics | planned |
| P4: verification | P1–P3 | tests, typecheck/lint, real hardware/library, activation and quality/savings benchmark | pending |

Tradeoff: evaluating the configured finite catalogue costs more than the former two-probe search; do not silently reduce coverage. Preserve bounded adaptive production search. Exact context matching may leave sparse cohorts unvalidated; report this rather than borrowing incompatible results. Historical job size estimation must be scoped or explicitly unavailable, not presented as validated calibration. Existing 0.4/0.5 history and runtime tasks remain intact.


### Pareto implementation checkpoint

| Unit | State and evidence |
| --- | --- |
| P1 | Source-reconciled: [shared calibration catalogue](https://github.com/ophilar/Totality/commit/277257ab14c045992f2b328919ff1f209983fcbb), [rate-envelope validation](https://github.com/ophilar/Totality/commit/3da2333d03502de578d7e65da226ad660250f33a), [single persisted frontier](https://github.com/ophilar/Totality/commit/e6ba1a0ad881825fb65b507e41d4b2e5d68e42f2). |
| P2 | Source-reconciled: [isolated calibration and coverage](https://github.com/ophilar/Totality/commit/96107600c7808d4b704d2e0cd475b0e62672ff03). Full finite catalogue uses production sampling and verified hardware/software domains. Two independent training titles and at least one holdout required; missing candidate evidence excludes the point. |
| P3 | Source-reconciled: [video sample and savings verification](https://github.com/ophilar/Totality/commit/a692e9116289863e880ab43c4a7feb1864824754), [shared direct planning and encoder registry](https://github.com/ophilar/Totality/commit/ac9fc37bd754564c1e5aebb1dadd8077b5957414). Cache context and rejection evidence retained; artifact cleanup clears active profile; historical size prediction replaced at execution by the current reviewed sample projection. Direct parameter preview uses the same planner; smart/transcode execution requires a reviewed plan. |
| P4 | Focused executable source-logic checks: 11/11 at `e6ba1a0ad881825fb65b507e41d4b2e5d68e42f2`, using fetched function bodies with TypeScript annotations erased and actual JSON gates. Verified three distinct profile choices on a single three-point frontier, independent training, missing/failed holdout veto, scope and bounded/unbounded mismatch, in-range and out-of-range rate limits. This is not the repository Vitest suite, TypeScript compilation, integration or device acceptance. Full checks pending: local `git ls-remote https://github.com/ophilar/Totality.git refs/heads/0.9.0` failed with DNS resolution error. |

**Current JSON contract:** schema v4, measurement v18, search v8. Store one point per non-dominated encoder/device/preset family choice with worst measured VMAF mean, VMAF p5 and CAMBI, maximum observed output bytes/s and encoding ms/s, independent training/holdout counts, context identity and optional validated bitrate envelope. The three quality profiles are computed views using the packaged JSON gates; no per-profile duplicated models. Production search uses a prior only inside the matching structural context and the intersection of training/holdout observed rate ceilings; this is interpolation support for a search initialization, not a proof of quality on unseen content. Recalibration is required for old profile versions. Sparse cohorts, unsupported codecs, failed measurements and absent profile choices must remain explicit. Coverage depends on actual library distribution and configured default playback policy; calibration does not claim evidence for other playback contexts. All current-file output verification and user approval requirements remain.

**Additional findings during remediation:** video-only encode samples were incorrectly subjected to full audio/subtitle stream-count validation; current sample validation checks video and projects retained-stream metadata/bitrate, while final output still checks real retained streams. Previous hardware fingerprint omitted the verified encoder map. Direct previews now share production planning; the measured encoder registry is the authority for supported presets and quality domains. The prior unscoped job estimator is not used for new transcoding predictions; historical records remain. Quality score sample projections include retained non-video rate. These integration changes require executed regression tests.

**Restart:** implementation revision `e6ba1a0ad881825fb65b507e41d4b2e5d68e42f2`. Follow the earlier exact restart commands, adding `tests/unit/QualityAnalyzer.test.ts`, `tests/unit/QualityAnalyzerFileEvidence.test.ts`, `tests/unit/services/MeasuredOptimizationService.test.ts`, and `tests/unit/services/transcoding/ShowOptimizationQueueAndExpiration.test.ts` to targeted checks. On real hardware, compare prior/no-prior candidate sequence, quality, actual size and wall time across all three profiles; report coverage by context and encoder, rejected/missing holdouts, profile and rate-envelope mismatches, and cancellation/restart before and after JSON publication. Verify no production review or library score is changed by calibration. Verify video-only samples with audio/subtitle-bearing sources, direct preview parity, and final stream/quality/savings verification before activation. No release or runtime acceptance is implied.


## 2026-11-28 — Consolidation and modernization follow-up

Baseline `05433e3bbd1895ecf6535b31fea031685e5acf02`. Continue on existing branch; no release or dependency downgrade. Scope is the optimization/calibration subsystem, not unrelated rewrites. AIRA: inspect callers and historical purpose before removing superseded paths; preserve persisted jobs and user data. Acceptance: shared candidate evidence, all configured playback contexts, explicit sparse/failed cohort coverage, bounded temporary storage, no production-review side effects, complete cache identity and cancellation-safe publication. Sequence: M1 playback contexts and diagnostic identity; M2 transient calibration evidence and candidate-search/cache consolidation; M3 remaining estimator and activation ownership audit; M4 executable tests and device benchmark. M1 source change trains the existing unbounded/no-target context plus each configured target under all applicable playback policies; unsupported target codecs are excluded only for enforced playback. Each context gets its own job and failure identity. HDR conversion and explicitly customized stream/container policies still require matching evidence. No claim of coverage until measurement. Runtime verification remains open.
