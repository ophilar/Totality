import { memo } from 'react'
import { Disc3 } from 'lucide-react'
import { providerColors } from '../mediaUtils'
import type { MusicAlbum, AlbumCompletenessData } from '../types'

export const AlbumListItem = memo(({ album, onClick, showArtist = true, showSourceBadge, completeness }: {
  album: MusicAlbum
  onClick: () => void
  showArtist?: boolean
  showSourceBadge: boolean
  completeness?: AlbumCompletenessData
}) => {
  const losslessCodecs = ['flac', 'alac', 'wav', 'aiff', 'dsd', 'ape', 'wavpack', 'pcm']
  const codec = (album.best_audio_codec || '').toLowerCase()
  const isLossless = losslessCodecs.some(c => codec.includes(c))
  const isHiRes = isLossless && ((album.best_bit_depth || 0) > 16 || (album.best_sample_rate || 0) > 48000)

  return (
    <div
      className="group cursor-pointer rounded-md bg-muted/20 hover:bg-muted/40 transition-all duration-200 p-4 flex gap-4 items-center"
      onClick={onClick}
    >
      {/* Album Thumbnail */}
      <div className="w-16 h-16 bg-muted rounded-md overflow-hidden shrink-0 relative shadow-md shadow-black/20">
        {album.thumb_url ? (
          <img
            src={album.thumb_url}
            alt={album.title}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Disc3 className="w-8 h-8 text-muted-foreground" />
          </div>
        )}
        {/* Source badge */}
        {showSourceBadge && album.source_type && (
          <div
            className={`absolute bottom-0 right-0 ${providerColors[album.source_type] || 'bg-gray-500'} text-white text-xs font-bold px-1 py-0.5 rounded`}
          >
            {album.source_type.charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h4 className="font-semibold text-sm truncate">{album.title}</h4>
        {album.year && (
          <p className="text-xs text-muted-foreground">{album.year}</p>
        )}
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          {isHiRes && (
            <span className="px-2 py-0.5 text-xs font-medium bg-foreground text-background rounded">Hi-Res</span>
          )}
          {isLossless && !isHiRes && (
            <span className="px-2 py-0.5 text-xs font-medium bg-foreground text-background rounded">Lossless</span>
          )}
        </div>
      </div>

      {/* Artist column */}
      {showArtist && (
        <div className="w-48 shrink-0">
          <p className="text-sm text-muted-foreground truncate">{album.artist_name}</p>
        </div>
      )}

      {/* Completeness column */}
      <div className="w-20 shrink-0 text-center">
        {completeness && (
          <span className="px-2 py-0.5 text-xs font-medium bg-foreground text-background rounded">
            {completeness.owned_tracks}/{completeness.total_tracks}
          </span>
        )}
      </div>
    </div>
  )
})
