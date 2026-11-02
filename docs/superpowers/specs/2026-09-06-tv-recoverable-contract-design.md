# TV Recoverable Optimization Contract

## Goal

Make TV-series total debt, sorting, dry-run estimates, and optimization recommendations use one defensible, non-overlapping savings model, while keeping every runtime operation scoped to the selected series identity.

## Problem

The previous implementation conflated multiple meanings of recoverable storage and multiple TV series sharing one title:

- `QualityAnalyzer` stores video bloat plus removable-audio savings in `storage_debt_bytes`.
- TV aggregation and the existing `recoverable` sort key consume `storage_debt_bytes`.
- Dry-run passed that value as `recoverableBytes`, treated it as video debt, and independently computed removable-audio savings again.
- Dry-run could therefore double-count audio savings and display a percentage based on a different numerator from the displayed combined bytes.
- `recoverableBytes` could mean audio-pruning savings while `totalRecoverableBytes` meant the canonical total.
- Recommendation logic was duplicated between `OptimizationDecisionService` and IPC code.
- TV episode aggregates were grouped by `series_identity_key` but joined back to series rows without that identity key.
- Renderer selection, completeness lookup, episode loading, and single-series analysis used `series_title`, so two distinct same-title series could be conflated.
- Existing migrations add `series_identity_key` columns but do not backfill historical rows, which forces runtime title fallback unless persistence is repaired.

## Canonical savings model

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
8. Existing savings aliases such as `recoverableBytes` and `totalCombinedSavingsBytes` equal `totalRecoverableBytes`.
9. Audio/video component fields remain available for diagnostics; they are not separate debt columns in the TV list.

## TV list terminology

The TV list has one storage-recovery column: **Total Debt**.

- Its current persisted source is the combined `storage_debt_bytes` aggregate.
- Its internal sort key remains `recoverable` to avoid an unnecessary rename.
- The rendered value and sort value are the same `TVShowSummary.total_recoverable_bytes` quantity.
- Audio pruning and video debt may be shown separately inside dry-run diagnostics, but not as competing list debt columns.

## Decision authority

`OptimizationDecisionService` owns action precedence. IPC may translate its resolved primary action to an existing response label, but it must not implement a second recommendation policy.

Primary action precedence:

1. `review-language`
2. `remove-audio-tracks`
3. `transcode-audio`
4. `transcode-video`
5. `no-action`

Audio transcoding is calculated only over tracks retained after pruning.

## Savings persistence

Existing `storage_debt_bytes` is already a **combined video-bloat + audio-pruning total**. It therefore remains valid as the existing TV Total Debt aggregate, but it must never again be interpreted as video-only debt.

For current persisted rows:

- TV list and Total Debt sort continue to use the existing combined total, preserving all user data and current analysis results.
- Fresh dry-run recomputes audio pruning from current stream evidence.
- When only the existing combined value exists, video debt is the nonnegative residual `legacyTotalRecoverable - freshAudioPruning`; fresh audio is not added to the existing total a second time.
- Explicit `videoDebtBytes`, when available, takes precedence over that residual.

A later additive component migration may promote `estimated_savings_bytes` to the canonical stored total and add explicit component columns:

- `video_debt_bytes`
- `audio_pruning_savings_bytes`
- `audio_transcode_savings_bytes`

That component migration must be paired with re-analysis. Old combined values cannot be reliably split, so migration must never fabricate component values merely to populate new columns.

## TV-series identity contract

A renderer-visible TV series is identified by:

```text
series_identity_key + source_id + library_id
```

`series_title` is display metadata, not identity.

The following operations carry the selected scoped identity:

- React row/card identity
- selected-show state
- completeness lookup
- episode loading and reload
- single-series analysis
- dry-run optimization
- missing-item dismissal
- global-search navigation
- optimization/transcode handoff

Runtime title fallback is not part of the target contract. Historical rows lacking `series_identity_key` must be canonicalized during database migration using the existing `deriveSeriesIdentityKey` rules. The same persistence step must canonicalize episode identity before runtime joins consume it.

Episode aggregate joins are identity-first by `series_identity_key + source_id + library_id`. Once historical rows are backfilled, the legacy null/title join branch must be removed.

Identity-scoped IPC methods must receive the full scope used by the renderer. Existing title-only APIs may remain only while an actual existing caller requires them; they must not be used by the TV renderer and must not silently combine identities.

## API ownership

Identity-scoped series bridge methods belong to the existing `mediaApi`. A second preload wrapper for the same operations is redundant and must not exist.

`OptimizationSavingsService` is the single source of truth for recovery arithmetic. `OptimizationDecisionService` is the single source of truth for action precedence.

## Compatibility

Existing public field names are retained when removal or rename has no correctness benefit. Compatibility does not justify duplicate implementations, runtime title fallback, fabricated values, or parallel API surfaces.

No optimization action, persisted user data, or historical debt value is removed.

## Verification invariants

- `recoverableBytes === totalRecoverableBytes` in dry-run output.
- `totalCombinedSavingsBytes === totalRecoverableBytes` in dry-run output.
- No audio byte contributes to more than one savings mechanism.
- Existing combined recoverable bytes are not double-counted with freshly measured audio pruning.
- Video-only recoverable space yields `transcode-video` as primary action.
- Scored episode count equals episodes with an efficiency score.
- The TV list exposes one **Total Debt** column and sorts on the exact displayed debt value.
- Equivalent evidence produces identical list/sort and dry-run total-debt quantities.
- Dry-run percentage uses the displayed canonical total as its numerator.
- Same-title/different-identity series remain distinct in rows, pagination, selection, completeness, episode loading, analysis, dismissal, and dry-run.
- Runtime TV identity does not depend on `series_title` after historical identity backfill.
- No silent parse/error path is introduced by the identity work.

## Merge gate

PR #154 remains draft/open until historical identity backfill is implemented, runtime title fallback is removed, and all tests plus the production build pass on the **latest PR head**. An earlier green workflow run is not evidence for a later head.
