import { useEffect, useState } from 'react'
import { AlertCircle, Loader2, Zap } from 'lucide-react'
import { TranscodeModal } from '@/components/library/TranscodeModal'
import type { MediaItem } from '@/components/library/types'
import type { OptimizationDecision, OptimizationDecisionMechanism } from '@main/services/OptimizationDecisionService'
import { EstimatedSavingsDisplay } from '@/components/library/EstimatedSavingsDisplay'

type DecisionState = { mediaId: number; decision: OptimizationDecision | null; error: string | null }

function MechanismRow({ label, mechanism }: { label: string; mechanism: OptimizationDecisionMechanism }) {
  return <div className="flex items-center gap-3 border-t border-border/30 py-2 first:border-t-0">
    <div className="min-w-0 flex-1">
      <div className="font-medium">{label}</div>
      <div className="text-muted-foreground">{mechanism.reason}</div>
    </div>
    <span className="shrink-0 text-muted-foreground">Est. savings <EstimatedSavingsDisplay bytes={mechanism.estimatedSavingsBytes} /></span>
  </div>
}

const pendingDecisionRequests = new Map<number, Promise<OptimizationDecision>>()

function getOptimizationDecision(mediaId: number): Promise<OptimizationDecision> {
  const pending = pendingDecisionRequests.get(mediaId)
  if (pending) return pending

  const request = (async () => {
    try {
      return await window.electronAPI.optimizationGetDecision(mediaId) as OptimizationDecision
    } finally {
      pendingDecisionRequests.delete(mediaId)
    }
  })()
  pendingDecisionRequests.set(mediaId, request)
  return request
}

export function ConversionRecommendation({ item, compact = false, onOptimizationCompleted }: { item: MediaItem; compact?: boolean; onOptimizationCompleted?: () => void }) {
  const [decisionState, setDecisionState] = useState<DecisionState | null>(null)
  const [showTranscodeModal, setShowTranscodeModal] = useState(false)
  const mediaId = item.id
  const currentState = decisionState?.mediaId === mediaId ? decisionState : null
  const decision = currentState?.decision ?? null
  const error = currentState?.error ?? null
  const loading = currentState == null

  useEffect(() => {
    let active = true
    void getOptimizationDecision(mediaId).then(nextDecision => {
      if (active) setDecisionState({ mediaId, decision: nextDecision, error: null })
    }).catch(reason => {
      if (active) {
        setDecisionState({
          mediaId,
          decision: null,
          error: reason instanceof Error ? reason.message : String(reason),
        })
      }
    })
    return () => { active = false }
  }, [mediaId])

  if (loading) return <div className="flex items-center gap-2 p-3 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Analyzing optimization options</div>
  if (error) return <div className="flex items-center gap-2 p-3 text-destructive"><AlertCircle className="h-4 w-4" />{error}</div>
  if (!decision) return null

  const pruneStreams = decision.trackRemoval.status === 'executable'
  const transcodeAudio = decision.audioTranscode.status === 'executable' &&
    decision.audioTranscode.estimatedSavingsBytes != null && decision.audioTranscode.estimatedSavingsBytes > 0
  const transcodeVideo = (decision.videoTranscode.status === 'review-required' || decision.videoTranscode.status === 'executable') &&
    decision.videoTranscode.estimatedSavingsBytes != null && decision.videoTranscode.estimatedSavingsBytes > 0
  const hasSupportedOperation = Boolean(item.file_path) && (pruneStreams || transcodeAudio || transcodeVideo)
  return <div className={`${compact ? 'text-[10px]' : 'text-xs'} mt-3 rounded-md border border-primary/20 bg-primary/5 p-3`}>
    <div className="mb-2 flex items-center gap-2 font-semibold text-primary"><Zap className="h-3.5 w-3.5" />Disk optimization</div>
    <MechanismRow label="Remove audio tracks" mechanism={decision.trackRemoval} />
    <MechanismRow label="Transcode audio" mechanism={decision.audioTranscode} />
    <MechanismRow label="Transcode video" mechanism={decision.videoTranscode} />
    {!compact && <div className="mt-3 border-t border-border/30 pt-3">
      <div className="mb-1 font-medium">Audio track analysis</div>
      <div className="space-y-1 text-muted-foreground">
        {decision.trackRemoval.tracks.map(track => <div key={track.index} className="flex justify-between gap-2">
          <span>{track.language || 'Unknown'}{track.title ? ` · ${track.title}` : ''} · {track.codec} · {track.channelLayout || `${track.channels}ch`}{track.hasObjectAudio ? ' · Object audio' : ''}{track.isCommentary ? ' · Commentary' : ''}{track.isAudioDescription ? ' · Audio description' : ''}{track.isAccessibility ? ' · Accessibility' : ''}</span>
          <span>{decision.trackRemoval.retainedTrackIndexes.includes(track.index) ? 'Retain' : decision.trackRemoval.removableTrackIndexes.includes(track.index) ? 'Remove' : 'Review'}</span>
        </div>)}
      </div>
      <div className="mt-2">Language confidence: {decision.trackRemoval.confidence}</div>
    </div>}
    {!hasSupportedOperation && <div className="pt-2 text-muted-foreground">No supported optimization action is available.</div>}
    {hasSupportedOperation && <button type="button" onClick={() => setShowTranscodeModal(true)} className="mt-3 rounded bg-primary px-3 py-1.5 font-semibold text-primary-foreground">Review optimization</button>}
    {showTranscodeModal && <TranscodeModal mediaId={mediaId} initialOptimizationMode={transcodeVideo ? 'transcode' : 'remux_only'} initialStreamPruning={pruneStreams} initialAudioTranscode={transcodeAudio} onOptimizationCompleted={onOptimizationCompleted} onClose={() => setShowTranscodeModal(false)} />}
  </div>
}
