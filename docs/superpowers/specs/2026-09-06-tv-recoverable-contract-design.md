# TV Recoverable Optimization Contract

## Goal

Make TV-series recovery, sorting, dry-run estimates, and optimization recommendations use one defensible, non-overlapping savings model.

## Problem

The current implementation conflates multiple meanings of recoverable storage:

- `QualityAnalyzer` stores video bloat plus removable-audio savings in `storage_debt_bytes`.
- TV aggregation and Recoverable sorting consume `storage_debt_bytes`.
- Dry-run passes that value as `recoverableBytes`, treats it as video debt, and independently computes removable-audio savings again.
- Dry-run therefore can double-count audio savings and display a percentage based on a different numerator from the displayed combined bytes.
- Recommendation logic is duplicated between `OptimizationDecisionService` and IPC code.
- TV episode aggregates are grouped by `series_identity_key` but the join back to series rows does not include that identity key.

## Canonical model

One episode optimization result owns these independent components:

```ts
interface OptimizationSavingsBreakdown {
  videoDebtBytes: number | null
  audioPruningBytes: number | null
  audioTranscodeBytes: number | null
  totalRecoverableBytes: number
  percentageSavings: number | null
  coverage: 'complete' | 'partial' | 'insufficient'
}
```

Rules:

1. Video debt contains video savings only.
2. Audio-pruning savings contain bytes for removable tracks only.
3. Audio-transcode savings apply only to tracks retained after pruning.
4. The same bytes may never appear in two components.
5. Unknown evidence is `null`, not zero.
6. `totalRecoverableBytes` is the sum of known non-overlapping components.
7. `percentageSavings = totalRecoverableBytes / totalBytes` whenever total size is known and positive.
8. Series aggregation is a sum of episode canonical totals with explicit coverage/scored counts.

## Decision authority

`OptimizationDecisionService` is the sole authority for recommendation semantics. IPC and repositories may expose or aggregate decisions but may not independently synthesize action strings.

Primary action precedence:

1. `review-language`
2. `remove-audio-tracks`
3. `transcode-audio`
4. `transcode-video`
5. `no-action`

Structured mechanism decisions remain available alongside `primaryAction`.

## Persistence

`estimated_savings_bytes` becomes the canonical persisted total. Existing `storage_debt_bytes` remains compatibility data during migration and must no longer be treated as pure video debt.

Explicit component columns should be added to `quality_scores`:

- `video_debt_bytes`
- `audio_pruning_savings_bytes`
- `audio_transcode_savings_bytes`

Old combined values cannot be reliably split, so migration must not fabricate components. Re-analysis repopulates canonical values.

## TV-series contract

The following must represent the same canonical total when based on equivalent evidence:

- TV list Recoverable value
- Recoverable sort key
- show optimization summary
- dry-run Estimated Recoverable
- dry-run percentage numerator

Episode aggregates and series rows are joined identity-first by `series_identity_key + source_id + library_id`. Title fallback is limited to unresolved legacy identities.

## Compatibility

Existing renderer/API properties may remain temporarily as aliases, but their values must map to canonical semantics. No feature, optimization action, or persisted user data is removed.

## Verification invariants

- No audio byte contributes to more than one savings mechanism.
- Video-only recoverable space yields `transcode-video` as primary action.
- Scored episode count equals episodes with an efficiency score.
- Equivalent evidence produces identical list, sort, and dry-run recoverable totals.
- Dry-run percentage uses the displayed recoverable total.
- Same-title/different-identity series remain distinct with correct pagination/counting.
