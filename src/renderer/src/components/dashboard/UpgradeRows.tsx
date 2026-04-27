import React from 'react'
import { Film, Tv, Disc3, Trash2, EyeOff } from 'lucide-react'
import { AddToWishlistButton } from '@/components/wishlist/AddToWishlistButton'
import { ConversionRecommendation } from '@/components/library/ConversionRecommendation'
import type { MediaItem } from '@/components/library/types'
import type { MusicAlbumUpgrade } from './types'

interface UpgradeRowProps {
  item: MediaItem
  index: number
  style: React.CSSProperties
  isExpanded: boolean
  onToggleExpand: (id: number) => void
  onSelect: (id: number) => void
  onDismiss: (index: number) => void
}

export const MovieUpgradeRow = React.memo(({ item, index, style, isExpanded, onToggleExpand, onSelect, onDismiss }: UpgradeRowProps) => {
  const wasteGB = item.storage_debt_bytes ? (item.storage_debt_bytes / (1024 * 1024 * 1024)).toFixed(1) : '0'

  return (
    <div style={style} className="px-2 overflow-hidden">
      <div
        className="flex items-center gap-3 px-2 py-2 hover:bg-muted/50 rounded-md transition-colors group/row cursor-pointer"
        onClick={() => onSelect(item.id!)}
      >
        <div className="w-10 h-14 bg-muted rounded overflow-hidden shrink-0 shadow-md shadow-black/40 relative">
          {item.poster_url ? (
            <img src={item.poster_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Film className="w-5 h-5 text-muted-foreground/50" />
            </div>
          )}
          {parseFloat(wasteGB) > 0.5 && (
            <div className="absolute top-0 right-0 p-0.5 bg-orange-600 rounded-bl-sm shadow-sm" title={`${wasteGB}GB WASTE`}>
              <Trash2 className="w-2.5 h-2.5 text-white" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{item.title}</div>
          <div className="text-xs text-muted-foreground truncate">{item.year}</div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] text-muted-foreground">
              {item.quality_tier} · {item.tier_quality}
            </span>
            {parseFloat(wasteGB) > 0.5 && (
              <button
                onClick={(e) => { e.stopPropagation(); onToggleExpand(item.id!) }}
                className={`text-[10px] font-bold px-1 py-0.5 rounded leading-none transition-colors ${
                  isExpanded ? 'bg-primary text-primary-foreground' : 'text-orange-400 bg-orange-400/10 hover:bg-orange-400/20'
                }`}
              >
                {wasteGB}GB WASTE
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
          <AddToWishlistButton
            mediaType="movie"
            title={item.title}
            year={item.year ?? undefined}
            tmdbId={item.tmdb_id ?? undefined}
            posterUrl={item.poster_url ?? undefined}
            reason="upgrade"
            mediaItemId={item.id!}
            currentQualityTier={item.quality_tier}
            currentQualityLevel={item.tier_quality}
            currentResolution={item.resolution ?? undefined}
            compact
          />
          <button
            onClick={() => onDismiss(index)}
            className="opacity-0 group-hover/row:opacity-100 p-1 text-muted-foreground hover:text-foreground transition-all"
            title="Dismiss"
          >
            <EyeOff className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {isExpanded && <div className="ml-13 mb-2"><ConversionRecommendation item={item} compact /></div>}
    </div>
  )
})

export const TvUpgradeRow = React.memo(({ item, index, style, isExpanded, onToggleExpand, onSelect, onDismiss }: UpgradeRowProps) => {
  const wasteGB = item.storage_debt_bytes ? (item.storage_debt_bytes / (1024 * 1024 * 1024)).toFixed(1) : '0'

  return (
    <div style={style} className="px-2 overflow-hidden">
      <div
        className="flex items-center gap-3 px-2 py-2 hover:bg-muted/50 rounded-md transition-colors group/row cursor-pointer"
        onClick={() => onSelect(item.id!)}
      >
        <div className="w-10 h-14 bg-muted rounded overflow-hidden shrink-0 shadow-md shadow-black/40 relative">
          {item.poster_url ? (
            <img src={item.poster_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Tv className="w-5 h-5 text-muted-foreground/50" />
            </div>
          )}
          {parseFloat(wasteGB) > 0.5 && (
            <div className="absolute top-0 right-0 p-0.5 bg-orange-600 rounded-bl-sm shadow-sm" title={`${wasteGB}GB WASTE`}>
              <Trash2 className="w-2.5 h-2.5 text-white" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{item.series_title || item.title}</div>
          <div className="text-xs text-muted-foreground truncate">
            S{item.season_number}E{item.episode_number} · {item.title}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] text-muted-foreground">
              {item.quality_tier} · {item.tier_quality}
            </span>
            {parseFloat(wasteGB) > 0.5 && (
              <button
                onClick={(e) => { e.stopPropagation(); onToggleExpand(item.id!) }}
                className={`text-[10px] font-bold px-1 py-0.5 rounded leading-none transition-colors ${
                  isExpanded ? 'bg-primary text-primary-foreground' : 'text-orange-400 bg-orange-400/10 hover:bg-orange-400/20'
                }`}
              >
                {wasteGB}GB WASTE
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
          <AddToWishlistButton
            mediaType="episode"
            title={item.title!}
            year={item.year ?? undefined}
            tmdbId={item.tmdb_id ?? undefined}
            posterUrl={item.poster_url ?? undefined}
            seriesTitle={item.series_title ?? undefined}
            seasonNumber={item.season_number ?? undefined}
            episodeNumber={item.episode_number ?? undefined}
            reason="upgrade"
            mediaItemId={item.id!}
            currentQualityTier={item.quality_tier}
            currentQualityLevel={item.tier_quality}
            currentResolution={item.resolution ?? undefined}
            compact
          />
          <button
            onClick={() => onDismiss(index)}
            className="opacity-0 group-hover/row:opacity-100 p-1 text-muted-foreground hover:text-foreground transition-all"
            title="Dismiss"
          >
            <EyeOff className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {isExpanded && <div className="ml-13 mb-2"><ConversionRecommendation item={item} compact /></div>}
    </div>
  )
})

interface MusicUpgradeRowProps {
  album: MusicAlbumUpgrade
  index: number
  style: React.CSSProperties
  onSelect: (id: number) => void
  onDismiss: (index: number) => void
}

export const MusicUpgradeRow = React.memo(({ album, index, style, onSelect, onDismiss }: MusicUpgradeRowProps) => {
  return (
    <div style={style} className="px-2">
      <div
        className="flex items-center gap-3 px-2 py-2 hover:bg-muted/50 rounded-md transition-colors group/row cursor-pointer"
        onClick={() => onSelect(album.id!)}
      >
        <div className="w-10 h-10 bg-muted rounded overflow-hidden shrink-0">
          {album.thumb_url ? (
            <img src={album.thumb_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Disc3 className="w-5 h-5 text-muted-foreground/50" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{album.title}</div>
          <div className="text-xs text-muted-foreground truncate">{album.artist_name}</div>
          <div className="text-[10px] text-muted-foreground mt-1">
            {album.quality_tier} · {album.tier_quality}{album.best_audio_bitrate ? ` · ${Math.round(album.best_audio_bitrate)} kbps` : ''}
          </div>
        </div>
        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
          <AddToWishlistButton
            mediaType="album"
            title={album.title}
            year={album.year}
            artistName={album.artist_name}
            musicbrainzId={album.musicbrainz_id}
            reason="upgrade"
            compact
          />
          <button
            onClick={() => onDismiss(index)}
            className="opacity-0 group-hover/row:opacity-100 p-1 text-muted-foreground hover:text-foreground transition-all"
            title="Dismiss"
          >
            <EyeOff className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
})
