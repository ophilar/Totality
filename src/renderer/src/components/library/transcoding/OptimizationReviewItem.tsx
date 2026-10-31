import type { ReactNode } from 'react'
import type { PlaybackTargetEvaluation } from '@main/types/playbackTarget'
import { PlaybackCompatibilityFindings } from '../PlaybackCompatibilityPanel'
import { EstimatedSavingsDisplay } from '../EstimatedSavingsDisplay'
import { optimizationDecisionLabel } from './optimizationStatus'

export interface OptimizationReviewItemModel {
  label: string
  compatible: boolean
  decisionStatus?: string
  reason?: string | null
  params?: { summary?: string }
  changes?: string[]
  targetCompatibility?: PlaybackTargetEvaluation
  targetProfile?: { name?: string }
  samplePaths?: string[]
  samplingRole?: string
  savingsBasis?: string
  estimatedSavingsBytes?: number | null
}

export function OptimizationReviewItem<T extends OptimizationReviewItemModel>({ item, targetSelected, badges, onOpenSample, children }: {
  item: T
  targetSelected: boolean
  badges?: ReactNode
  onOpenSample?: (index: number) => void
  children?: ReactNode
}) {
  return <section className="space-y-2 rounded-lg border border-border/30 bg-background/50 p-3 text-sm" aria-label={`${item.label}: ${optimizationDecisionLabel(item.decisionStatus)}`}>
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h4 className="font-semibold">{item.label}</h4>
      <div className="flex flex-wrap items-center gap-1.5">{badges}<span className="text-xs text-muted-foreground">{item.compatible ? optimizationDecisionLabel(item.decisionStatus) : 'Not compatible'}</span></div>
    </div>
    {!item.compatible && item.reason && <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Why it is blocked</summary><p className="pt-1 text-muted-foreground">{item.reason}</p></details>}
    {!targetSelected && !item.targetCompatibility && <p className="text-xs text-muted-foreground">Playback compatibility not checked</p>}
    {item.params?.summary && <p className="text-xs text-muted-foreground">{item.params.summary}</p>}
    {item.changes?.map(change => <p key={change} className="text-xs text-muted-foreground">{change}</p>)}
    {item.targetCompatibility && <PlaybackCompatibilityFindings evaluation={item.targetCompatibility} targetName={item.targetProfile?.name} />}
    {item.samplePaths?.map((sample, index) => onOpenSample && <button key={sample} type="button" className="mr-3 text-xs underline" onClick={() => onOpenSample(index)}>Open sample {index + 1}</button>)}
    <div className="flex justify-end border-t border-border/30 pt-2 text-xs text-muted-foreground">
      <span>{item.samplingRole === 'projected' ? 'Projected savings' : item.samplingRole === 'measured' || item.savingsBasis === 'video_sample_encode' ? 'Measured savings' : 'Estimated savings'}: <EstimatedSavingsDisplay bytes={item.estimatedSavingsBytes} /></span>
    </div>
    {children}
  </section>
}
