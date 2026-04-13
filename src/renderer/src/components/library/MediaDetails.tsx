import { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { 
  X, 
  Film, 
  RefreshCw, 
  Pencil, 
  Clock, 
  HardDrive, 
  Database,
  ExternalLink,
  EyeOff
} from 'lucide-react'
import { QualityBadges } from './QualityBadges'
import { ConversionRecommendation } from './ConversionRecommendation'
import { TranscodeModal } from './TranscodeModal'
import { useToast } from '../../contexts/ToastContext'
import { toSafeNumber, toSafeString } from '../../utils/typeSafety'
import { Zap } from 'lucide-react'
import type { MediaItem, MediaItemVersion } from '../../../../main/types/database'

interface MediaDetailsProps {
  mediaId: number
  onClose: () => void
  onRescan?: (mediaItemId: number, sourceId: string, libraryId: string | null, filePath: string) => Promise<void>
  onFixMatch?: (mediaItemId: number, title: string, year?: number, filePath?: string) => void
  onDismissUpgrade?: (mediaId: number, title: string) => void
}

export function MediaDetails({ mediaId, onClose, onRescan, onFixMatch, onDismissUpgrade }: MediaDetailsProps) {
  const [media, setMedia] = useState<MediaItem | null>(null)
  const [versions, setVersions] = useState<MediaItemVersion[]>([])
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [isRescanning, setIsRescanning] = useState(false)
  const [showTranscodeModal, setShowTranscodeModal] = useState(false)
  const { addToast } = useToast()

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const [item, itemVersions] = await Promise.all([
        window.electronAPI.getMediaItem(mediaId),
        window.electronAPI.getMediaItemVersions(mediaId)
      ])
      
      if (item) {
        setMedia(item as MediaItem)
        setVersions(itemVersions as MediaItemVersion[])
        
        // Default to best version
        const best = (itemVersions as MediaItemVersion[]).find(v => v.is_best) || (itemVersions as MediaItemVersion[])[0]
        if (best) setSelectedVersionId(best.id!)
      }
    } catch (err) {
      console.error('Failed to load media details:', err)
      addToast({ title: 'Failed to load details', type: 'error' })
    } finally {
      setLoading(false)
    }
  }, [mediaId, addToast])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleRescan = async () => {
    if (!media || !media.source_id || !media.file_path || !onRescan) return
    setIsRescanning(true)
    try {
      await onRescan(media.id!, media.source_id, media.library_id || null, media.file_path)
      await loadData()
      addToast({ title: 'Analysis updated', type: 'success' })
    } catch (err) {
      addToast({ title: 'Rescan failed', type: 'error' })
    } finally {
      setIsRescanning(false)
    }
  }

  const handleDismiss = () => {
    if (!media || !onDismissUpgrade) return
    onDismissUpgrade(media.id!, media.title)
    onClose()
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
  
  const formatDuration = (mins: number) => {
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return h > 0 ? `${h}h ${m}m` : `${m}m`
  }

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

  const getVideoThresholdRange = (tier: string) => {
    switch(tier) {
      case 'ULTRA_PREMIUM': return '60-100 Mbps'
      case 'PREMIUM': return '25-60 Mbps'
      case 'HIGH': return '12-25 Mbps'
      case 'MID': return '5-12 Mbps'
      case 'SD': return '1.5-5 Mbps'
      default: return 'N/A'
    }
  }

  const getAudioThresholdRange = (tier: string) => {
    switch(tier) {
      case 'ULTRA_PREMIUM': return '3000+ kbps'
      case 'PREMIUM': return '1500+ kbps'
      case 'HIGH': return '640+ kbps'
      case 'MID': return '384+ kbps'
      case 'SD': return '192+ kbps'
      default: return 'N/A'
    }
  }

  const LowIndicator = () => <span className="ml-1.5 text-[10px] font-bold text-orange-500 bg-orange-500/10 px-1 rounded">LOW</span>

  const isAudioBitrateRawLow = (br: number, tier: string) => {
    if (tier === 'ULTRA_PREMIUM') return br < 3000
    if (tier === 'PREMIUM') return br < 1500
    if (tier === 'HIGH') return br < 640
    return br < 384
  }

  const bestAudioBitrate = toSafeNumber(sv?.audio_bitrate ?? media.audio_bitrate)
  const videoWeight = 70

  return createPortal(
    <div className="fixed inset-0 z-200 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200" onClick={onClose}>
      <div 
        className="relative bg-card border border-border rounded-2xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col md:flex-row animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Left: Poster/Backdrop Area */}
        <div className="w-full md:w-[320px] shrink-0 bg-muted relative">
          <div className="aspect-2/3 w-full h-full relative group">
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

            {/* Quality Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-muted/30 border border-border/50 rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Overall Health</div>
                  <QualityBadges item={(sv || media) as any} />
                </div>
                
                <div className="flex gap-6">
                  {toSafeNumber(sv?.tier_score ?? media.tier_score) > 0 && (
                    <div className="flex-1">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-sm text-muted-foreground">Video</span>
                        <span className="text-sm font-medium tabular-nums">{toSafeNumber(sv?.bitrate_tier_score ?? media.bitrate_tier_score)}</span>
                        <span className="text-xs text-muted-foreground/60">· {videoWeight}%</span>
                      </div>
                      <div className="h-1 bg-muted rounded-full overflow-hidden mt-1">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${toSafeNumber(sv?.bitrate_tier_score ?? media.bitrate_tier_score)}%` }} />
                      </div>
                      <div className="text-sm text-muted-foreground mt-0.5">
                        {formatBitrate(toSafeNumber(sv?.video_bitrate ?? media.video_bitrate))} · Target: {getVideoThresholdRange(toSafeString(sv?.quality_tier ?? media.quality_tier))}
                      </div>
                    </div>
                  )}
                  {toSafeNumber(sv?.audio_tier_score ?? media.audio_tier_score) > 0 && (
                    <div className="flex-1">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-sm text-muted-foreground">Audio</span>
                        <span className="text-sm font-medium tabular-nums">{Math.min(toSafeNumber(sv?.audio_tier_score ?? media.audio_tier_score), 100)}</span>
                        <span className="text-xs text-muted-foreground/60">· {100 - videoWeight}%</span>
                      </div>
                      <div className="h-1 bg-muted rounded-full overflow-hidden mt-1">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(toSafeNumber(sv?.audio_tier_score ?? media.audio_tier_score), 100)}%` }} />
                      </div>
                      <div className="text-sm text-muted-foreground mt-0.5">
                        {formatBitrate(bestAudioBitrate)} · Target: {getAudioThresholdRange(toSafeString(sv?.quality_tier ?? media.quality_tier))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-muted/30 border border-border/50 rounded-2xl p-5 flex flex-col justify-between">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Storage Efficiency</div>
                  <div className={`text-xl font-black ${(sv?.efficiency_score ?? 0) >= 85 ? 'text-green-500' : (sv?.efficiency_score ?? 0) >= 60 ? 'text-yellow-500' : 'text-orange-500'}`}>
                    {toSafeNumber(sv?.efficiency_score ?? media.efficiency_score)}%
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted-foreground">Storage Debt</span>
                    <span className={`font-bold ${(sv?.storage_debt_bytes ?? 0) > 0 ? 'text-orange-500' : 'text-green-500'}`}>
                      {toSafeNumber(sv?.storage_debt_bytes ?? media.storage_debt_bytes) > 0 ? formatFileSize(toSafeNumber(sv?.storage_debt_bytes ?? media.storage_debt_bytes)) : 'None'}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground/70 leading-normal">
                    {toSafeNumber(sv?.storage_debt_bytes ?? media.storage_debt_bytes) > 0 
                      ? `Based on its quality, this file is ${formatFileSize(toSafeNumber(sv?.storage_debt_bytes ?? media.storage_debt_bytes))} larger than a perfectly optimized encode would be.`
                      : 'This file is perfectly optimized for its quality tier. No storage waste detected.'}
                  </p>
                </div>
              </div>
            </div>

            {/* Recommendations */}
            {(media.needs_upgrade || media.tier_quality === 'LOW' || (toSafeNumber(sv?.efficiency_score ?? media.efficiency_score) < 60)) && (
              <div className="animate-in slide-in-from-bottom-2 duration-300">
                <ConversionRecommendation item={(sv || media) as any} />
              </div>
            )}

            {/* Technical Specs */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4">
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground/70">
                  <Film className="w-3.5 h-3.5" />
                  Video Details
                </div>
                <div className="space-y-3 px-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Codec</span>
                    <span className="font-medium uppercase">{toSafeString(sv?.video_codec ?? media.video_codec)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Resolution</span>
                    <span className="font-medium">{toSafeString(sv?.resolution ?? media.resolution)}</span>
                  </div>
                  {toSafeNumber(sv?.video_bitrate ?? media.video_bitrate) > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Bitrate</span>
                      <span className="font-medium">{formatBitrate(toSafeNumber(sv?.video_bitrate ?? media.video_bitrate))}</span>
                    </div>
                  )}
                  {media.hdr_format && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">HDR</span>
                      <span className="font-medium text-primary">{media.hdr_format}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground/70">
                  <Clock className="w-3.5 h-3.5" />
                  Audio & Subs
                </div>
                <div className="space-y-3 px-1">
                  <div className="flex justify-between items-start">
                    <span className="text-muted-foreground">Audio</span>
                    <div className="text-sm text-right">
                      <div className="font-medium">{toSafeString(sv?.audio_codec ?? media.audio_codec).toUpperCase()} {formatChannels(toSafeNumber(sv?.audio_channels ?? media.audio_channels))}</div>
                      <div className="text-xs text-muted-foreground flex items-center justify-end">
                        <span>{formatBitrate(toSafeNumber(sv?.audio_bitrate ?? media.audio_bitrate))}</span>
                        {isAudioBitrateRawLow(toSafeNumber(sv?.audio_bitrate ?? media.audio_bitrate), toSafeString(sv?.quality_tier ?? media.quality_tier)) && <LowIndicator />}
                      </div>
                    </div>
                  </div>
                  {media.has_object_audio && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Object Audio</span>
                      <span className="font-bold text-blue-400 text-xs bg-blue-400/10 px-1.5 rounded">ATMOS / DTS:X</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* File Path Area */}
            <div className="pt-6 border-t border-border/10 space-y-3">
              <div className="flex justify-between items-center">
                <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Location & Identifiers</div>
                <div className="flex gap-2">
                  {media.tmdb_id && (
                    <a 
                      href={`https://www.themoviedb.org/${isMovie ? 'movie' : 'tv'}/${media.tmdb_id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
                    >
                      TMDB <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  )}
                </div>
              </div>
              <div className="bg-muted/20 p-3 rounded-xl border border-border/30 flex items-center gap-3 overflow-hidden group">
                <HardDrive className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="font-mono text-xs text-muted-foreground truncate flex-1 select-all" title={toSafeString(sv?.file_path ?? media.file_path)}>
                  {toSafeString(sv?.file_path ?? media.file_path)}
                </span>
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="p-6 bg-muted/10 border-t border-border/10 flex flex-wrap gap-3">
            <button 
              onClick={handleRescan}
              disabled={isRescanning}
              className="flex items-center gap-2 px-4 py-2 bg-muted hover:bg-muted/80 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
            >
              {isRescanning ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Full Rescan
            </button>

            {isMovie && (
              <button 
                onClick={() => setShowTranscodeModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary rounded-xl text-sm font-bold transition-all"
              >
                <Zap className="w-4 h-4" />
                Optimize...
              </button>
            )}

            {onFixMatch && (
              <button 
                onClick={() => onFixMatch(media.id!, media.title, media.year ?? undefined, media.file_path ?? undefined)}
                className="flex items-center gap-2 px-4 py-2 bg-muted hover:bg-muted/80 rounded-xl text-sm font-semibold transition-all"
              >
                <Pencil className="w-4 h-4" />
                Fix Match
              </button>
            )}
            <div className="flex-1" />
            {onDismissUpgrade && (media.needs_upgrade || media.tier_quality === 'LOW') && (
              <button 
                onClick={handleDismiss}
                className="flex items-center gap-2 px-4 py-2 bg-muted hover:bg-red-500/10 hover:text-red-500 rounded-xl text-sm font-semibold transition-all"
              >
                <EyeOff className="w-4 h-4" />
                Dismiss Upgrade
              </button>
            )}
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
