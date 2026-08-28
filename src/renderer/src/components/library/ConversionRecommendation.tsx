import { useEffect, useState } from 'react'
import { AlertCircle, Loader2, Zap } from 'lucide-react'
import { TranscodeModal } from '@/components/library/TranscodeModal'
import type { MediaItem } from '@/components/library/types'
import type { OptimizationDecision, OptimizationDecisionMechanism } from '@main/services/OptimizationDecisionService'

const formatBytes = (value: number | null) => {
  if (value == null) return 'Estimate unavailable'
  if (value < 1024) return `${Math.round(value)} B`
  if (value < 1024 ** 2) return `${Math.round(value / 1024)} KB`
  return value < 1024 ** 3 ? `${Math.round(value / 1024 ** 2)} MB` : `${(value / 1024 ** 3).toFixed(1)} GB`
}

type EvidenceKind = 'measured' | 'estimated' | 'insufficient'
type EvidenceMechanism = OptimizationDecisionMechanism & { evidence?: EvidenceKind }

const getEvidenceKind = (mechanism: EvidenceMechanism): EvidenceKind => {
  if (mechanism.evidence) return mechanism.evidence
  return mechanism.estimatedSavingsBytes != null && Number.isFinite(mechanism.estimatedSavingsBytes)
    ? 'estimated'
    : 'insufficient'
}

const evidenceLabel = (mechanism: EvidenceMechanism) => {
  const evidence = getEvidenceKind(mechanism)
  return evidence === 'measured' ? 'Measured' : evidence === 'estimated' ? 'Estimated savings' : 'Insufficient evidence'
}

function MechanismRow({ label, mechanism, action, onAction }: { label: string; mechanism: OptimizationDecisionMechanism; action?: string; onAction?: () => void }) {
  return <div className="flex items-center gap-3 border-t border-border/30 py-2 first:border-t-0">
    <div className="min-w-0 flex-1">
      <div className="font-medium">{label}</div>
      <div className="text-muted-foreground">{mechanism.reason}</div>
    </div>
    <span className="shrink-0 text-muted-foreground" title={evidenceLabel(mechanism)}>{mechanism.estimatedSavingsBytes == null ? evidenceLabel(mechanism) : `${evidenceLabel(mechanism)} · ${formatBytes(mechanism.estimatedSavingsBytes)}`}</span>
    {action && onAction && <button onClick={onAction} className="shrink-0 rounded bg-primary px-2 py-1 text-primary-foreground">{action}</button>}
  </div>
}

const decisionCache = new Map<number, OptimizationDecision>()

export function ConversionRecommendation({ item, compact = false }: { item: MediaItem; compact?: boolean }) {
  const [decision, setDecision] = useState<OptimizationDecision | null>(() => item.id ? decisionCache.get(item.id) || null : null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(() => !item.id || !decisionCache.has(item.id))
  const [showTranscodeModal, setShowTranscodeModal] = useState(false)
  const [remuxing, setRemuxing] = useState(false)
  const [remuxError, setRemuxError] = useState<string | null>(null)

  useEffect(() => {
    if (!item.id) return
    const mediaId = item.id
    let active = true
    void Promise.resolve().then(async () => {
      const cached = decisionCache.get(mediaId)
      if (cached) return cached
      if (active) {
        setDecision(null)
        setError(null)
        setLoading(true)
      }
      const value = await window.electronAPI.optimizationGetDecision(mediaId)
      const decision = value as OptimizationDecision
      decisionCache.set(mediaId, decision)
      return decision
    }).then(decision => {
      if (active) {
        setDecision(decision)
      }
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [item.id])

  if (loading) return <div className="flex items-center gap-2 p-3 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Analyzing optimization options</div>
  if (error) return <div className="flex items-center gap-2 p-3 text-destructive"><AlertCircle className="h-4 w-4" />{error}</div>
  if (!decision) return null

  const canExecute = (mechanism: OptimizationDecisionMechanism) => mechanism.status === 'executable' && mechanism.estimatedSavingsBytes != null && mechanism.estimatedSavingsBytes > 0
  const removeTracks = canExecute(decision.trackRemoval)
  const transcode = canExecute(decision.audioTranscode) || canExecute(decision.videoTranscode)
  const requestRemux = async () => {
    setRemuxing(true)
    setRemuxError(null)
    try {
      await window.electronAPI.optimizationRequestLocalRemux(item.id!, true)
      const refreshed = await window.electronAPI.optimizationGetDecision(item.id!)
      setDecision(refreshed as OptimizationDecision)
    } catch (reason) {
      setRemuxError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setRemuxing(false)
    }
  }
  return <div className={`${compact ? 'text-[10px]' : 'text-xs'} mt-3 rounded-md border border-primary/20 bg-primary/5 p-3`}>
    {remuxError && <div className="mb-2 text-destructive">{remuxError}</div>}
    <div className="mb-2 flex items-center gap-2 font-semibold text-primary"><Zap className="h-3.5 w-3.5" />Disk optimization</div>
    <MechanismRow label="Remove audio tracks" mechanism={decision.trackRemoval} action={removeTracks ? (remuxing ? 'Working' : 'Remove audio tracks') : undefined} onAction={requestRemux} />
    <MechanismRow label="Transcode audio" mechanism={decision.audioTranscode} action={decision.primaryAction === 'transcode-audio' && canExecute(decision.audioTranscode) ? 'Transcode audio' : undefined} onAction={() => setShowTranscodeModal(true)} />
    <MechanismRow label="Transcode video" mechanism={decision.videoTranscode} action={decision.primaryAction === 'transcode-video' && canExecute(decision.videoTranscode) ? 'Transcode video' : undefined} onAction={() => setShowTranscodeModal(true)} />
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
    {!removeTracks && !transcode && <div className="pt-2 text-muted-foreground">No executable disk optimization is available.</div>}
    {showTranscodeModal && <TranscodeModal mediaId={item.id!} onClose={() => setShowTranscodeModal(false)} />}
  </div>
}
