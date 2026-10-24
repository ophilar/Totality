import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { MoreVertical, RefreshCw, Pencil, EyeOff, X, Copy, Check, ChevronDown, Star } from 'lucide-react'
import { getQualityLevelColors } from '../../utils/qualityColors'
import { useTheme } from '../../contexts/ThemeContext'
import { formatBitrate } from './mediaUtils'
// DropdownMenu no longer used — desktop actions now use round icon buttons like mobile
import { Button } from '../ui/Button'
import { AddToWishlistButton } from '../wishlist/AddToWishlistButton'
import type { WishlistMediaType } from '../../contexts/WishlistContext'
// useMenuClose no longer needed — desktop uses individual icon buttons like mobile
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { EstimatedSavingsDisplay } from './EstimatedSavingsDisplay'
import { ConversionRecommendation } from './ConversionRecommendation'
import type { AudioTrack, SubtitleTrack } from '@main/types/database'

interface MediaDetailsProps {
  mediaId: number
  onClose: () => void
  onRescan?: (mediaId: number, sourceId: string, libraryId: string | null, filePath: string) => Promise<void>
  onFixMatch?: (mediaItemId: number, title: string, year?: number, filePath?: string) => void
  onDismissUpgrade?: (mediaId: number, title: string) => void
  isMobile?: boolean
}

interface MediaVersion {
  id: number
  media_item_id: number
  version_source: string
  edition?: string
  label?: string
  file_path: string
  file_size_bytes: number
  duration_ms: number
  resolution: string
  width: number
  height: number
  video_codec: string
  video_bitrate_kbps: number
  audio_codec: string
  audio_channels: number
  audio_bitrate_kbps: number
  video_frame_rate?: number
  color_bit_depth?: number
  hdr_format?: string
  video_profile?: string
  audio_profile?: string
  audio_sample_rate?: number
  has_object_audio?: boolean
  audio_tracks?: string
  subtitle_tracks?: string
  color_space?: string
  container?: string
  quality_tier?: string
  tier_quality?: string
  tier_score?: number | null
  bitrate_tier_score?: number | null
  audio_tier_score?: number | null
  is_best?: boolean
}

interface MediaWithQuality {
  id: number
  title: string
  year?: number
  type: 'movie' | 'episode'
  series_title?: string
  season_number?: number
  episode_number?: number
  source_id: string
  library_id?: string
  file_path: string
  file_size_bytes: number
  duration_ms: number
  resolution: string
  width: number
  height: number
  video_codec: string
  video_bitrate_kbps: number
  audio_codec: string
  audio_channels: number
  audio_bitrate_kbps: number
  imdb_id?: string
  tmdb_id?: string
  poster_url?: string
  episode_thumb_url?: string
  season_poster_url?: string
  summary?: string
  video_frame_rate?: number
  color_bit_depth?: number
  hdr_format?: string
  color_space?: string
  video_profile?: string
  video_level?: number
  audio_profile?: string
  audio_sample_rate?: number
  has_object_audio?: boolean
  container?: string
  audio_tracks?: string
  subtitle_tracks?: string
  version_count?: number
  quality_tier?: 'SD' | '720p' | '1080p' | '4K' | 'UNKNOWN'
  tier_quality?: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN'
  tier_score?: number | null
  bitrate_tier_score?: number | null
  audio_tier_score?: number | null
  evidence_status?: 'measured' | 'estimated' | 'insufficient' | null
  estimated_savings_bytes?: number | null
  savings_coverage?: 'complete' | 'partial' | 'insufficient'
  confidence?: string | null
  savings_basis?: string | null
  overall_score?: number | null
  needs_upgrade?: boolean
  issues?: string
  tmdb_rating?: number
  play_count?: number
  last_watched_at?: string
}

interface QualityThresholds {
  video: { medium: number; high: number }
  audio: { medium: number; high: number }
}

const DEFAULT_THRESHOLDS: Record<string, QualityThresholds> = {
  'SD': { video: { medium: 1500, high: 3500 }, audio: { medium: 128, high: 192 } },
  '720p': { video: { medium: 3000, high: 8000 }, audio: { medium: 192, high: 320 } },
  '1080p': { video: { medium: 6000, high: 15000 }, audio: { medium: 256, high: 640 } },
  '4K': { video: { medium: 15000, high: 40000 }, audio: { medium: 320, high: 1000 } },
}

function parseTrackMetadata<T>(raw: string | null | undefined, mediaItemId: number | undefined, field: string): T[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error('Expected an array')
    return parsed as T[]
  } catch (error) {
    console.error(`[MediaDetails] Invalid ${field} metadata for media item ${mediaItemId ?? 'unknown'}:`, error)
    return []
  }
}

export function MediaDetails({ mediaId, onClose, onRescan, onFixMatch, onDismissUpgrade, isMobile = false }: MediaDetailsProps) {
  const { effectiveIsDark } = useTheme()
  const [media, setMedia] = useState<MediaWithQuality | null>(null)
  const [versions, setVersions] = useState<MediaVersion[]>([])
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null)
  const [showVersionTable, setShowVersionTable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [thresholds, setThresholds] = useState<Record<string, QualityThresholds>>(DEFAULT_THRESHOLDS)
  const [showMenu, setShowMenu] = useState(false)
  const [isRescanning, setIsRescanning] = useState(false)
  const [copied, setCopied] = useState(false)
  const [backdropUrl, setBackdropUrl] = useState<string | null>(null)
  const audioTracks = useMemo(
    () => parseTrackMetadata<AudioTrack>(media?.audio_tracks, media?.id, 'audio_tracks'),
    [media?.audio_tracks, media?.id],
  )
  const subtitleTracks = useMemo(
    () => parseTrackMetadata<SubtitleTrack>(media?.subtitle_tracks, media?.id, 'subtitle_tracks'),
    [media?.subtitle_tracks, media?.id],
  )
  const sv = versions.find(version => version.id === selectedVersionId) || null
  const svAudioTracks = useMemo(
    () => sv ? parseTrackMetadata<AudioTrack>(sv.audio_tracks, sv.media_item_id, 'version audio_tracks') : audioTracks,
    [sv, audioTracks],
  )
  const svSubtitleTracks = useMemo(
    () => sv ? parseTrackMetadata<SubtitleTrack>(sv.subtitle_tracks, sv.media_item_id, 'version subtitle_tracks') : subtitleTracks,
    [sv, subtitleTracks],
  )
  const menuRef = useMenuClose({ isOpen: showMenu, onClose: useCallback(() => setShowMenu(false), []) })

  const handleRescan = async () => {
    if (!media || !onRescan) return
    setIsRescanning(true)
    try {
      await onRescan(media.id, media.source_id, media.library_id || null, media.file_path)
    } finally {
      setIsRescanning(false)
    }
  }

  const handleFixMatch = () => {
    if (!media || !onFixMatch) return

    onFixMatch(media.id, media.title, media.year, media.file_path)
  }

  const handleDismissUpgrade = () => {
    if (!media || !onDismissUpgrade) return

    const title = media.type === 'episode' && media.series_title
      ? `${media.series_title} S${media.season_number}E${media.episode_number}`
      : media.title
    onDismissUpgrade(media.id, title)
    // Update local state so UI reflects immediately
    setMedia(prev => prev ? { ...prev, needs_upgrade: false, tier_quality: 'UNKNOWN' } : prev)
  }

  useEffect(() => {
    loadMediaDetails()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaId])

  // Focus trap — must be before any conditional returns (Rules of Hooks)
  const modalRef = useRef<HTMLDivElement>(null)
  useFocusTrap(true, modalRef)

  const loadMediaDetails = async () => {
    try {
      setLoading(true)
      setError(null)

      // Load quality settings
      const allSettings = await window.electronAPI.getAllSettings()
      const loadedThresholds: Record<string, QualityThresholds> = { ...DEFAULT_THRESHOLDS }

      const tiers = ['sd', '720p', '1080p', '4k']
      const tierKeys: Record<string, string> = { 'sd': 'SD', '720p': '720p', '1080p': '1080p', '4k': '4K' }

      for (const tier of tiers) {
        const key = tierKeys[tier]
        const audioMedium = allSettings[`quality_audio_${tier}_medium`]
        const audioHigh = allSettings[`quality_audio_${tier}_high`]

        loadedThresholds[key] = {
          video: DEFAULT_THRESHOLDS[key].video,
          audio: {
            medium: audioMedium ? parseFloat(audioMedium) : DEFAULT_THRESHOLDS[key].audio.medium,
            high: audioHigh ? parseFloat(audioHigh) : DEFAULT_THRESHOLDS[key].audio.high,
          },
        }
      }
      setThresholds(loadedThresholds)

      const item = await window.electronAPI.getMediaItemById(mediaId) as MediaWithQuality | null
      if (!item) {
        setError('Media item not found')
        return
      }

      const qualityScore = await window.electronAPI.getQualityScoreByMediaId(mediaId) as {
        quality_tier?: 'SD' | '720p' | '1080p' | '4K' | 'UNKNOWN'
        tier_quality?: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN'
        tier_score?: number | null
        bitrate_tier_score?: number | null
        audio_tier_score?: number | null
        evidence_status?: 'measured' | 'estimated' | 'insufficient' | null
        estimated_savings_bytes?: number | null
        confidence?: string | null
        savings_basis?: string | null
        overall_score?: number | null
        needs_upgrade?: boolean
        issues?: string
      } | null

      const mediaWithQuality: MediaWithQuality = {
        ...item,
        quality_tier: qualityScore?.quality_tier,
        tier_quality: qualityScore?.tier_quality,
        tier_score: qualityScore?.tier_score,
        bitrate_tier_score: qualityScore?.bitrate_tier_score,
        audio_tier_score: qualityScore?.audio_tier_score,
        evidence_status: qualityScore?.evidence_status,
        estimated_savings_bytes: qualityScore?.estimated_savings_bytes,
        confidence: qualityScore?.confidence,
        savings_basis: qualityScore?.savings_basis,
        overall_score: qualityScore?.overall_score,
        needs_upgrade: qualityScore?.needs_upgrade,
        issues: qualityScore?.issues
      }
      setMedia(mediaWithQuality)

      // Use Plex art_url (wide backdrop) if available, otherwise fetch from TMDB
      if ((item as { art_url?: string }).art_url) {
        setBackdropUrl((item as { art_url?: string }).art_url!)
      } else if (item.tmdb_id) {
        try {
          const tmdbDetails = item.type === 'episode'
            ? await window.electronAPI.tmdbGetTVShowDetails((item as unknown as { series_tmdb_id?: string }).series_tmdb_id || item.tmdb_id) as { backdropPath?: string } | null
            : await window.electronAPI.tmdbGetMovieDetails(item.tmdb_id) as { backdropPath?: string } | null
          if (tmdbDetails?.backdropPath) {
            setBackdropUrl(`https://image.tmdb.org/t/p/w780${tmdbDetails.backdropPath}`)
          }
        } catch {
          // Non-critical: poster will be used as fallback
        }
      }

      // Fetch versions if there are multiple
      if (item.version_count && item.version_count > 1) {
        try {
          const versionData = await window.electronAPI.getMediaItemVersions(mediaId) as MediaVersion[]
          setVersions(versionData || [])
          // Auto-select the best version
          const best = versionData?.find(v => v.is_best) || versionData?.[0]
          if (best) setSelectedVersionId(best.id)
        } catch {
          // Non-critical: versions just won't show
        }
      }
    } catch (err) {
      console.error('Error loading media details:', err)
      setError('Failed to load media details')
    } finally {
      setLoading(false)
    }
  }

  const formatFileSize = (bytes: number): string => {
    const gb = bytes / (1024 * 1024 * 1024)
    return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / (1024 * 1024)).toFixed(0)} MB`
  }

  const formatDuration = (milliseconds: number): string => {
    const totalSeconds = Math.floor(milliseconds / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
  }

  const formatChannels = (channels: number): string => {
    if (channels > 2) return `${channels - 1}.1`
    return `${channels}.0`
  }

  const isAudioBitrateLow = (track: AudioTrack, tier?: string): boolean => {
    // Commentary tracks — don't flag
    if (isCommentary(track)) return false

    // Lossless / object audio — bitrate doesn't matter
    if (track.hasObjectAudio) return false
    const c = (track.codec || '').toLowerCase()
    if (c.includes('truehd') || c.includes('flac') || c.includes('pcm') || c.includes('lpcm') ||
        c.includes('alac') || c.includes('dts-hd ma') || c.includes('dtshd_ma')) return false

    // No bitrate reported — can't determine
    if (!track.bitrate || track.bitrate <= 0) return false

    const t = thresholds[tier || 'SD'] || DEFAULT_THRESHOLDS['SD']

    // Stereo (1-2 channels) — use half the surround threshold
    if (track.channels <= 2) {
      return track.bitrate < Math.round(t.audio.medium / 2)
    }

    // Surround — use full threshold
    return track.bitrate < t.audio.medium
  }

  const isAudioBitrateRawLow = (bitrate: number, tier?: string): boolean => {
    const t = thresholds[tier || 'SD'] || DEFAULT_THRESHOLDS['SD']
    return bitrate < t.audio.medium
  }

  const LowIndicator = () => (
    <span className="inline-block w-2 h-2 rounded-full bg-destructive ml-1.5" title="Below quality threshold" />
  )

  const getTrackDiagnostic = (track: AudioTrack, tier?: string): { message: string; severity: 'error' | 'warning' } | null => {
    if (isCommentary(track)) return null
    if (track.hasObjectAudio) return null
    const c = (track.codec || '').toLowerCase()
    const isLossless = c.includes('truehd') || c.includes('flac') || c.includes('pcm') || c.includes('lpcm') ||
      c.includes('alac') || c.includes('dts-hd ma') || c.includes('dtshd_ma')
    if (isLossless) return null
    if (!track.bitrate || track.bitrate <= 0) return null

    const channels = track.channels || 2
    const minExpected = channels * 32

    if (track.bitrate < minExpected) {
      return { message: `Possibly corrupt — bitrate too low for ${channels >= 6 ? 'surround' : 'stereo'}`, severity: 'error' }
    }

    const t = thresholds[tier || 'SD'] || DEFAULT_THRESHOLDS['SD']
    const threshold = channels <= 2 ? Math.round(t.audio.medium / 2) : t.audio.medium
    if (track.bitrate < threshold) {
      return { message: `Below ${tier || 'SD'} target (${threshold} kbps)`, severity: 'warning' }
    }

    return null
  }

  // Parse quality issues and return abbreviated badge labels
  const tierRank = (tier?: string): number => {
    switch (tier) {
      case '4K': return 4
      case '1080p': return 3
      case '720p': return 2
      default: return 0
    }
  }

  const getVersionInsight = (v: MediaVersion): { type: 'redundant'; label: string; color: string } | null => {
    if (v.is_best || versions.length < 2) return null
    const best = versions.find(ver => ver.is_best)
    if (!best) return null

    // Redundant: same edition name and best version is same or higher tier
    const sameEdition = (v.edition || '') === (best.edition || '') && v.edition !== undefined
    if (sameEdition && best.quality_tier && v.quality_tier && tierRank(best.quality_tier) >= tierRank(v.quality_tier)) {
      return { type: 'redundant', label: 'Possible redundant', color: 'bg-amber-500/20 text-amber-400' }
    }

    return null
  }

  const isCommentary = (track: AudioTrack): boolean => {
    if (!track.title) return false
    return track.title.toLowerCase().includes('commentary')
  }

  if (loading) {
    return createPortal(
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-150">
        <div className="bg-card rounded-xl p-8 shadow-2xl">
          <div className="text-muted-foreground">Loading...</div>
        </div>
      </div>,
      document.body
    )
  }

  if (error || !media) {
    return createPortal(
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-150">
        <div className="bg-card rounded-xl p-8 shadow-2xl text-center">
          <div className="text-destructive mb-4">{error || 'Media not found'}</div>
          <Button onClick={onClose} size="sm">
            Close
          </Button>
        </div>
      </div>,
      document.body
    )
  }

  const displayTitle = media.type === 'episode' && media.series_title ? media.series_title : media.title
  const tierScore = sv?.tier_score ?? media.tier_score

  // Selected version derived data
  return createPortal(
    <div
      className={`fixed inset-0 bg-black/60 backdrop-blur-sm flex justify-center z-50 transition-opacity duration-300 ${
        isMobile ? 'items-end' : 'items-center p-6'
      } ${isClosing ? 'opacity-0' : ''}`}
      role="dialog"
      aria-modal="true"
      onClick={handleClose}
    >
      <div
        ref={modalRef}
        className={`bg-card overflow-hidden flex flex-col shadow-2xl relative ${
          isMobile
            ? `w-full max-h-[90vh] rounded-t-[2rem] border border-border border-b-0 ${isClosing ? 'animate-slide-down' : 'animate-slide-up'}`
            : 'rounded-xl w-full max-w-4xl max-h-[calc(100vh-48px)] border border-border'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Desktop: full-modal blur wash backdrop */}
        {!isMobile && (() => {
          const heroSrc = media.type === 'episode'
            ? (media.episode_thumb_url || backdropUrl || media.poster_url)
            : (backdropUrl || media.poster_url)
          return heroSrc ? (
            <div
              data-desktop-wash
              className="absolute pointer-events-none animate-[fade-in_1s_ease-out_forwards]"
              style={{
                inset: '-100px',
                backgroundImage: `url(${heroSrc})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                filter: effectiveIsDark ? 'blur(80px) brightness(0.3)' : 'blur(80px) saturate(0.6)',
                opacity: effectiveIsDark ? 0.5 : 0.35,
              }}
            />
          ) : null
        })()}

        {/* Desktop: close button — fixed on modal */}
        {!isMobile && (
          <button
            onClick={onClose}
            className="absolute top-3 right-3 z-20 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full bg-black/40 backdrop-blur-sm text-white/80 hover:bg-black/60 hover:text-white transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        )}

        {/* Scrollable Content — unified layout, no header/body split */}
        <div
          className={`flex-1 overflow-y-auto relative ${isMobile ? '' : 'px-5 pt-5 pb-4'} space-y-6`}
          style={isMobile ? { overscrollBehavior: 'none', WebkitOverflowScrolling: 'auto' } : undefined}
          onScroll={(e) => {
            if (!isMobile) {
              // Desktop: subtle parallax on blur wash
              const wash = e.currentTarget.parentElement?.querySelector('[data-desktop-wash]') as HTMLElement
              if (wash) wash.style.transform = `translateY(${e.currentTarget.scrollTop * 0.1}px)`
              return
            }
            const scrollTop = e.currentTarget.scrollTop
            const heroImg = e.currentTarget.querySelector('[data-hero-img]') as HTMLElement
            if (heroImg) heroImg.style.transform = `translateY(${scrollTop * 0.3}px)`
            const fadeEl = e.currentTarget.querySelector('[data-fade-content]') as HTMLElement
            if (fadeEl) fadeEl.style.opacity = `${Math.max(0, 1 - scrollTop / 150)}`
            // Show/hide blur scrim behind sticky header + dissolve title format
            const scrim = e.currentTarget.querySelector('[data-sticky-scrim]') as HTMLElement
            const heroH = e.currentTarget.querySelector('[data-hero-wrap]')?.clientHeight || 0
            const isStuck = scrollTop > Math.max(0, heroH - 60)
            if (scrim) {
              const progress = Math.min(1, Math.max(0, (scrollTop - (heroH - 120)) / 80))
              scrim.style.opacity = `${progress}`
            }
            // Scroll-driven title transition — interpolate through transition zone
            const transitionStart = Math.max(0, heroH - 120)
            const transitionEnd = Math.max(0, heroH - 40)
            const t = transitionEnd > transitionStart
              ? Math.min(1, Math.max(0, (scrollTop - transitionStart) / (transitionEnd - transitionStart)))
              : (isStuck ? 1 : 0)
            // Ease out cubic for smooth deceleration into final position
            const eased = 1 - Math.pow(1 - t, 3)

            // Episodes: dissolve crossfade + height collapse driven by scroll
            const titleFull = e.currentTarget.querySelector('[data-title-full]') as HTMLElement
            const titleCompact = e.currentTarget.querySelector('[data-title-compact]') as HTMLElement
            if (titleFull && titleCompact) {
              titleFull.style.opacity = `${1 - eased}`
              titleFull.style.pointerEvents = eased > 0.5 ? 'none' : ''
              titleCompact.style.opacity = `${eased}`
              titleCompact.style.pointerEvents = eased > 0.5 ? '' : 'none'
              // Collapse full title height so actions move up to match movie layout
              const compactH = titleCompact.scrollHeight
              const fullH = titleFull.scrollHeight
              titleFull.style.maxHeight = `${fullH - eased * (fullH - compactH)}px`
              titleFull.style.overflow = 'hidden'
            }
            // Non-episodes: font-size interpolation driven by scroll
            const titleScale = e.currentTarget.querySelector('[data-title-scale] h2') as HTMLElement
            if (titleScale) {
              titleScale.style.fontSize = `${24 - eased * 7}px`
            }
          }}
        >
          {/* Desktop header — artwork + title + stats inside scroll */}
          {!isMobile && (
            <div className="flex gap-5 pr-12 relative z-[1]">
              {/* Poster / Episode thumb */}
              {(() => {
                const thumbSrc = media.type === 'episode'
                  ? (media.episode_thumb_url || backdropUrl || media.poster_url)
                  : media.poster_url
                return thumbSrc ? (
                  <div className={`shrink-0 rounded-lg overflow-hidden shadow-lg shadow-black/30 ${media.type === 'episode' ? 'w-48 aspect-video' : 'w-36 aspect-[2/3]'}`}>
                    <img src={thumbSrc} alt={displayTitle} className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none' }} />
                  </div>
                ) : null
              })()}
              <div className="flex-1 min-w-0">
                <h2 className="text-h3 font-semibold leading-tight tracking-tight">{displayTitle}</h2>
                {media.type === 'episode' && (
                  <p className="text-label text-muted-foreground mt-1 font-medium">S{media.season_number}E{media.episode_number} · {media.title}</p>
                )}
                {(sv?.edition || (versions.length === 1 && versions[0]?.edition)) && (
                  <p className="text-label text-muted-foreground font-medium">{sv?.edition || versions[0]?.edition}</p>
                )}
              </div>
            </div>

            {/* Metadata + actions — seamless with card background */}
            <div className="px-4 pt-2 pb-3">
              {/* Stats row */}
              <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                {media.year && <span>{media.year}</span>}
                {(sv?.duration_ms ?? media.duration_ms) > 0 && <><span className="mx-0.5">·</span><span>{formatDuration(sv?.duration_ms ?? media.duration_ms)}</span></>}
                {(sv?.file_size_bytes ?? media.file_size_bytes) > 0 && <><span className="mx-0.5">·</span><span>{formatFileSize(sv?.file_size_bytes ?? media.file_size_bytes)}</span></>}
                {media.tmdb_rating != null && media.tmdb_rating > 0 && (
                  <><span className="mx-0.5">·</span><span>★ {media.tmdb_rating.toFixed(1)}</span></>
                )}
                {(media.play_count ?? 0) > 0 && (
                  <><span className="mx-0.5">·</span><span>Played {media.play_count}×</span></>
                )}
              </div>

              {/* Action buttons — round icon buttons */}
              <div className="flex items-center gap-3 mt-3">
                {media.tier_quality && media.tier_quality !== 'HIGH' && media.tier_quality !== 'UNKNOWN' && (
                  <AddToWishlistButton
                    mediaType={media.type as WishlistMediaType}
                    title={media.title}
                    year={media.year}
                    tmdbId={media.tmdb_id}
                    imdbId={media.imdb_id}
                    seriesTitle={media.series_title}
                    seasonNumber={media.season_number}
                    episodeNumber={media.episode_number}
                    posterUrl={media.poster_url}
                    reason="upgrade"
                    mediaItemId={media.id}
                    currentQualityTier={media.quality_tier}
                    currentQualityLevel={media.tier_quality}
                    currentResolution={media.resolution}
                    currentVideoCodec={media.video_codec}
                    currentAudioCodec={media.audio_codec}
                  />
                )}

                {onRescan && media.file_path && (
                  <button
                    onClick={handleRescan}
                    disabled={isRescanning}
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full bg-white/10 text-muted-foreground hover:bg-white/20 hover:text-foreground transition-colors"
                    title="Rescan File"
                  >
                    <RefreshCw className={`w-5 h-5 ${isRescanning ? 'animate-spin' : ''}`} />
                  </button>
                )}

                {onFixMatch && media.type === 'movie' && (
                  <button
                    onClick={handleFixMatch}
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full bg-white/10 text-muted-foreground hover:bg-white/20 hover:text-foreground transition-colors"
                    title="Fix Match"
                  >
                    <Pencil className="w-5 h-5" />
                  </button>
                )}

                {onDismissUpgrade && media.tier_quality !== 'HIGH' && media.tier_quality !== 'UNKNOWN' && (
                  <button
                    onClick={handleDismissUpgrade}
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full bg-white/10 text-muted-foreground hover:bg-white/20 hover:text-foreground transition-colors"
                    title="Dismiss Upgrade"
                  >
                    <EyeOff className="w-5 h-5" />
                  </button>
                )}
              </div>

              {/* Summary */}
              {media.summary && (
                <p className="mt-3 text-sm text-muted-foreground leading-relaxed line-clamp-3">{media.summary}</p>
              )}
            </div>
          </div>
        ) : (
          // ── Desktop: side-by-side poster + info ──
          <div className="p-4 border-b border-border/30 bg-sidebar-gradient rounded-t-xl shrink-0">
            <div className="flex gap-4">
              {(media.poster_url || media.episode_thumb_url) && (
                <img
                  src={media.type === 'episode' && media.episode_thumb_url ? media.episode_thumb_url : media.poster_url}
                  alt=""
                  className={`rounded-lg object-cover shrink-0 shadow-lg shadow-black/30 ${
                    media.type === 'episode' && media.episode_thumb_url ? 'w-44 h-28' : 'w-24 h-36'
                  }`}
                  onError={(e) => { e.currentTarget.style.display = 'none' }}
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <h2 className="text-xl font-medium truncate">{displayTitle}</h2>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          navigator.clipboard.writeText(displayTitle)
                          setCopied(true)
                          setTimeout(() => setCopied(false), 1500)
                        }}
                        className="shrink-0 p-1 text-muted-foreground hover:text-foreground transition-colors"
                        title="Copy title"
                      >
                        {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    {media.type === 'episode' && (
                      <p className="text-sm text-muted-foreground">S{media.season_number}E{media.episode_number} · {media.title}</p>
                    )}
                    {(sv?.edition || (versions.length === 1 && versions[0]?.edition)) && (
                      <p className="text-sm text-muted-foreground">{sv?.edition || versions[0]?.edition}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                {media.tier_quality && media.tier_quality !== 'HIGH' && media.tier_quality !== 'UNKNOWN' && (
                      <AddToWishlistButton
                        mediaType={media.type as WishlistMediaType}
                        title={media.title}
                        year={media.year}
                        tmdbId={media.tmdb_id}
                        imdbId={media.imdb_id}
                        seriesTitle={media.series_title}
                        seasonNumber={media.season_number}
                        episodeNumber={media.episode_number}
                        posterUrl={media.poster_url}
                        reason="upgrade"
                        mediaItemId={media.id}
                        currentQualityTier={media.quality_tier}
                        currentQualityLevel={media.tier_quality}
                        currentResolution={media.resolution}
                        currentVideoCodec={media.video_codec}
                        currentAudioCodec={media.audio_codec}
                      />
                    )}
                    {(onRescan || onFixMatch || (onDismissUpgrade && media.tier_quality !== 'HIGH' && media.tier_quality !== 'UNKNOWN')) && (
                      <div ref={menuRef} className="relative">
                        <button onClick={() => setShowMenu(!showMenu)} className="text-muted-foreground hover:text-foreground p-1.5" title="More options">
                          {isRescanning ? <RefreshCw className="w-5 h-5 animate-spin" /> : <MoreVertical className="w-5 h-5" />}
                        </button>
                        {showMenu && !isRescanning && (
                          <DropdownMenu className="min-w-[140px] z-50">
                            {onRescan && media.file_path && <DropdownMenuItem onClick={handleRescan} icon={<RefreshCw className="w-3.5 h-3.5" />}>Rescan File</DropdownMenuItem>}
                            {onFixMatch && media.type === 'movie' && <DropdownMenuItem onClick={handleFixMatch} icon={<Pencil className="w-3.5 h-3.5" />}>Fix Match</DropdownMenuItem>}
                            {onDismissUpgrade && media.tier_quality !== 'HIGH' && media.tier_quality !== 'UNKNOWN' && <DropdownMenuItem onClick={handleDismissUpgrade} icon={<EyeOff className="w-3.5 h-3.5" />}>Dismiss Upgrade</DropdownMenuItem>}
                          </DropdownMenu>
                        )}
                      </div>
                    )}
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1"><X className="w-5 h-5" /></button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mt-2 text-sm text-muted-foreground">
                  {media.year && <span>{media.year}</span>}
                  {(sv?.duration_ms ?? media.duration_ms) > 0 && <><span className="mx-0.5">·</span><span>{formatDuration(sv?.duration_ms ?? media.duration_ms)}</span></>}
                  {(sv?.file_size_bytes ?? media.file_size_bytes) > 0 && <><span className="mx-0.5">·</span><span>{formatFileSize(sv?.file_size_bytes ?? media.file_size_bytes)}</span></>}
                  {(sv?.container ?? media.container) && <><span className="mx-0.5">·</span><span className="uppercase">{sv?.container ?? media.container}</span></>}
                  {media.tmdb_rating != null && media.tmdb_rating > 0 && (
                    <><span className="mx-0.5">·</span><span title="TMDB Rating">★ {media.tmdb_rating.toFixed(1)}</span></>
                  )}
                  {(media.play_count ?? 0) > 0 && (
                    <><span className="mx-0.5">·</span><span>{media.play_count === 1 ? 'Watched once' : `Watched ${media.play_count}×`}</span></>
                  )}
                  {media.last_watched_at && (
                    <><span className="mx-0.5">·</span><span title={new Date(media.last_watched_at).toLocaleString()}>Last watched {new Date(media.last_watched_at).toLocaleDateString()}</span></>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-3">
                  {media.tier_quality && media.tier_quality !== 'HIGH' && (
                    <AddToWishlistButton
                      mediaType={media.type as WishlistMediaType}
                      title={media.title}
                      year={media.year}
                      tmdbId={media.tmdb_id}
                      imdbId={media.imdb_id}
                      seriesTitle={media.series_title}
                      seasonNumber={media.season_number}
                      episodeNumber={media.episode_number}
                      posterUrl={media.poster_url}
                      reason="upgrade"
                      mediaItemId={media.id}
                      currentQualityTier={media.quality_tier}
                      currentQualityLevel={media.tier_quality}
                      currentResolution={media.resolution}
                      currentVideoCodec={media.video_codec}
                      currentAudioCodec={media.audio_codec}
                    />
                  )}
                  {onRescan && media.file_path && (
                    <button onClick={handleRescan} disabled={isRescanning} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors" title="Rescan file">
                      <RefreshCw className={`w-5 h-5 ${isRescanning ? 'animate-spin' : ''}`} />
                    </button>
                  )}
                  {onFixMatch && media.type === 'movie' && (
                    <button onClick={handleFixMatch} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors" title="Fix match">
                      <Pencil className="w-5 h-5" />
                    </button>
                  )}
                  {onDismissUpgrade && media.tier_quality !== 'HIGH' && (
                    <button onClick={() => { if (window.confirm(`Remove "${displayTitle}" from upgrade recommendations?`)) handleDismissUpgrade() }} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors" title="Dismiss upgrade">
                      <EyeOff className="w-5 h-5" />
                    </button>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(displayTitle); setCopied(true); setTimeout(() => setCopied(false), 1500) }} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors" title="Copy title">
                    {copied ? <Check className="w-5 h-5 text-foreground" /> : <Copy className="w-5 h-5" />}
                  </button>
                </div>
              </div>
            </div>
          )}

            {/* Summary */}
            {media.summary && (
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed max-h-20 overflow-y-auto">{media.summary}</p>
            )}

          {/* Version Selector Pills */}
          {versions.length > 1 && (
            <div className="mt-2 space-y-2">
                <div className="flex gap-1.5 overflow-x-auto">
                  {versions.map((v) => {
                    const isSelected = selectedVersionId === v.id
                    const qualityColor = getQualityLevelColors(v.tier_quality || '')
                    return (
                      <button
                        key={v.id}
                        onClick={() => setSelectedVersionId(v.id)}
                        className={`shrink-0 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                          isSelected
                            ? 'bg-primary text-primary-foreground'
                            : `${qualityColor || 'bg-muted/50'} text-muted-foreground hover:text-foreground hover:bg-muted`
                        }`}
                      >
                        {v.is_best && <Star className="w-3 h-3 inline-block mr-1 -mt-0.5" />}
                        {v.edition || v.label || `${v.resolution} ${v.video_codec}`}
                      </button>
                    )
                  })}
                </div>
              </div>

                {/* Version Comparison Table */}
                <button
                  onClick={() => setShowVersionTable(prev => !prev)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronDown className={`w-3 h-3 transition-transform ${showVersionTable ? '' : '-rotate-90'}`} />
                  Compare Versions ({versions.length})
                </button>
                {showVersionTable && (
                  <div className={`rounded-md border border-border/50 overflow-hidden text-xs ${isMobile ? 'overflow-x-auto' : ''}`}>
                    <table className={`${isMobile ? 'min-w-[500px]' : ''} w-full`}>
                      <thead>
                        <tr className="bg-muted/40 text-muted-foreground">
                          <th className="px-2 py-1.5 text-left font-medium">Version</th>
                          <th className="px-2 py-1.5 text-left font-medium">Quality</th>
                          <th className="px-2 py-1.5 text-left font-medium">Video</th>
                          <th className="px-2 py-1.5 text-left font-medium">Audio</th>
                          <th className="px-2 py-1.5 text-right font-medium">Size</th>
                          <th className="px-2 py-1.5 text-right font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {versions.map((v) => {
                          const insight = getVersionInsight(v)
                          const isSelected = selectedVersionId === v.id
                          return (
                            <tr
                              key={v.id}
                              onClick={() => setSelectedVersionId(v.id)}
                              className={`cursor-pointer border-t border-border/30 transition-colors hover:bg-muted/30 ${
                                isSelected ? 'bg-primary/10' : ''
                              }`}
                            >
                              <td className="px-2 py-1.5">
                                <div className="flex items-center gap-1">
                                  {v.is_best && <Star className="w-3 h-3 text-primary shrink-0" />}
                                  <span className="font-medium truncate max-w-[120px]">{v.edition || v.label || v.resolution}</span>
                                </div>
                              </td>
                              <td className="px-2 py-1.5 text-muted-foreground">
                                {v.quality_tier === 'UNKNOWN' ? 'Unknown' : v.quality_tier || '--'}
                              </td>
                              <td className="px-2 py-1.5 text-muted-foreground">
                                <span className="font-mono">{v.video_codec}</span> {formatBitrate(v.video_bitrate_kbps)}
                              </td>
                              <td className="px-2 py-1.5 text-muted-foreground">
                                <span className="font-mono">{v.audio_codec}</span> {v.audio_channels > 0 ? `${v.audio_channels}ch` : ''}
                              </td>
                              <td className="px-2 py-1.5 text-right text-muted-foreground">{formatFileSize(v.file_size_bytes)}</td>
                              <td className="px-2 py-1.5 text-right">
                                {v.is_best ? (
                                  <span className="text-primary font-medium">Best</span>
                                ) : insight ? (
                                  <span className={insight.type === 'redundant' ? 'text-amber-500' : 'text-yellow-500'}>
                                    {insight.label}
                                  </span>
                                ) : null}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Action buttons — below title, scroll as unit */}
                <div className="flex items-center gap-3 mt-2">
                  {media.tier_quality && media.tier_quality !== 'HIGH' && (
                    <div className="rounded-full bg-white/10 hover:bg-white/20 transition-colors">
                    <AddToWishlistButton
                      compact
                      mediaType={media.type as WishlistMediaType}
                      title={media.title}
                      year={media.year}
                      tmdbId={media.tmdb_id}
                      imdbId={media.imdb_id}
                      seriesTitle={media.series_title}
                      seasonNumber={media.season_number}
                      episodeNumber={media.episode_number}
                      posterUrl={media.poster_url}
                      reason="upgrade"
                      mediaItemId={media.id}
                      currentQualityTier={media.quality_tier}
                      currentQualityLevel={media.tier_quality}
                      currentResolution={media.resolution}
                      currentVideoCodec={media.video_codec}
                      currentAudioCodec={media.audio_codec}
                    />
                    </div>
                  )}
                  {onRescan && media.file_path && (
                    <button onClick={handleRescan} disabled={isRescanning} className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full bg-white/10 text-muted-foreground hover:bg-white/20 hover:text-foreground transition-colors" title="Rescan File">
                      <RefreshCw className={`w-5 h-5 ${isRescanning ? 'animate-spin' : ''}`} />
                    </button>
                  )}
                  {onFixMatch && media.type === 'movie' && (
                    <button onClick={handleFixMatch} className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full bg-white/10 text-muted-foreground hover:bg-white/20 hover:text-foreground transition-colors" title="Fix Match">
                      <Pencil className="w-5 h-5" />
                    </button>
                  )}
                  {onDismissUpgrade && media.tier_quality !== 'HIGH' && (
                    <button onClick={() => { if (window.confirm(`Remove "${displayTitle}" from upgrade recommendations?`)) handleDismissUpgrade() }} className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full bg-white/10 text-muted-foreground hover:bg-white/20 hover:text-foreground transition-colors" title="Dismiss Upgrade">
                      <EyeOff className="w-5 h-5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Stats + summary — scroll away normally */}
              <div data-fade-content className="px-4 pt-1 pb-3 will-change-[opacity]">
                <div className="flex flex-wrap items-center gap-1.5 text-label text-muted-foreground">
                  {media.year && <span>{media.year}</span>}
                  {(sv?.duration ?? media.duration) > 0 && <><span className="mx-0.5">·</span><span>{formatDuration(sv?.duration ?? media.duration)}</span></>}
                  {(sv?.file_size ?? media.file_size) > 0 && <><span className="mx-0.5">·</span><span>{formatFileSize(sv?.file_size ?? media.file_size)}</span></>}
                  {media.tmdb_rating != null && media.tmdb_rating > 0 && (
                    <><span className="mx-0.5">·</span><span>★ {media.tmdb_rating.toFixed(1)}</span></>
                  )}
                  {(media.play_count ?? 0) > 0 && (
                    <><span className="mx-0.5">·</span><span>{media.play_count === 1 ? 'Watched once' : `Watched ${media.play_count}×`}</span></>
                  )}
                </div>
                {media.summary && (
                  <p className="mt-3 text-label text-muted-foreground leading-relaxed line-clamp-3">{media.summary}</p>
                )}
              </div>
            </>
          )}

          {/* Detail content (padding only needed here for mobile since header has its own) */}
          <div className={isMobile ? 'p-3 space-y-6' : 'space-y-6'}>

          {/* Summary — below header, in scrollable area */}
          {!isMobile && media.summary && (
            <p className="text-label text-muted-foreground leading-relaxed line-clamp-2">{media.summary}</p>
          )}

          {/* Version Selector Pills — content, not chrome */}
          {versions.length > 1 && (
            <div className="space-y-2">
              <div className="flex gap-2 overflow-x-auto">
                {versions.map((v) => {
                  const isSelected = selectedVersionId === v.id
                  const qualityColor = getQualityLevelColors(v.tier_quality || '')
                  return (
                    <button
                      key={v.id}
                      onClick={() => setSelectedVersionId(v.id)}
                      className={`shrink-0 px-3 py-1.5 text-caption font-medium rounded-lg transition-colors ${
                        isSelected
                          ? 'bg-foreground text-background'
                          : `${qualityColor || 'bg-muted/50'} text-muted-foreground hover:text-foreground hover:bg-muted`
                      }`}
                    >
                      {v.is_best && <Star className="w-3 h-3 inline-block mr-1 -mt-0.5" />}
                      {v.edition || v.label || `${v.resolution} ${v.video_codec}`}
                      {v.tier_score != null && <span className={`ml-1.5 ${isSelected ? 'text-background/70' : 'opacity-70'}`}>· {v.tier_score}</span>}
                    </button>
                  )
                })}
              </div>

              {/* Version Comparison Table */}
              <button
                onClick={() => setShowVersionTable(prev => !prev)}
                className="flex items-center gap-1 text-caption text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronDown className={`w-3 h-3 transition-transform ${showVersionTable ? '' : '-rotate-90'}`} />
                Compare Versions ({versions.length})
              </button>
              {showVersionTable && (
                <div className={`rounded-lg border border-border/50 overflow-hidden text-caption ${isMobile ? 'overflow-x-auto' : ''}`}>
                  <table className={`${isMobile ? 'min-w-[500px]' : ''} w-full`}>
                    <thead>
                      <tr className="bg-muted/40 text-muted-foreground">
                        <th className="px-2 py-1.5 text-left font-medium">Version</th>
                        <th className="px-2 py-1.5 text-left font-medium">Quality</th>
                        <th className="px-2 py-1.5 text-left font-medium">Video</th>
                        <th className="px-2 py-1.5 text-left font-medium">Audio</th>
                        <th className="px-2 py-1.5 text-right font-medium">Size</th>
                        <th className="px-2 py-1.5 text-right font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {versions.map((v) => {
                        const insight = getVersionInsight(v)
                        const isSelected = selectedVersionId === v.id
                        return (
                          <tr
                            key={v.id}
                            onClick={() => setSelectedVersionId(v.id)}
                            className={`cursor-pointer border-t border-border/30 transition-colors hover:bg-muted/30 ${
                              isSelected ? 'bg-muted/40' : ''
                            }`}
                          >
                            <td className="px-2 py-1.5">
                              <div className="flex items-center gap-1">
                                {v.is_best && <Star className="w-3 h-3 text-foreground shrink-0" />}
                                <span className="font-medium truncate max-w-[120px]">{v.edition || v.label || v.resolution}</span>
                              </div>
                            </td>
                            <td className="px-2 py-1.5 text-muted-foreground">
                              {v.quality_tier || '--'} {v.tier_score != null && <span className="opacity-70">{v.tier_score}</span>}
                            </td>
                            <td className="px-2 py-1.5 text-muted-foreground">
                              <span className="font-mono">{v.video_codec}</span> {formatBitrate(v.video_bitrate)}
                            </td>
                            <td className="px-2 py-1.5 text-muted-foreground">
                              <span className="font-mono">{v.audio_codec}</span> {v.audio_channels > 0 ? `${v.audio_channels}ch` : ''}
                            </td>
                            <td className="px-2 py-1.5 text-right text-muted-foreground">{formatFileSize(v.file_size)}</td>
                            <td className="px-2 py-1.5 text-right">
                              {v.is_best ? (
                                <span className="text-foreground font-medium">Best</span>
                              ) : insight ? (
                                <span className="text-amber-500">
                                  {insight.label}
                                </span>
                              ) : null}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Quality Score Summary */}
          <div>
            {(sv?.quality_tier ?? media.quality_tier) ? (
              <>
                <div className={`flex ${isMobile ? 'flex-col gap-3' : 'items-center justify-between gap-4'}`}>
                  <div className={`flex items-center gap-4 bg-muted/30 ${isMobile ? 'px-3 py-2 rounded-lg' : 'px-4 py-3 rounded-lg'}`}>
                    <div className="text-center">
                      <div className="text-2xl font-bold">{(sv?.quality_tier ?? media.quality_tier) === 'UNKNOWN' ? 'Unknown' : sv?.quality_tier ?? media.quality_tier}</div>
                      <div className="text-xs font-medium text-muted-foreground">{(sv?.tier_quality ?? media.tier_quality) === 'UNKNOWN' ? 'Insufficient evidence' : (sv?.tier_quality ?? media.tier_quality)}</div>
                    </div>
                    {tierScore != null && (sv?.tier_quality ?? media.tier_quality) !== 'UNKNOWN' && (
                      <>
                        <div className="h-10 w-px bg-border" />
                        <div className="text-center">
                          <div className="text-2xl font-bold">{Math.round(tierScore)}</div>
                          <div className="text-xs font-medium text-muted-foreground">Overall score</div>
                        </div>
                      </>
                    )}
                  </div>

                </div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground text-center py-2">
                Quality rating is not available — rescan to analyze
              </div>
            )}
          </div>

          {media.estimated_savings_bytes != null && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-muted/20 px-3 py-2 text-xs">
              <span className="flex items-center gap-1.5"><span className="text-muted-foreground">Estimated savings</span><EstimatedSavingsDisplay bytes={media.estimated_savings_bytes} /> · {media.savings_coverage ?? 'insufficient'} evidence</span>
            </div>
          )}

          <ConversionRecommendation item={media} onOptimizationCompleted={loadMediaDetails} />


          {/* Insight Banner */}
          {sv && (() => {
            const insight = getVersionInsight(sv)
            if (!insight) return null
            return (
              <div className="text-label text-amber-500">
                {insight.type === 'redundant'
                  ? 'A better version exists \u2014 this copy may be safe to remove.'
                  : 'This version scores LOW quality \u2014 consider replacing it.'}
              </div>
            )
          })()}

          {/* Video & Audio — 2-column grid (stacks on mobile) */}
          <div className={`grid ${isMobile ? 'grid-cols-1' : 'grid-cols-2'} gap-4`}>
            {/* Video */}
            <div className="bg-muted/30 rounded-lg p-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Video</h3>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Dimensions</span>
                  <span className="font-medium">{sv?.width ?? media.width}×{sv?.height ?? media.height}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Codec</span>
                  <span className="font-medium">{sv?.video_codec ?? media.video_codec}</span>
                </div>
                {(sv?.video_bitrate_kbps ?? media.video_bitrate_kbps) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Bitrate</span>
                    <span className="font-medium">{formatBitrate(sv?.video_bitrate_kbps ?? media.video_bitrate_kbps)}</span>
                  </div>
                )}
                {(sv?.video_frame_rate ?? media.video_frame_rate) != null && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Frame Rate</span>
                    <span className="font-medium">{(sv?.video_frame_rate ?? media.video_frame_rate)?.toFixed(2)} fps</span>
                  </div>
                )}
                {(sv?.color_space ?? media.color_space) && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Color Space</span>
                    <span className="font-medium">{sv?.color_space ?? media.color_space}</span>
                  </div>
                )}
                {(sv?.video_profile ?? media.video_profile) && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Profile</span>
                    <span className="font-medium">{sv?.video_profile ?? media.video_profile}</span>
                  </div>
                )}
                {(sv?.color_bit_depth ?? media.color_bit_depth) != null && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Bit Depth</span>
                    <span className="font-medium">{sv?.color_bit_depth ?? media.color_bit_depth}-bit</span>
                  </div>
                )}
                {(sv?.hdr_format ?? media.hdr_format) && (sv?.hdr_format ?? media.hdr_format) !== 'None' && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">HDR</span>
                    <span className={`font-medium ${
                      (sv?.hdr_format ?? media.hdr_format) === 'Dolby Vision' ? 'text-purple-400' :
                      (sv?.hdr_format ?? media.hdr_format) === 'HDR10' ? 'text-orange-400' :
                      'text-yellow-400'
                    }`}>{sv?.hdr_format ?? media.hdr_format}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Audio */}
            <div>
              <h3 className="text-caption font-semibold text-muted-foreground mb-2">
                Audio{svAudioTracks.length > 0 ? ` (${svAudioTracks.length})` : ''}
              </h3>
              {/* Audio Tracks */}
              {svAudioTracks.length > 0 ? (
                <div className="space-y-2">
                  {svAudioTracks.map((track, idx) => {
                    const commentary = isCommentary(track)
                    return (
                      <div key={idx} className={`text-label ${idx > 0 ? 'pt-2 border-t border-border' : ''} ${commentary ? 'opacity-50' : ''}`}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{track.codec?.toUpperCase()} {formatChannels(track.channels)}</span>
                          {isAudioBitrateLow(track, sv?.quality_tier ?? media.quality_tier) && <LowIndicator />}
                          {track.hasObjectAudio && (
                            <span className="px-1.5 py-0.5 text-caption bg-muted text-muted-foreground rounded">Atmos</span>
                          )}
                          {commentary && (
                            <span className="px-1.5 py-0.5 text-caption bg-muted text-muted-foreground rounded">Commentary</span>
                          )}
                        </div>
                        {track.title && (
                          <div className="text-caption text-muted-foreground mt-0.5 truncate" title={track.title}>{track.title}</div>
                        )}
                        <div className="text-caption text-muted-foreground mt-0.5">
                          {track.bitrate > 0 ? formatBitrate(track.bitrate) : 'VBR'}
                          {track.sampleRate && ` · ${(track.sampleRate / 1000).toFixed(1)}kHz`}
                          {track.language && ` · ${track.language.toUpperCase()}`}
                        </div>
                        {(() => {
                          const diag = getTrackDiagnostic(track, sv?.quality_tier ?? media.quality_tier)
                          if (!diag) return null
                          return (
                            <div className="text-caption mt-1 text-muted-foreground">
                              {diag.message}
                            </div>
                          )
                        })()}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="text-label">
                  <div className="font-medium">{(sv?.audio_codec ?? media.audio_codec)?.toUpperCase()} {formatChannels(sv?.audio_channels ?? media.audio_channels)}</div>
                  <div className="text-xs text-muted-foreground flex items-center">
                    <span>{(sv?.audio_bitrate_kbps ?? media.audio_bitrate_kbps) > 0 ? formatBitrate(sv?.audio_bitrate_kbps ?? media.audio_bitrate_kbps) : 'Lossless'}</span>
                    {isAudioBitrateRawLow(sv?.audio_bitrate_kbps ?? media.audio_bitrate_kbps, sv?.quality_tier ?? media.quality_tier) && <LowIndicator />}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Subtitles */}
          {svSubtitleTracks.length > 0 && (
            <div>
              <h3 className="text-caption font-semibold text-muted-foreground mb-2">
                Subtitles ({svSubtitleTracks.length})
              </h3>
              <div className="flex flex-wrap gap-2">
                {svSubtitleTracks.map((track, idx) => (
                  <div
                    key={idx}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-caption bg-muted/50 rounded"
                    title={track.title || `${track.language || 'Unknown'} (${track.codec})`}
                  >
                    <span className="font-medium">{track.language?.toUpperCase() || 'UND'}</span>
                    <span className="text-muted-foreground">{track.codec}</span>
                    {track.isForced && (
                      <span className="px-1.5 py-0.5 text-caption bg-muted text-muted-foreground rounded leading-none">Forced</span>
                    )}
                    {track.isDefault && (
                      <span className="px-1.5 py-0.5 text-caption bg-muted text-muted-foreground rounded leading-none">Default</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* File Info & IDs */}
          <div>
            <h3 className="text-caption font-semibold text-muted-foreground mb-2">File Information</h3>
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-label">
              <span className="text-muted-foreground">Path</span>
              <span className="font-mono text-caption truncate" title={sv?.file_path ?? media.file_path}>
                {sv?.file_path ?? media.file_path}
              </span>
              {media.imdb_id && <>
                <span className="text-muted-foreground">IMDb</span>
                <button
                  onClick={() => window.electronAPI.openExternal(`https://www.imdb.com/title/${media.imdb_id}`)}
                  className="text-left text-muted-foreground hover:text-foreground hover:underline transition-colors cursor-pointer"
                >
                  {media.imdb_id}
                </button>
              </>}
              {media.tmdb_id && <>
                <span className="text-muted-foreground">TMDb</span>
                <button
                  onClick={() => window.electronAPI.openExternal(`https://www.themoviedb.org/${media.type === 'movie' ? 'movie' : 'tv'}/${media.tmdb_id}`)}
                  className="text-left text-muted-foreground hover:text-foreground hover:underline transition-colors cursor-pointer"
                >
                  {media.tmdb_id}
                </button>
              </>}
            </div>
          </div>
          </div>
        </div>
        {/* Mobile close button — after scroll container, anchored to modal via relative parent */}
        {isMobile && (
          <button
            onClick={handleClose}
            className="absolute top-3 right-3 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full bg-black/40 backdrop-blur-sm text-white/80 hover:bg-black/60 hover:text-white transition-colors z-20"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>,
    document.body
  )
}
