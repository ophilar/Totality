import { useEffect, useState } from 'react'
import { AlertCircle, Loader2, Zap } from 'lucide-react'
import { SharedOptimizationDialog } from '@/components/library/TranscodeModal'
import { optimizationScopeForMedia } from './transcoding/OptimizationScope'
import type { MediaItem } from '@/components/library/types'
import type { OptimizationDecision } from '@main/services/OptimizationDecisionService'
import { EstimatedSavingsDisplay } from '@/components/library/EstimatedSavingsDisplay'

type DecisionState = { mediaId: number; decision: OptimizationDecision | null; error: string | null }

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

export function ConversionRecommendation({ item, onOptimizationCompleted }: { item: MediaItem; onOptimizationCompleted?: () => void }) {
  const [decisionState, setDecisionState] = useState<DecisionState | null>(null)
  const [showTranscodeModal, setShowTranscodeModal] = useState(false)
  const [analysisPending, setAnalysisPending] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
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

  if (loading) return <div className="flex items-center gap-2 p-3 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Checking options…</div>
  if (error) return <div role="alert" className="p-3 text-destructive"><div className="flex items-center gap-2"><AlertCircle className="h-4 w-4" />Optimization options unavailable</div><details className="mt-1 text-xs"><summary className="cursor-pointer">Technical details</summary><p className="pt-1">{error}</p></details></div>
  if (!decision) return null

  const pruneStreams = decision.trackRemoval.status === 'executable'
  const transcodeAudio = decision.audioTranscode.status === 'executable' &&
    decision.audioTranscode.estimatedSavingsBytes != null && decision.audioTranscode.estimatedSavingsBytes > 0
  const transcodeVideo = decision.videoTranscode.status === 'review-required' || decision.videoTranscode.status === 'executable'
  const analysisRequired = decision.videoTranscode.evidenceStatus === 'insufficient' && Boolean(item.file_path)
  const hasSupportedOperation = Boolean(item.file_path) && (pruneStreams || transcodeAudio || transcodeVideo)
  const analyzeItem = async () => {
    if (!item.file_path) return
    setAnalysisPending(true)
    setAnalysisError(null)
    try {
      const analysis = await window.electronAPI.ffprobeAnalyzeFile(item.file_path)
      if (!analysis.success) throw new Error(analysis.error || 'File analysis failed')
      const updated = await getOptimizationDecision(mediaId)
      setDecisionState({ mediaId, decision: updated, error: null })
    } catch (reason) {
      setAnalysisError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setAnalysisPending(false)
    }
  }
  return <div className="mt-3 rounded-md border border-primary/20 bg-primary/5 p-3 text-xs">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2 font-semibold text-primary"><Zap className="h-3.5 w-3.5" />{analysisRequired ? 'Analysis needed' : hasSupportedOperation ? 'Optimization available' : 'No optimization available'}</div>
      <span className="shrink-0 text-muted-foreground">Estimated savings <EstimatedSavingsDisplay bytes={item.estimated_savings_bytes} /></span>
    </div>
    {analysisError && <p role="alert" className="mt-2 text-destructive">{analysisError}</p>}
    {analysisRequired && <button type="button" onClick={() => void analyzeItem()} disabled={analysisPending} className="mt-3 rounded border border-border px-3 py-1.5 font-semibold disabled:opacity-50">{analysisPending ? 'Analyzing…' : 'Analyze item'}</button>}
    {hasSupportedOperation && <button type="button" onClick={() => setShowTranscodeModal(true)} className="mt-3 rounded bg-primary px-3 py-1.5 font-semibold text-primary-foreground">Optimize</button>}
    {showTranscodeModal && <SharedOptimizationDialog request={{
      controller: 'media',
      scope: optimizationScopeForMedia(item),
      onClose: () => setShowTranscodeModal(false),
      onOptimizationCompleted,
      initialOptimizationMode: transcodeVideo ? 'smart' : 'remux_only',
      initialStreamPruning: pruneStreams,
    }} />}
  </div>
}
