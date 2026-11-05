import type { ReactNode } from 'react'
import { formatLanguage } from '@main/constants/languages'
import type { PlaybackTargetEvaluation } from '@main/types/playbackTarget'
import type { FileAnalysisResult } from '@main/services/MediaFileAnalyzer'
import type { PlannedAudioStream } from '@main/services/transcoding/StreamSelectionPlan'
import { PlaybackCompatibilityFindings } from '../PlaybackCompatibilityPanel'
import { EstimatedSavingsDisplay } from '../EstimatedSavingsDisplay'
import { optimizationDecisionLabel } from './optimizationStatus'

export interface OptimizationReviewItemModel {
  label: string
  compatible: boolean
  decisionStatus?: string
  reason?: string | null
  params?: { summary?: string; measuredCandidate?: { searchSummary?: { measuredCount: number; maximumCandidates: number; budgetReached: boolean } } }
  changes?: string[]
  targetCompatibility?: PlaybackTargetEvaluation
  targetProfile?: { name?: string }
  samplePaths?: string[]
  samplingRole?: string
  savingsBasis?: string
  estimatedSavingsBytes?: number | null
  audioPlan?: PlannedAudioStream[]
  sourceAnalysis?: Pick<FileAnalysisResult, 'audioTracks'>
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
    {item.params?.measuredCandidate?.searchSummary && <p className="text-xs text-muted-foreground" role="note">{item.params.measuredCandidate.searchSummary.measuredCount} candidate settings evaluated (limit {item.params.measuredCandidate.searchSummary.maximumCandidates}). {item.params.measuredCandidate.searchSummary.budgetReached ? 'Search budget reached; best tested setting, not a guaranteed global optimum.' : 'Search completed within the configured quality grid.'}</p>}
    {item.audioPlan?.length ? <details className="text-xs">
      <summary className="cursor-pointer font-medium">Audio track decisions</summary>
      {!item.compatible && <p className="pt-1 text-muted-foreground">Proposed selections only; optimization is blocked.</p>}
      <ul className="space-y-1 pt-2">
        {item.audioPlan.map(({ index, action, targetCodec }) => {
          const track = item.sourceAnalysis?.audioTracks.find(candidate => candidate.index === index)
          return <li key={index} className="flex justify-between gap-3">
            <span>{formatLanguage(track?.language)}{track?.title ? ` · ${track.title}` : ''} · {track?.codec || 'Unknown codec'} · {track?.channelLayout || (track?.channels ? `${track.channels}ch` : 'Unknown channels')}</span>
            <span>{action === 'convert' ? `Convert to ${targetCodec?.toUpperCase()}` : action === 'remove' ? 'Remove' : 'Keep'}</span>
          </li>
        })}
      </ul>
    </details> : null}
    {item.changes?.map(change => <p key={change} className="text-xs text-muted-foreground">{change}</p>)}
    {item.targetCompatibility && <PlaybackCompatibilityFindings evaluation={item.targetCompatibility} targetName={item.targetProfile?.name} />}
    {item.samplePaths?.map((sample, index) => onOpenSample && <button key={sample} type="button" className="mr-3 text-xs underline" onClick={() => onOpenSample(index)}>Open sample {index + 1}</button>)}
    <div className="flex justify-end border-t border-border/30 pt-2 text-xs text-muted-foreground">
      <span>{item.samplingRole === 'projected' ? 'Representative-based projection' : item.samplingRole === 'measured' || item.savingsBasis === 'video_sample_encode' ? 'Sample-based projection' : 'Estimated savings'}: <EstimatedSavingsDisplay bytes={item.estimatedSavingsBytes} /></span>
    </div>
    {children}
  </section>
}
