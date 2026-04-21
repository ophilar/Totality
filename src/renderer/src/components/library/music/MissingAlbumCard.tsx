import React, { useState, memo } from 'react'
import { Disc3, EyeOff } from 'lucide-react'
import { AddToWishlistButton } from '../../wishlist/AddToWishlistButton'
import type { MissingAlbum } from '../types'

export const MissingAlbumCard = memo(({ album, artistName, onDismiss }: {
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
    <div className="hover-scale opacity-60 hover:opacity-80 group">
      <div className="aspect-square bg-muted relative overflow-hidden rounded-md shadow-lg shadow-black/30 grayscale">
        {/* Album type badge */}
        {album.album_type !== 'album' && (
          <div className="absolute top-2 right-2 z-10">
            <span className="px-1.5 py-0.5 text-xs font-bold bg-gray-600 text-white rounded shadow-sm capitalize">
              {album.album_type}
            </span>
          </div>
        )}

        {coverUrl && !imageError ? (
          <img
            src={coverUrl}
            alt={album.title}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted/80">
            <Disc3 className="w-1/3 h-1/3 text-muted-foreground" />
          </div>
        )}
      </div>
      <div className="pt-2 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h4 className="font-medium text-sm truncate text-muted-foreground">{album.title}</h4>
          {album.year && (
            <p className="text-xs text-muted-foreground/70">{album.year}</p>
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
    </div>
  )
})
