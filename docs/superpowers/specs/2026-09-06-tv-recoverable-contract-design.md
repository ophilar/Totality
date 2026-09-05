# TV Recoverable Optimization Contract

## Goal

Make TV-series recovery, sorting, dry-run estimates, and optimization recommendations use one defensible, non-overlapping savings model.

## Problem

The previous implementation conflated multiple meanings of recoverable storage:

- `QualityAnalyzer` stores video bloat plus removable-audio savings in `storage_debt_bytes`.
- TV aggregation and Recoverable sorting consume `storage_debt_bytes`.
- Dry-run passed that value as `recoverableBytes`, treated it as video debt, and independently computed removable-audio savings again.
- Dry-run could therefore double-count audio savings and display a percentage based on a different numerator from the displayed combined bytes.
- Recommendation logic was duplicated between `OptimizationDecisionService` and IPC code.
- TV episode aggregates were grouped by `series_identity_key` but joined back to series rows without that identity key.
- Dry-run requests identified a series only by title and source, so distinct same-title identities could be analyzed together.

## Canonical model

One optimization result owns these independent components:

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

`OptimizationDecisionService` owns action precedence. IPC may translate its resolved primary action to legacy response labels for compatibility, but it must not invent a conflicting recommendation.

Primary action precedence:

1. `review-language`
2. `remove-audio-tracks`
3. `transcode-audio`
4. `transcode-video`
5. `no-action`

Audio transcoding is calculated only over tracks retained after pruning.

## Persistence and compatibility migration

Implementation discovered that existing `storage_debt_bytes` is already a **combined video-bloat + audio-pruning total**. It therefore remains valid as the existing TV list/sort Recoverable aggregate, but it must never again be interpreted as video-only debt.

For current persisted rows:

- TV list and Recoverable sort continue to use the existing combined total, preserving all user data and current analysis results.
- Fresh dry-run recomputes audio pruning from current stream evidence.
- When only the legacy combined value exists, video debt is treated as the nonnegative residual `legacyTotalRecoverable - freshAudioPruning`; fresh audio is not added to the legacy total a second time.
- Explicit `videoDebtBytes`, when available, always takes precedence over the compatibility residual.

A later additive persistence migration may promote `estimated_savings_bytes` to the canonical stored total and add explicit component columns:

- `video_debt_bytes`
- `audio_pruning_savings_bytes`
- `audio_transcode_savings_bytes`

That migration must be paired with re-analysis. Old combined values cannot be reliably split, so migration must never fabricate component values merely to populate new columns. This component migration is not required to correct the current list/sort/dry-run contract.

## TV-series contract

The following represent the same recoverable quantity when based on equivalent evidence:

- TV list Recoverable value
- Recoverable sort key
- show optimization summary
- dry-run Estimated Recoverable
- dry-run percentage numerator

Episode aggregates and series rows are joined identity-first by `series_identity_key + source_id + library_id`. Title fallback is limited to unresolved legacy identities.

Dry-run requests carry `series_identity_key` and `library_id` end to end, so same-title resolved series are not mixed during optimization analysis.

## Compatibility

Existing renderer/API properties remain temporarily as aliases where needed. New canonical fields include `totalRecoverableBytes`, `audioPruningBytes`, `videoDebtBytes`, `coverage`, and `primaryAction`.

No feature, optimization action, or persisted user data is removed.

## Verification invariants

- No audio byte contributes to more than one savings mechanism.
- Legacy combined recoverable bytes are not double-counted with freshly measured audio pruning.
- Video-only recoverable space yields `transcode-video` as primary action.
- Scored episode count equals episodes with an efficiency score.
- Equivalent evidence produces identical list, sort, and dry-run recoverable totals.
- Dry-run percentage uses the displayed recoverable total.
- Same-title/different-identity series remain distinct with correct sorting and pagination.
- Dry-run episode lookup is scoped by series identity and library.
