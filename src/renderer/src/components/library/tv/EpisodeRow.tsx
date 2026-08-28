import { useState, useCallback, memo, useRef } from 'react'
import { RefreshCw, MoreVertical, CircleFadingArrowUp, EyeOff, Trash2, HardDrive, Zap } from 'lucide-react'
import { QualityBadges } from '@/components/library/QualityBadges'
import { EpisodePlaceholder } from '@/components/ui/MediaPlaceholders'
import { ConversionRecommendation } from '@/components/library/ConversionRecommendation'
import { useMenuClose } from '@/hooks/useMenuClose'
import type { MediaItem } from '@/components/library/types'

// Utility to format bytes into readable strings
const formatBytes = (bytes: number) => {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export const EpisodeRow = memo(({
  episode,
  onClick,
  onRescan,
  onDismissUpgrade,
  isExpanded,
  onToggleOptimize,
  onOptimize,
  transcodeProgress,
  isQueuedTranscode
}: {
  episode: MediaItem
  onClick: () => void
  onRescan?: (episode: MediaItem) => Promise<void>
  onDismissUpgrade?: (episode: MediaItem) => void
  isExpanded?: boolean
  onToggleOptimize?: () => void
  onOptimize?: (episode: MediaItem) => void
  transcodeProgress?: {
    percentage?: number
    phase?: string
    speed?: string
    fps?: number
    eta?: string
    currentItem?: string
  }
  isQueuedTranscode?: boolean
}) => {
  const cardRef = useRef<HTMLDivElement>(null)
  const [showMenu, setShowMenu] = useState(false)
  const [isRescanning, setIsRescanning] = useState(false)
  const menuRef = useMenuClose({ isOpen: showMenu, onClose: useCallback(() => setShowMenu(false), []) })

  const handleRescan = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onRescan) {
      setIsRescanning(true)
      try {
        await onRescan(episode)
      } finally {
        setIsRescanning(false)
      }
    }
  }

  const handleDismissUpgrade = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onDismissUpgrade) {
      onDismissUpgrade(episode)
    }
  }

  const handleToggleOptimize = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowMenu(false)
    if (onToggleOptimize) onToggleOptimize()
  }


  const needsUpgrade = episode.tier_quality === 'LOW' || !!episode.needs_upgrade
  const showMenuButton = (onRescan && episode.file_path) || (onDismissUpgrade && needsUpgrade) || onToggleOptimize || onOptimize

  return (
    <div className={`flex flex-col relative ${showMenu ? 'z-50' : 'z-10'}`}>
      <div
        ref={cardRef}
        tabIndex={0}
        className="group flex gap-4 p-4 items-center hover:bg-muted/30 transition-colors cursor-pointer outline-hidden"
        onClick={onClick}

        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onClick()
          }
        }}
      >

        {/* Episode Thumbnail - 16:9 aspect ratio with shadow */}
        <div className="w-28 sm:w-44 aspect-video bg-muted overflow-hidden rounded-md shadow-md shadow-black/20 shrink-0 relative">
          {episode.episode_thumb_url ? (
            <img
              src={episode.episode_thumb_url}
              alt={episode.title}
              loading="lazy"
              className="w-full h-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-muted/50"><EpisodePlaceholder className="w-10 h-10 text-muted-foreground" /></div>
          )}
          {transcodeProgress && (
            <div className="absolute inset-0 bg-black/60 backdrop-blur-[1px] flex flex-col items-center justify-center gap-1 text-white z-10">
              <Zap className="w-5 h-5 text-primary fill-primary animate-pulse" />
              <span className="text-xs font-mono font-bold">{(transcodeProgress.percentage || 0).toFixed(0)}%</span>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-muted-foreground shrink-0">
              E{episode.episode_number}
            </span>
            <h4 className="font-semibold truncate">{episode.title}</h4>
          </div>
          <div className="flex gap-4 mt-2 text-sm text-muted-foreground font-mono">
            <span>{episode.resolution}</span>
            <span>{episode.video_bitrate == null ? 'Bitrate unavailable' : `${(episode.video_bitrate / 1000).toFixed(1)} Mbps`}</span>
            <span>{episode.audio_channels == null ? 'Audio channels unavailable' : `${episode.audio_channels}.0 Audio`}</span>
            {episode.file_size && (
              <span>
                {(() => {
                  const bytes = episode.file_size
                  const k = 1024
                  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
                  const i = Math.floor(Math.log(bytes) / Math.log(k))
                  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
                })()}
              </span>
            )}
          </div>

          {/* Transcode Progress Bar */}
          {transcodeProgress && (
            <div className="mt-2.5 space-y-1.5 w-full bg-primary/10 border border-primary/20 rounded-md p-2.5">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 text-primary font-medium">
                  <Zap className="w-3.5 h-3.5 fill-primary animate-pulse" />
                  <span>Optimizing episode...</span>
                  {transcodeProgress.phase && (
                    <span className="text-muted-foreground capitalize font-normal">({transcodeProgress.phase})</span>
                  )}
                </div>
                <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                  {transcodeProgress.fps !== undefined && transcodeProgress.fps > 0 && (
                    <span>{transcodeProgress.fps} FPS</span>
                  )}
                  {transcodeProgress.speed && (
                    <span>{transcodeProgress.speed}</span>
                  )}
                  {transcodeProgress.eta && (
                    <span>ETA: {transcodeProgress.eta}</span>
                  )}
                  <span className="font-semibold text-primary">{(transcodeProgress.percentage || 0).toFixed(1)}%</span>
                </div>
              </div>
              <div className="w-full bg-muted/60 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-primary h-full transition-all duration-300 ease-out"
                  style={{ width: `${Math.min(100, Math.max(0, transcodeProgress.percentage || 0))}%` }}
                />
              </div>
            </div>
          )}

          {isQueuedTranscode && !transcodeProgress && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded-md px-2.5 py-1 w-fit">
              <Zap className="w-3 h-3 fill-amber-500" />
              <span className="font-medium">Queued for optimization</span>
            </div>
          )}

          {/* Quality badges - white bg with black text */}
          <div className="mt-2 flex flex-wrap gap-1">
            <QualityBadges item={episode} whiteBg />
          </div>
        </div>

        {/* Upgrade indicator */}
        <div className="flex-shrink-0 flex items-center gap-2">
          {(episode.tier_quality === 'LOW' || !!episode.needs_upgrade) && (
            <div title="Quality upgrade recommended">
              <CircleFadingArrowUp className="w-6 h-6 text-red-500" />
            </div>
          )}
          {episode.efficiency_score != null && episode.efficiency_score < 60 && (
            <div title={`Low Efficiency (${episode.efficiency_score}%). Upgrade recommended to save space.`}>
              <Trash2 className="w-6 h-6 text-orange-500" />
            </div>
          )}
          {episode.storage_debt_bytes != null && episode.storage_debt_bytes > 2 * 1024 * 1024 * 1024 && (
            <div title={`Significant Storage Debt (${formatBytes(episode.storage_debt_bytes)}). Re-encode to save space.`}>
              <HardDrive className="w-6 h-6 text-blue-500" />
            </div>
          )}
        </div>

        {/* 3-dot menu */}
        {showMenuButton && (
          <div ref={menuRef} className="relative shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowMenu(!showMenu)
              }}
              className={`p-1.5 text-muted-foreground hover:text-foreground transition-colors ${showMenu ? 'bg-muted text-foreground' : ''}`}
            >
              {isRescanning ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <MoreVertical className="w-4 h-4" />
              )}
            </button>

            {showMenu && !isRescanning && (
              <div className="absolute top-8 right-0 bg-card border border-border rounded-md shadow-lg py-1 min-w-[160px] z-30">
                {onOptimize && episode.file_path && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowMenu(false)
                      onOptimize(episode)
                    }}
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2 text-primary font-medium cursor-pointer"
                  >
                    <Zap className="w-3.5 h-3.5 fill-current" />
                    Optimize Episode...
                  </button>
                )}
                {onToggleOptimize && (
                  <button
                    onClick={handleToggleOptimize}
                    className={`w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2 ${isExpanded ? 'text-primary font-medium' : ''}`}
                  >
                    <Zap className="w-3.5 h-3.5" />
                    {isExpanded ? 'Hide Optimization' : 'Optimization Details'}
                  </button>
                )}
                {onRescan && episode.file_path && (
                  <button
                    onClick={handleRescan}
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Rescan File
                  </button>
                )}
                {onDismissUpgrade && needsUpgrade && (
                  <button
                    onClick={handleDismissUpgrade}
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
                  >
                    <EyeOff className="w-3.5 h-3.5" />
                    Dismiss Upgrade
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      {isExpanded && <div onClick={e => e.stopPropagation()} className="px-4 pb-4"><ConversionRecommendation item={episode} compact /></div>}
    </div>
  )
})
