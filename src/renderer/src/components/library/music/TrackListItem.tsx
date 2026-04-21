import React, { memo } from 'react'
import { CircleFadingArrowUp, Trash2, HardDrive } from 'lucide-react'
import { AddToWishlistButton } from '../../wishlist/AddToWishlistButton'
import type { MusicTrack } from '../types'

// Utility to format bytes into readable strings
const formatBytes = (bytes: number) => {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export const TrackListItem = memo(({ track, index, artistName, albumTitle, columnWidths, onClickQuality }: {
  track: MusicTrack
  index: number
  artistName?: string
  albumTitle?: string
  columnWidths?: { title: number; artist: number; album: number; quality: number; codec: number; duration: number }
  onClickQuality: () => void
}) => {
  // Quality tier calculation
  const LOSSLESS_CODECS = ['flac', 'alac', 'wav', 'aiff', 'pcm', 'dsd', 'ape', 'wavpack', 'wv']

  const isLosslessCodec = (codec?: string): boolean => {
    if (!codec) return false
    const codecLower = codec.toLowerCase()
    return LOSSLESS_CODECS.some(c => codecLower.includes(c))
  }

  const isAACCodec = (codec?: string): boolean => {
    if (!codec) return false
    return codec.toLowerCase().includes('aac')
  }

  const getQualityTier = (): 'ultra' | 'high' | 'high-lossy' | 'medium' | 'low' | null => {
    const bitrateKbps = track.audio_bitrate || 0
    const sampleRate = track.sample_rate || 0
    const bitDepth = track.bit_depth || 16
    const isLossless = track.is_lossless || isLosslessCodec(track.audio_codec)

    if (isLossless && (bitDepth >= 24 || sampleRate > 48000)) return 'ultra'
    if (isLossless) return 'high'
    if (bitrateKbps >= 256) return 'high-lossy'
    if (isAACCodec(track.audio_codec)) {
      if (bitrateKbps >= 128) return 'medium'
    } else {
      if (bitrateKbps >= 160) return 'medium'
    }
    if (bitrateKbps > 0) return 'low'
    if (track.audio_codec) {
      const codecLower = track.audio_codec.toLowerCase()
      if (codecLower.includes('mp3') || codecLower.includes('aac') || codecLower.includes('ogg')) {
        return 'medium'
      }
    }
    return null
  }

  const qualityTier = getQualityTier()
  const qualityTierConfig: Record<string, { label: string; color: string }> = {
    ultra: { label: 'Ultra', color: 'bg-foreground text-background' },
    high: { label: 'High', color: 'bg-foreground text-background' },
    'high-lossy': { label: 'High', color: 'bg-foreground text-background' },
    medium: { label: 'Mid', color: 'bg-foreground text-background' },
    low: { label: 'Low', color: 'bg-foreground text-background' }
  }

  const formatDuration = (ms?: number) => {
    if (!ms) return '--:--'
    const minutes = Math.floor(ms / 60000)
    const seconds = Math.floor((ms % 60000) / 1000)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  const widths = columnWidths || { title: 200, artist: 160, album: 180, quality: 60, codec: 70, duration: 60 }

  return (
    <div
      className="group cursor-pointer rounded-md overflow-hidden hover:bg-muted/40 transition-all duration-200 px-4 py-2 flex gap-4 items-center"
      onClick={onClickQuality}
    >
      {/* Track Number */}
      <div className="w-8 text-center text-sm text-muted-foreground">
        {index}
      </div>

      {/* Track Title */}
      <div className="min-w-0 truncate" style={{ width: widths.title }}>
        <h4 className="font-medium text-sm truncate">{track.title}</h4>
        {track.mood && (() => {
          try {
            const moods = JSON.parse(track.mood)
            if (!Array.isArray(moods) || moods.length === 0) return null
            return (
              <div className="flex flex-wrap gap-1 mt-0.5">
                {moods.slice(0, 2).map((mood: string) => (
                  <span key={mood} className="text-[9px] px-1 py-0 bg-blue-500/10 text-blue-400 rounded-sm border border-blue-500/20">
                    {mood}
                  </span>
                ))}
                {moods.length > 2 && <span className="text-[9px] text-muted-foreground">+{moods.length - 2}</span>}
              </div>
            )
          } catch { return null }
        })()}
      </div>

      {/* Artist */}
      <div className="min-w-0 truncate" style={{ width: widths.artist }}>
        <span className="text-sm text-muted-foreground truncate block">{artistName || '—'}</span>
      </div>

      {/* Album */}
      <div className="min-w-0 truncate" style={{ width: widths.album }}>
        <span className="text-sm text-muted-foreground truncate block">{albumTitle || '—'}</span>
      </div>

      {/* Quality Badge */}
      <div className="flex items-center gap-2" style={{ width: widths.quality }}>
        {qualityTier && (
          <span className={`px-2 py-0.5 text-xs font-bold rounded ${qualityTierConfig[qualityTier].color}`}>
            {qualityTierConfig[qualityTier].label}
          </span>
        )}
        {(qualityTier === 'low' || (track.efficiency_score != null && track.efficiency_score < 60)) && (
          <span title={track.efficiency_score != null && track.efficiency_score < 60 ? `Low Efficiency (${track.efficiency_score}%). Upgrade recommended to save space.` : "Quality upgrade recommended"}>
            {track.efficiency_score != null && track.efficiency_score < 60 ? (
              <Trash2 className="w-4 h-4 text-orange-500" />
            ) : (
              <CircleFadingArrowUp className="w-4 h-4 text-red-500" />
            )}
          </span>
        )}
        {track.storage_debt_bytes != null && track.storage_debt_bytes > 100 * 1024 * 1024 && (
          <span title={`Significant Storage Debt (${formatBytes(track.storage_debt_bytes)}). Re-encode to save space.`}>
            <HardDrive className="w-4 h-4 text-blue-500" />
          </span>
        )}
        {track.file_size && (
          <span className="text-[10px] text-muted-foreground font-mono ml-1">
            {(() => {
              const bytes = track.file_size
              const k = 1024
              const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
              const i = Math.floor(Math.log(bytes) / Math.log(k))
              return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + sizes[i]
            })()}
          </span>
        )}
      </div>

      {/* Codec */}
      <div className="text-xs text-muted-foreground" style={{ width: widths.codec }}>
        {track.audio_codec?.toUpperCase() || '—'}
      </div>

      {/* Duration */}
      <div className="text-xs text-muted-foreground text-right" style={{ width: widths.duration }}>
        {formatDuration(track.duration)}
      </div>

      {/* Size */}
      <div className="w-20 text-right text-[10px] text-muted-foreground font-mono">
        {track.file_size ? (() => {
          const bytes = track.file_size
          const k = 1024
          const sizes = ['B', 'KB', 'MB', 'GB']
          const i = Math.floor(Math.log(bytes) / Math.log(k))
          return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + sizes[i]
        })() : '-'}
      </div>

      {/* Add to Wishlist - for low quality tracks that need upgrade */}
      <div className="w-8 flex justify-center" onClick={(e) => e.stopPropagation()}>
        {qualityTier === 'low' && (
          <AddToWishlistButton
            mediaType="track"
            title={track.title}
            artistName={artistName}
            albumTitle={albumTitle}
            reason="upgrade"
            compact
          />
        )}
      </div>
    </div>
  )
})
