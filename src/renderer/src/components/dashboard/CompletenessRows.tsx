import React from 'react'
import { Film, Tv, Music, ChevronDown, EyeOff } from 'lucide-react'
import { AddToWishlistButton } from '@/components/wishlist/AddToWishlistButton'
import type { MovieCollectionData, SeriesCompletenessData, ArtistCompletenessData } from '@/components/library/types'
import type { MissingMovie, MissingEpisode, MissingAlbumItem } from './types'
import { parseMissingMovies, groupEpisodesBySeason, parseMissingAlbums } from './dashboardUtils'

interface CollectionRowProps {
  collection: MovieCollectionData
  index: number
  style: React.CSSProperties
  isExpanded: boolean
  onToggleExpand: (index: number) => void
  onDismiss: (index: number, movie: MissingMovie) => void
}

export const CollectionRow = React.memo(({ collection, index, style, isExpanded, onToggleExpand, onDismiss }: CollectionRowProps) => {
  const missingCount = collection.total_movies - collection.owned_movies
  const missingMovies = isExpanded ? parseMissingMovies(collection) : []

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key === 'Enter' || e.key === ' ') && missingCount > 0) {
      e.preventDefault()
      onToggleExpand(index)
    }
  }

  return (
    <div style={style} className="px-2 overflow-hidden">
      <div
        role="button"
        tabIndex={missingCount > 0 ? 0 : -1}
        className="flex items-center gap-3 px-2 py-2 cursor-pointer hover:bg-muted/50 rounded-md transition-colors focus:outline-hidden"
        onClick={() => missingCount > 0 && onToggleExpand(index)}
        onKeyDown={handleKeyDown}
        aria-expanded={isExpanded}
        aria-label={`${collection.collection_name}, ${collection.owned_movies} of ${collection.total_movies} movies`}
      >
        <div className="w-10 h-14 bg-muted rounded overflow-hidden shrink-0 shadow-md shadow-black/40">
          {collection.poster_url ? (
            <img src={collection.poster_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Film className="w-5 h-5 text-muted-foreground/50" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{collection.collection_name}</div>
          <div className="text-xs text-muted-foreground">
            {collection.owned_movies}/{collection.total_movies} · {Math.round(collection.completeness_percentage)}%
          </div>
          <div className="w-full h-1 bg-muted rounded-full mt-1 overflow-hidden">
            <div className="h-full bg-primary rounded-full" style={{ width: `${collection.completeness_percentage}%` }} />
          </div>
        </div>
        {missingCount > 0 && (
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
        )}
      </div>

      {isExpanded && missingMovies.length > 0 && (
        <div className="ml-14 mt-2 space-y-1">
          {missingMovies.map((movie, idx) => (
            <div
              key={idx}
              className="flex items-center gap-3 py-1.5 rounded-md hover:bg-muted/30 transition-colors group/item"
            >
              {movie.tmdb_id ? (
                <button
                  onClick={(e) => { e.stopPropagation(); window.electronAPI.openExternal(`https://www.themoviedb.org/movie/${movie.tmdb_id}`) }}
                  className="text-sm text-muted-foreground truncate flex-1 text-left hover:text-primary hover:underline cursor-pointer transition-colors"
                  title="Open on TMDB"
                >
                  {movie.title} {movie.year ? `(${movie.year})` : ''}
                </button>
              ) : (
                <span className="text-sm text-muted-foreground truncate flex-1">
                  {movie.title} {movie.year ? `(${movie.year})` : ''}
                </span>
              )}
              <AddToWishlistButton
                mediaType="movie"
                title={movie.title}
                year={movie.year}
                tmdbId={movie.tmdb_id}
                posterUrl={movie.poster_url}
                reason="missing"
                compact
              />
              <button
                onClick={(e) => { e.stopPropagation(); onDismiss(index, movie) }}
                className="opacity-0 group-hover/item:opacity-100 p-1 text-muted-foreground hover:text-foreground transition-all"
                title="Dismiss"
              >
                <EyeOff className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
})

interface SeriesRowProps {
  s: SeriesCompletenessData
  index: number
  style: React.CSSProperties
  isExpanded: boolean
  onToggleExpand: (index: number) => void
  onDismiss: (index: number, episode: MissingEpisode) => void
}

export const SeriesRow = React.memo(({ s, index, style, isExpanded, onToggleExpand, onDismiss }: SeriesRowProps) => {
  const missingCount = s.total_episodes - s.owned_episodes
  const seasonGroups = isExpanded ? groupEpisodesBySeason(s) : []

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key === 'Enter' || e.key === ' ') && missingCount > 0) {
      e.preventDefault()
      onToggleExpand(index)
    }
  }

  return (
    <div style={style} className="px-2 overflow-hidden">
      <div
        role="button"
        tabIndex={missingCount > 0 ? 0 : -1}
        className="flex items-center gap-3 px-2 py-2 cursor-pointer hover:bg-muted/50 rounded-md transition-colors focus:outline-hidden"
        onClick={() => missingCount > 0 && onToggleExpand(index)}
        onKeyDown={handleKeyDown}
        aria-expanded={isExpanded}
        aria-label={`${s.series_title}, ${s.owned_seasons} of ${s.total_seasons} seasons, ${s.owned_episodes} of ${s.total_episodes} episodes`}
      >
        <div className="w-10 h-14 bg-muted rounded overflow-hidden shrink-0 shadow-md shadow-black/40">
          {s.poster_url ? (
            <img src={s.poster_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Tv className="w-5 h-5 text-muted-foreground/50" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{s.series_title}</div>
          <div className="text-xs text-muted-foreground">
            {s.owned_seasons}/{s.total_seasons} seasons · {s.owned_episodes}/{s.total_episodes} eps · {Math.round(s.completeness_percentage)}%
          </div>
          <div className="w-full h-1 bg-muted rounded-full mt-1 overflow-hidden">
            <div className="h-full bg-primary rounded-full" style={{ width: `${s.completeness_percentage}%` }} />
          </div>
        </div>
        {missingCount > 0 && (
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
        )}
      </div>

      {isExpanded && seasonGroups.length > 0 && (
        <div className="ml-14 mt-2 space-y-1">
          {seasonGroups.map(group => (
            <div
              key={group.seasonNumber}
              className="flex items-center justify-between py-1.5 rounded-md hover:bg-muted/30 transition-colors group/item"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {s.tmdb_id ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); window.electronAPI.openExternal(`https://www.themoviedb.org/tv/${s.tmdb_id}/season/${group.seasonNumber}`) }}
                    className="text-sm text-foreground/80 shrink-0 hover:text-primary hover:underline cursor-pointer transition-colors"
                    title="Open on TMDB"
                  >
                    S{group.seasonNumber}
                  </button>
                ) : (
                  <span className="text-sm text-foreground/80 shrink-0">
                    S{group.seasonNumber}
                  </span>
                )}
                {group.isWholeSeason ? (
                  <span className="text-xs text-muted-foreground">
                    All {group.totalEpisodes} episodes
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground truncate">
                    E{group.missingEpisodes.map(ep => ep.episode_number).join(', E')}
                  </span>
                )}
              </div>
              <AddToWishlistButton
                mediaType="episode"
                title={`Season ${group.seasonNumber}`}
                seriesTitle={s.series_title}
                seasonNumber={group.seasonNumber}
                tmdbId={s.tmdb_id}
                posterUrl={s.poster_url || undefined}
                reason="missing"
                compact
              />
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  group.missingEpisodes.forEach(ep => onDismiss(index, ep))
                }}
                className="opacity-0 group-hover/item:opacity-100 p-1 text-muted-foreground hover:text-foreground transition-all"
                title="Dismiss season"
              >
                <EyeOff className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
})

interface ArtistRowProps {
  artist: ArtistCompletenessData
  index: number
  style: React.CSSProperties
  isExpanded: boolean
  includeEps: boolean
  includeSingles: boolean
  onToggleExpand: (index: number) => void
  onDismiss: (index: number, album: MissingAlbumItem) => void
}

export const ArtistRow = React.memo(({ artist, index, style, isExpanded, includeEps, includeSingles, onToggleExpand, onDismiss }: ArtistRowProps) => {
  const totalReleases = artist.total_albums
    + (includeEps ? artist.total_eps : 0)
    + (includeSingles ? artist.total_singles : 0)
  const ownedReleases = artist.owned_albums
    + (includeEps ? artist.owned_eps : 0)
    + (includeSingles ? artist.owned_singles : 0)
  const totalMissing = totalReleases - ownedReleases
  const allMissing = isExpanded ? parseMissingAlbums(artist, includeEps, includeSingles) : []

  const groupedByType = isExpanded ? {
    album: allMissing.filter(m => m.album_type === 'album'),
    ep: allMissing.filter(m => m.album_type === 'ep'),
    single: allMissing.filter(m => m.album_type === 'single')
  } : { album: [], ep: [], single: [] }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key === 'Enter' || e.key === ' ') && totalMissing > 0) {
      e.preventDefault()
      onToggleExpand(index)
    }
  }

  return (
    <div style={style} className="px-2 overflow-hidden">
      <div
        role="button"
        tabIndex={totalMissing > 0 ? 0 : -1}
        className="flex items-center gap-3 px-2 py-1 cursor-pointer hover:bg-muted/50 rounded-md transition-colors focus:outline-hidden"
        onClick={() => totalMissing > 0 && onToggleExpand(index)}
        onKeyDown={handleKeyDown}
        aria-expanded={isExpanded}
        aria-label={`${artist.artist_name}, ${ownedReleases} of ${totalReleases} releases`}
      >
        <div className="w-10 h-10 bg-muted rounded-full overflow-hidden shrink-0 flex items-center justify-center shadow-md shadow-black/40">
          {artist.thumb_url ? (
            <img src={artist.thumb_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <Music className="w-5 h-5 text-muted-foreground/50" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{artist.artist_name}</div>
          <div className="text-xs text-muted-foreground">
            {ownedReleases}/{totalReleases} releases · {Math.round(artist.completeness_percentage)}%
          </div>
          <div className="w-full h-1 bg-muted rounded-full mt-1 overflow-hidden">
            <div className="h-full bg-primary rounded-full" style={{ width: `${artist.completeness_percentage}%` }} />
          </div>
        </div>
        {totalMissing > 0 && (
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
        )}
      </div>

      {isExpanded && allMissing.length > 0 && (
        <div className="ml-14 mt-2 space-y-3">
          {([
            { items: groupedByType.album, label: 'Albums', prefix: 'album' },
            { items: groupedByType.ep, label: 'EPs', prefix: 'ep' },
            { items: groupedByType.single, label: 'Singles', prefix: 'single' },
          ] as const).filter(g => g.items.length > 0).map(group => (
            <div key={group.prefix}>
              <div className="py-2 text-xs font-medium text-foreground/70 uppercase tracking-wider">
                {group.label}
              </div>
              <div className="space-y-1">
                {group.items.map((item, idx) => {
                  const coverUrl = item.musicbrainz_id
                    ? `https://coverartarchive.org/release-group/${item.musicbrainz_id}/front-250`
                    : null
                  return (
                    <div
                      key={item.musicbrainz_id || `${group.prefix}-${idx}`}
                      className="flex items-center gap-3 py-1.5 rounded-md hover:bg-muted/30 transition-colors group/item"
                    >
                      <div className="w-8 h-8 bg-muted rounded overflow-hidden shrink-0">
                        {coverUrl ? (
                          <img src={coverUrl} alt="" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none' }} />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Music className="w-4 h-4 text-muted-foreground/50" />
                          </div>
                        )}
                      </div>
                      {item.musicbrainz_id ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); window.electronAPI.openExternal(`https://musicbrainz.org/release-group/${item.musicbrainz_id}`) }}
                          className="text-sm text-muted-foreground truncate flex-1 text-left hover:text-primary hover:underline cursor-pointer transition-colors"
                          title="Open on MusicBrainz"
                        >
                          {item.title} {item.year ? `(${item.year})` : ''}
                        </button>
                      ) : (
                        <span className="text-sm text-muted-foreground truncate flex-1">
                          {item.title} {item.year ? `(${item.year})` : ''}
                        </span>
                      )}
                      <AddToWishlistButton
                        mediaType="album"
                        title={item.title}
                        year={item.year}
                        artistName={artist.artist_name}
                        musicbrainzId={item.musicbrainz_id}
                        posterUrl={coverUrl || undefined}
                        reason="missing"
                        compact
                      />
                      <button
                        onClick={(e) => { e.stopPropagation(); onDismiss(index, item) }}
                        className="opacity-0 group-hover/item:opacity-100 p-1 text-muted-foreground hover:text-foreground transition-all"
                        title="Dismiss"
                      >
                        <EyeOff className="w-3 h-3" />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
})
