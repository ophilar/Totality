import { useState, useCallback, useMemo } from 'react'
import { Star } from 'lucide-react'
import { useWishlist, WishlistMediaType, WishlistReason } from '../../contexts/WishlistContext'

interface AddToWishlistButtonProps {
  mediaType: WishlistMediaType
  title: string
  year?: number
  tmdbId?: string
  imdbId?: string
  musicbrainzId?: string
  seriesTitle?: string
  seasonNumber?: number
  episodeNumber?: number
  collectionName?: string
  artistName?: string
  albumTitle?: string
  posterUrl?: string
  // Reason for adding (missing = complete collection, upgrade = better quality)
  reason?: WishlistReason
  // Upgrade-specific props
  mediaItemId?: number
  currentQualityTier?: string
  currentQualityLevel?: string
  currentResolution?: string
  currentVideoCodec?: string
  currentAudioCodec?: string
  // Display options
  compact?: boolean
}

export function AddToWishlistButton({
  mediaType,
  title,
  year,
  tmdbId,
  imdbId,
  musicbrainzId,
  seriesTitle,
  seasonNumber,
  episodeNumber,
  collectionName,
  artistName,
  albumTitle,
  posterUrl,
  reason = 'missing',
  mediaItemId,
  currentQualityTier,
  currentQualityLevel,
  currentResolution,
  currentVideoCodec,
  currentAudioCodec,
  compact = false
}: AddToWishlistButtonProps) {
  const { addItem, removeItem, items } = useWishlist()
  const [isLoading, setIsLoading] = useState(false)

  // For episodes, we add the season instead (can't buy individual episodes on physical media)
  const isEpisode = mediaType === 'episode'
  const effectiveMediaType: WishlistMediaType = isEpisode ? 'season' : mediaType
  const effectiveTitle = isEpisode ? (seriesTitle || title) : title

  // Find the matching wishlist item synchronously from the local items array.
  // Returns the item if found (for removal), or undefined if not in wishlist.
  const wishlistMatch = useMemo(() => {
    // Seasons: match by series_title + season_number (tmdb_id is shared across seasons)
    if ((mediaType === 'season' || isEpisode) && seriesTitle && seasonNumber !== undefined) {
      return items.find(
        item => item.media_type === 'season' &&
                item.series_title === seriesTitle &&
                item.season_number === seasonNumber
      )
    }
    // Match by strongest available identifier
    if (tmdbId) {
      return items.find(item => item.tmdb_id === tmdbId && item.media_type === effectiveMediaType)
    }
    if (musicbrainzId) {
      return items.find(item => item.musicbrainz_id === musicbrainzId)
    }
    if (mediaItemId) {
      return items.find(item => item.media_item_id === mediaItemId)
    }
    // Fallback: match by title + media type
    return items.find(item => item.title === effectiveTitle && item.media_type === effectiveMediaType)
  }, [items, mediaType, isEpisode, seriesTitle, seasonNumber, tmdbId, musicbrainzId, mediaItemId, effectiveMediaType, effectiveTitle])

  const isInWishlist = !!wishlistMatch

  const handleToggle = useCallback(async () => {
    if (isLoading) return

    setIsLoading(true)
    try {
      if (isInWishlist && wishlistMatch) {
        await removeItem(wishlistMatch.id)
      } else {
        await addItem({
          media_type: effectiveMediaType,
          title: effectiveTitle,
          year,
          tmdb_id: tmdbId,
          imdb_id: imdbId,
          musicbrainz_id: musicbrainzId,
          series_title: seriesTitle,
          season_number: seasonNumber,
          episode_number: isEpisode ? undefined : episodeNumber,
          collection_name: collectionName,
          artist_name: artistName,
          album_title: albumTitle,
          poster_url: posterUrl,
          priority: 3,
          reason,
          status: 'active',
          media_item_id: isEpisode ? undefined : mediaItemId,
          current_quality_tier: currentQualityTier,
          current_quality_level: currentQualityLevel,
          current_resolution: currentResolution,
          current_video_codec: currentVideoCodec,
          current_audio_codec: currentAudioCodec
        })
      }
    } catch (err) {
      console.error('Error toggling wishlist:', err)
    } finally {
      setIsLoading(false)
    }
  }, [
    isLoading, isInWishlist, wishlistMatch, removeItem, addItem, effectiveMediaType, effectiveTitle, year, tmdbId, imdbId,
    musicbrainzId, seriesTitle, seasonNumber, episodeNumber, collectionName,
    artistName, albumTitle, posterUrl, reason, mediaItemId, isEpisode,
    currentQualityTier, currentQualityLevel, currentResolution, currentVideoCodec, currentAudioCodec
  ])

  // Indicate that the whole season will be added when adding an episode
  const buttonLabel = isEpisode
    ? `Add Season ${seasonNumber ?? ''} to Wishlist`
    : 'Add to Wishlist'
  const inListLabel = isEpisode
    ? `Season ${seasonNumber ?? ''} in Wishlist`
    : 'In Wishlist'
  const removeLabel = isEpisode
    ? `Remove Season ${seasonNumber ?? ''} from Wishlist`
    : 'Remove from Wishlist'

  if (compact) {
    return (
      <button
        onClick={handleToggle}
        disabled={isLoading}
        className={`p-1 transition-colors disabled:opacity-50 ${
          isInWishlist
            ? 'text-amber-400 hover:text-amber-500'
            : 'text-primary hover:text-primary/80'
        }`}
        title={isInWishlist ? removeLabel : buttonLabel}
      >
        <Star className={`w-5 h-5 ${isInWishlist ? 'fill-amber-400' : ''}`} />
      </button>
    )
  }

  return (
    <button
      onClick={handleToggle}
      disabled={isLoading}
      className={`inline-flex items-center gap-1.5 rounded-md text-sm disabled:opacity-50 transition-colors ${
        isInWishlist
          ? 'px-2.5 py-1.5 bg-amber-400/10 border border-amber-400/30 text-amber-500 hover:bg-amber-400/20'
          : 'gap-2 px-3 py-2 bg-primary text-primary-foreground hover:bg-primary/90'
      }`}
    >
      <Star className={`w-4 h-4 ${isInWishlist ? 'fill-amber-400 text-amber-400' : ''}`} />
      <span>{isInWishlist ? inListLabel : buttonLabel}</span>
    </button>
  )
}
