import { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { 
  X, 
  Film, 
  RefreshCw, 
  Clock, 
  HardDrive, 
  Database,
  ChevronDown
} from 'lucide-react'
import { formatHdrLabel } from '@/components/library/QualityBadges'
import { TranscodeModal } from '@/components/library/TranscodeModal'
import { useToast } from '@/contexts/ToastContext'
import { toSafeNumber, toSafeString } from '@/utils/typeSafety'
import { formatDuration } from '@/components/library/mediaUtils'
import { Zap } from 'lucide-react'
import type { MediaItem, MediaItemVersion } from '@main/types/database'
import type { AnalysisAction } from '@/components/library/analysisScope'

interface MediaDetailsProps {
  mediaId: number
  onClose: () => void
  onFixMatch?: (mediaItemId: number, title: string, year?: number, filePath?: string) => void
}

export function MediaDetails({ mediaId, onClose, onFixMatch }: MediaDetailsProps) {
  const [media, setMedia] = useState<MediaItem | null>(null)
  const [versions, setVersions] = useState<MediaItemVersion[]>([])
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [showTranscodeModal, setShowTranscodeModal] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [deepAnalysis, setDeepAnalysis] = useState<{ peakBitrate?: number; avgBitrate?: number; scanDurationMs?: number } | null>(null)
  const [analysisActions, setAnalysisActions] = useState<AnalysisAction[]>([])
  const [expandedSection, setExpandedSection] = useState<'playback' | 'video' | 'audio' | 'file' | 'analysis' | null>(null)
  const { addToast } = useToast()

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const [item, itemVersions] = await Promise.all([
        window.electronAPI.getMediaItem(mediaId),
        window.electronAPI.getMediaItemVersions(mediaId),
      ])
      
      if (item) {
        setMedia(item as MediaItem)
        const persistedAnalysis = (item as MediaItem).deep_analysis
        if (persistedAnalysis) {
          const persisted = JSON.parse(persistedAnalysis)
          setDeepAnalysis(persisted.deepAnalysis || null)
        } else {
          setDeepAnalysis(null)
        }
        setAnalysisActions([])
        setVersions(itemVersions as MediaItemVersion[])
        
        // Default to best version
        const best = (itemVersions as MediaItemVersion[]).find(v => v.is_best) || (itemVersions as MediaItemVersion[])[0]
        if (best) setSelectedVersionId(best.id!)
      }
    } catch (err) {
      window.electronAPI.log.error('[MediaDetails]', 'Failed to load media details:', err)
      addToast({ title: 'Failed to load details', type: 'error' })
    } finally {
      setLoading(false)
    }
  }, [mediaId, addToast])

  useEffect(() => {
    let active = true
    if (active) void loadData()
    return () => { active = false }
  }, [loadData])

  const handleAnalyze = async () => {
    if (!media?.id) return
    try {
      setIsAnalyzing(true)
      const result = await window.electronAPI.mediaAnalyze({ kind: 'item', mediaId: media.id }) as { actions?: AnalysisAction[]; analysis?: { deepAnalysis?: { peakBitrate?: number; avgBitrate?: number; scanDurationMs?: number } } }
      setAnalysisActions(result.actions ?? [])
      if (result.analysis?.deepAnalysis) setDeepAnalysis(result.analysis.deepAnalysis)
      const refreshed = await window.electronAPI.getMediaItem(media.id)
      if (refreshed) setMedia(refreshed as MediaItem)
    } finally {
      setIsAnalyzing(false)
    }
  }

  if (loading && !media) {
    return createPortal(
      <div className="fixed inset-0 z-200 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <RefreshCw className="w-8 h-8 animate-spin text-primary" />
      </div>,
      document.body
    )
  }

  if (!media) return null

  const sv = versions.find(v => v.id === selectedVersionId) || versions[0]
  const isMovie = media.type === 'movie'
  const analysisComplete = Boolean(deepAnalysis || media.evidence_status)
  const hasOptimizationAction = analysisComplete && (
    analysisActions.some(action => action.id === 'optimize')
    || media.needs_upgrade === true
    || (media.storage_debt_bytes ?? 0) > 0
  )
  
  const formatFileSize = (bytes: number) => {
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let size = bytes
    let unit = 0
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024
      unit++
    }
    return `${size.toFixed(1)} ${units[unit]}`
  }

  const formatBitrate = (kbps: number) => {
    if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`
    return `${kbps} kbps`
  }

  return createPortal(
    <div className="fixed inset-0 z-200 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200" onClick={onClose}>
      <div 
        className="relative bg-card border border-border rounded-2xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Left: Poster/Backdrop Area */}
        <div className="w-full h-[220px] shrink-0 bg-muted relative">
          <div className="w-full h-full relative group">
            {media.poster_url ? (
              <img src={media.poster_url} alt="" className="w-full h-full object-cover shadow-2xl" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground/30"><Film className="w-20 h-20" /></div>
            )}
            <div className="absolute inset-0 bg-linear-to-t from-black/80 via-transparent to-transparent opacity-60" />
          </div>
          
          <button 
            onClick={onClose}
            className="absolute top-4 left-4 p-2 bg-black/40 hover:bg-black/60 rounded-full text-white backdrop-blur-md transition-all z-50 md:hidden"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Right: Info Area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="p-6 pb-4 border-b border-border/10 flex justify-between items-start gap-4">
            <div className="min-w-0">
              <h2 className="text-2xl font-bold truncate leading-tight">{media.title}</h2>
              <div className="flex items-center gap-2 mt-1.5 text-sm text-muted-foreground font-medium">
                {media.year && <span className="bg-muted px-2 py-0.5 rounded text-xs">{media.year}</span>}
                {toSafeNumber(sv?.duration ?? media.duration) > 0 && <><span className="mx-0.5">·</span><span>{formatDuration(toSafeNumber(sv?.duration ?? media.duration))}</span></>}
                {toSafeNumber(sv?.file_size ?? media.file_size) > 0 && <><span className="mx-0.5">·</span><span>{formatFileSize(toSafeNumber(sv?.file_size ?? media.file_size))}</span></>}
                {isMovie && <span className="text-xs uppercase tracking-widest ml-2 opacity-50">Movie</span>}
                {!isMovie && <span className="text-xs uppercase tracking-widest ml-2 opacity-50">S{media.season_number}E{media.episode_number}</span>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={onClose}
                className="hidden md:flex p-2 hover:bg-muted rounded-full text-muted-foreground hover:text-foreground transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
            {/* Version Selection if multiple */}
            {versions.length > 1 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground/70">
                  <Database className="w-3.5 h-3.5" />
                  Available Versions
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {versions.map(v => (
                    <button
                      key={v.id}
                      onClick={() => setSelectedVersionId(v.id!)}
                      className={`text-left p-3 rounded-xl border transition-all ${v.id === selectedVersionId ? 'bg-primary/5 border-primary shadow-xs' : 'border-border/50 hover:border-border bg-muted/20'}`}
                    >
                      <div className="flex justify-between items-center mb-1.5">
                        <span className="font-bold text-sm tracking-tight">{v.resolution} {v.video_codec?.toUpperCase()}</span>
                        {v.is_best && <span className="text-[10px] bg-primary text-primary-foreground font-black px-1.5 py-0.5 rounded-sm">BEST</span>}
                      </div>
                      <div className="flex justify-between text-xs text-muted-foreground font-medium">
                        <span>{formatBitrate(toSafeNumber(v.video_bitrate))}</span>
                        <span>{formatFileSize(toSafeNumber(v.file_size))}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Analysis and compact details */}
            <div className="rounded-xl border border-border/50 bg-muted/20 px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <span className={`h-2.5 w-2.5 rounded-full ${deepAnalysis ? 'bg-green-500' : 'bg-amber-400'}`} />
                    {deepAnalysis ? 'Analysis complete' : 'Not analyzed yet'}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">Episode scope · file, media quality, storage, and metadata</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={handleAnalyze} disabled={isAnalyzing} className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                    <RefreshCw className={`h-4 w-4 ${isAnalyzing ? 'animate-spin' : ''}`} />
                    Analyze
                  </button>
                  <button disabled={!onFixMatch} onClick={() => onFixMatch?.(media.id!, media.title, media.year ?? undefined, media.file_path ?? undefined)} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50">Fix match</button>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between rounded-lg border border-border/40 bg-background/20 px-3 py-2 text-xs">
                <span className="text-muted-foreground">Actions after analysis</span>
                <button onClick={() => setShowTranscodeModal(true)} disabled={!hasOptimizationAction} className="flex items-center gap-2 rounded-md bg-primary/10 px-2.5 py-1.5 font-semibold text-primary hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40">
                  <Zap className="h-3.5 w-3.5" /> Optimize
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              {[
                { id: 'playback' as const, label: 'Playback & compatibility', icon: <Clock className="h-4 w-4" />, summary: 'Compatibility analysis' },
                { id: 'video' as const, label: 'Video details', icon: <Film className="h-4 w-4" />, summary: `${toSafeString(sv?.video_codec ?? media.video_codec).toUpperCase()} · ${toSafeString(sv?.resolution ?? media.resolution ?? media.quality_tier ?? media.tier_quality)} · ${formatBitrate(toSafeNumber(sv?.video_bitrate ?? media.video_bitrate))}` },
                { id: 'audio' as const, label: 'Audio & subtitles', icon: <Clock className="h-4 w-4" />, summary: `${toSafeString(sv?.audio_codec ?? media.audio_codec).toUpperCase()} ${formatChannels(toSafeNumber(sv?.audio_channels ?? media.audio_channels))}` },
                { id: 'file' as const, label: 'File & identifiers', icon: <HardDrive className="h-4 w-4" />, summary: `${formatFileSize(toSafeNumber(sv?.file_size ?? media.file_size))} · ${media.match_status ?? 'Match status unknown'}` },
                { id: 'analysis' as const, label: 'Analysis history', icon: <Database className="h-4 w-4" />, summary: deepAnalysis ? 'Deep bitrate scan available' : 'No analysis recorded' },
              ].map(section => (
                <div key={section.id} className="overflow-hidden rounded-lg border border-border/50 bg-muted/10">
                  <button onClick={() => setExpandedSection(expandedSection === section.id ? null : section.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/30">
                    {section.icon}<span className="text-sm font-semibold">{section.label}</span><span className="ml-auto truncate text-xs text-muted-foreground">{section.summary}</span><ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${expandedSection === section.id ? 'rotate-180' : ''}`} />
                  </button>
                  {expandedSection === section.id && <div className="border-t border-border/40 px-3 py-2.5 text-xs text-muted-foreground">
                    {section.id === 'playback' && <div className="grid grid-cols-2 gap-x-6 gap-y-1"><span>Video stream <b className="float-right text-foreground uppercase">{toSafeString(sv?.video_codec ?? media.video_codec)} · {toSafeString(sv?.resolution ?? media.resolution)}</b></span><span>Audio stream <b className="float-right text-foreground uppercase">{toSafeString(sv?.audio_codec ?? media.audio_codec)} {formatChannels(toSafeNumber(sv?.audio_channels ?? media.audio_channels))}</b></span><span>Target analysis <b className="float-right text-foreground">Not required</b></span></div>}
                    {section.id === 'video' && <div className="grid grid-cols-2 gap-x-6 gap-y-1"><span>Codec <b className="float-right text-foreground uppercase">{toSafeString(sv?.video_codec ?? media.video_codec)}</b></span><span>Resolution <b className="float-right text-foreground">{toSafeString(sv?.resolution ?? media.resolution ?? media.quality_tier)}</b></span><span>Bitrate <b className="float-right text-foreground">{formatBitrate(toSafeNumber(sv?.video_bitrate ?? media.video_bitrate))}</b></span><span>HDR <b className="float-right text-foreground">{formatHdrLabel(media.hdr_format) || '—'}</b></span></div>}
                    {section.id === 'audio' && <div className="grid grid-cols-2 gap-x-6 gap-y-1"><span>Audio <b className="float-right text-foreground uppercase">{toSafeString(sv?.audio_codec ?? media.audio_codec)} {formatChannels(toSafeNumber(sv?.audio_channels ?? media.audio_channels))}</b></span><span>Bitrate <b className="float-right text-foreground">{formatBitrate(toSafeNumber(sv?.audio_bitrate ?? media.audio_bitrate))}</b></span><span>Object audio <b className="float-right text-foreground">{media.has_object_audio ? 'Atmos / DTS:X' : '—'}</b></span></div>}
                    {section.id === 'file' && <div className="space-y-1"><div>Size <b className="float-right text-foreground">{formatFileSize(toSafeNumber(sv?.file_size ?? media.file_size))}</b></div><div>Path <b className="ml-2 font-mono text-foreground" title={toSafeString(sv?.file_path ?? media.file_path)}>{toSafeString(sv?.file_path ?? media.file_path)}</b></div><div>Match <b className="float-right text-foreground">{media.match_status ?? 'unknown'}</b></div></div>}
                    {section.id === 'analysis' && <div>{deepAnalysis ? `Average bitrate ${Math.round((deepAnalysis.avgBitrate || 0) / 1000)} kbps${deepAnalysis.peakBitrate ? ` · peak ${Math.round(deepAnalysis.peakBitrate / 1000)} kbps` : ''}` : 'Run Analyze to collect analysis details.'}</div>}
                  </div>}
                </div>
              ))}
            </div>


        </div>
      </div>
      </div>

      {showTranscodeModal && (
        <TranscodeModal 
          mediaId={mediaId} 
          onClose={() => setShowTranscodeModal(false)} 
        />
      )}
    </div>,
    document.body
  )
}

function formatChannels(ch: number) {
  if (ch >= 8) return '7.1'
  if (ch >= 6) return '5.1'
  if (ch >= 3) return '2.1'
  if (ch >= 2) return 'Stereo'
  return 'Mono'
}
