import { useState, memo } from 'react'
import { Disc3, EyeOff } from 'lucide-react'
import { AddToWishlistButton } from '@/components/wishlist/AddToWishlistButton'
import type { MissingAlbum } from '@/components/library/types'

export const MissingAlbumListItem = memo(({ album, artistName, onDismiss }: {
  album: MissingAlbum
  artistName: string
  onDismiss?: () => void
}) => {
  const [imageError, setImageError] = useState(false)

  // Cover Art Archive URL for release group
  const coverUrl = album.musicbrainz_id
    ? `https://coverartarchive.org/release-group/${album.musicbrainz_id}/front-250`
    : null

  return (
    <div className="rounded-md overflow-hidden bg-muted/20 p-4 flex gap-4 items-center opacity-60 hover:opacity-80 transition-opacity">
      {/* Album Thumbnail */}
      <div className="w-16 h-16 bg-muted rounded-md overflow-hidden shrink-0 relative grayscale shadow-md shadow-black/20">
        {coverUrl && !imageError ? (
          <img
            src={coverUrl}
            alt={album.title}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Disc3 className="w-8 h-8 text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h4 className="font-semibold text-sm truncate text-muted-foreground">{album.title}</h4>
        {album.year && (
          <p className="text-xs text-muted-foreground/70">{album.year}</p>
        )}
        {album.album_type !== 'album' && (
          <div className="mt-2">
            <span className="px-2 py-0.5 text-xs font-medium bg-gray-600 text-white rounded capitalize">
              {album.album_type}
            </span>
          </div>
        )}
      </div>

      {/* Wishlist + Dismiss buttons */}
      <div className="shrink-0 flex items-center gap-1">
        <AddToWishlistButton
          mediaType="album"
          title={album.title}
          year={album.year}
          musicbrainzId={album.musicbrainz_id}
          artistName={artistName}
          posterUrl={coverUrl || undefined}
          compact
        />
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
            title="Dismiss"
          >
            <EyeOff className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  )
})
