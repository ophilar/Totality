

import { Search, X, Film, Tv, User, Disc3, Music, CircleFadingArrowUp } from 'lucide-react'
import { MoviePlaceholder, TvPlaceholder, EpisodePlaceholder } from '@/components/ui/MediaPlaceholders'
import type { GlobalSearchResults, FlattenedResult, UseGlobalSearchReturn } from '@/components/library/hooks/useGlobalSearch'


export interface SearchAutocompleteProps {
  searchInput: string
  setSearchInput: (val: string) => void
  showSearchResults: boolean
  setShowSearchResults: (val: boolean) => void
  searchResultIndex: number
  setSearchResultIndex: (idx: number) => void
  searchContainerRef: UseGlobalSearchReturn['searchContainerRef']
  searchInputRef: React.RefObject<HTMLInputElement | null>
  globalSearchResults: GlobalSearchResults
  hasSearchResults: boolean
  flattenedResults?: FlattenedResult[]
  handleSearchKeyDown: UseGlobalSearchReturn['handleSearchKeyDown']
  handleSearchResultClick: UseGlobalSearchReturn['handleSearchResultClick']
}

export const SearchAutocomplete: React.FC<SearchAutocompleteProps> = ({
  searchInput,
  setSearchInput,
  showSearchResults,
  setShowSearchResults,
  searchResultIndex,
  setSearchResultIndex,
  searchContainerRef,
  searchInputRef,
  globalSearchResults,
  hasSearchResults,
  handleSearchKeyDown,
  handleSearchResultClick,
}) => {
  const movies = globalSearchResults?.movies || []
  const tvShows = globalSearchResults?.tvShows || []
  const episodes = globalSearchResults?.episodes || []
  const artists = globalSearchResults?.artists || []
  const albums = globalSearchResults?.albums || []
  const tracks = globalSearchResults?.tracks || []

  return (
    <div ref={searchContainerRef} className="relative shrink min-w-24 max-w-80 w-64" role="combobox" aria-expanded={showSearchResults && hasSearchResults} aria-haspopup="listbox">
      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground z-10" aria-hidden="true" />
      <input
        ref={searchInputRef}
        type="text"
        placeholder="Search all libraries..."
        value={searchInput}
        onChange={(e) => {
          setSearchInput(e.target.value)
          setShowSearchResults(true)
          setSearchResultIndex(-1)
        }}
        onFocus={() => setShowSearchResults(true)}
        onKeyDown={handleSearchKeyDown}
        className="w-full pl-9 pr-8 py-1.5 bg-muted/30 hover:bg-muted/50 focus:bg-background border border-border/50 focus:border-primary rounded-full text-xs text-foreground placeholder:text-muted-foreground transition-all duration-200 shadow-inner"
        aria-label="Search media library"
        aria-autocomplete="list"
      />
      {searchInput && (
        <button
          onClick={() => {
            setSearchInput('')
            setShowSearchResults(false)
          }}
          className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Clear search"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Search Results Dropdown */}
      {showSearchResults && searchInput.length >= 2 && hasSearchResults && (
        <div
          role="listbox"
          className="absolute top-full left-0 right-0 mt-2 bg-card border border-border rounded-lg shadow-2xl overflow-hidden z-9999 max-h-[400px] overflow-y-auto"
        >
          {/* Movies */}
          {movies.length > 0 && (
            <div role="group">
              <div className="px-3 py-2 text-xs font-semibold text-foreground/70 bg-muted/50 flex items-center gap-2">
                <Film className="w-3 h-3" />
                Movies
              </div>
              {movies.map((movie, idx: number) => (
                <button
                  key={`movie-${movie.id}`}
                  onClick={() => handleSearchResultClick('movie', movie.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left focus:outline-hidden ${
                    searchResultIndex === idx ? 'bg-primary/20 ring-2 ring-inset ring-primary' : 'hover:bg-muted/50'
                  }`}
                >
                  {movie.poster_url ? (
                    <img src={movie.poster_url} alt="" className="w-8 h-12 object-cover rounded" />
                  ) : (
                    <div className="w-8 h-12 bg-muted rounded flex items-center justify-center">
                      <MoviePlaceholder className="w-6 h-6 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{movie.title}</div>
                    {movie.year && <div className="text-xs text-muted-foreground">{movie.year}</div>}
                  </div>
                  {movie.needs_upgrade && (
                    <CircleFadingArrowUp className="w-5 h-5 text-red-500 shrink-0" />
                  )}
                </button>
              ))}
            </div>
          )}

          {/* TV Shows */}
          {tvShows.length > 0 && (
            <div role="group">
              <div className="px-3 py-2 text-xs font-semibold text-foreground/70 bg-muted/50 flex items-center gap-2">
                <Tv className="w-3 h-3" />
                TV Shows
              </div>
              {tvShows.map((show: GlobalSearchResults['tvShows'][number], idx: number) => (
                <button
                  key={`tv-${show.id}`}
                  onClick={() => handleSearchResultClick('tv', show.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left focus:outline-hidden ${
                    searchResultIndex === (movies.length + idx) ? 'bg-primary/20 ring-2 ring-inset ring-primary' : 'hover:bg-muted/50'
                  }`}
                >
                  {show.poster_url ? (
                    <img src={show.poster_url} alt="" className="w-8 h-12 object-cover rounded" />
                  ) : (
                    <div className="w-8 h-12 bg-muted rounded flex items-center justify-center">
                      <TvPlaceholder className="w-6 h-6 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{show.title}</div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Episodes */}
          {episodes.length > 0 && (
            <div role="group">
              <div className="px-3 py-2 text-xs font-semibold text-foreground/70 bg-muted/50 flex items-center gap-2">
                <Tv className="w-3 h-3" />
                Episodes
              </div>
              {episodes.map((episode, idx: number) => (
                <button
                  key={`episode-${episode.id}`}
                  onClick={() => handleSearchResultClick('episode', episode.id, { series_title: episode.series_title })}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left focus:outline-hidden ${
                    searchResultIndex === (movies.length + tvShows.length + idx) ? 'bg-primary/20 ring-2 ring-inset ring-primary' : 'hover:bg-muted/50'
                  }`}
                >
                  {episode.thumb_url ? (
                    <img src={episode.thumb_url} alt="" className="w-12 h-8 object-cover rounded" />
                  ) : (
                    <div className="w-12 h-8 bg-muted rounded flex items-center justify-center">
                      <EpisodePlaceholder className="w-6 h-6 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{episode.title}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {episode.series_title} • S{episode.season_number}E{episode.episode_number}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Music */}
          {artists.length > 0 && (
            <div role="group">
              <div className="px-3 py-2 text-xs font-semibold text-foreground/70 bg-muted/50 flex items-center gap-2">
                <User className="w-3 h-3" />
                Artists
              </div>
              {artists.map((artist, idx: number) => (
                <button
                  key={`artist-${artist.id}`}
                  onClick={() => handleSearchResultClick('artist', artist.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left focus:outline-hidden ${
                    searchResultIndex === (movies.length + tvShows.length + episodes.length + idx) ? 'bg-primary/20 ring-2 ring-inset ring-primary' : 'hover:bg-muted/50'
                  }`}
                >
                  <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center shrink-0 overflow-hidden">
                    {artist.thumb_url ? <img src={artist.thumb_url} alt="" className="w-full h-full object-cover" /> : <User className="w-4 h-4 text-muted-foreground" />}
                  </div>
                  <div className="flex-1 min-w-0 font-medium text-sm truncate">{artist.title}</div>
                </button>
              ))}
            </div>
          )}

          {albums.length > 0 && (
            <div role="group">
              <div className="px-3 py-2 text-xs font-semibold text-foreground/70 bg-muted/50 flex items-center gap-2">
                <Disc3 className="w-3 h-3" />
                Albums
              </div>
              {albums.map((album, idx: number) => (
                <button
                  key={`album-${album.id}`}
                  onClick={() => handleSearchResultClick('album', album.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left focus:outline-hidden ${
                    searchResultIndex === (movies.length + tvShows.length + episodes.length + artists.length + idx) ? 'bg-primary/20 ring-2 ring-inset ring-primary' : 'hover:bg-muted/50'
                  }`}
                >
                  <div className="w-8 h-8 bg-muted rounded overflow-hidden shrink-0">
                    {album.thumb_url ? <img src={album.thumb_url} alt="" className="w-full h-full object-cover" /> : <Disc3 className="w-4 h-4 text-muted-foreground" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{album.title}</div>
                    <div className="text-xs text-muted-foreground truncate">{album.subtitle}</div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {tracks.length > 0 && (
            <div role="group">
              <div className="px-3 py-2 text-xs font-semibold text-foreground/70 bg-muted/50 flex items-center gap-2">
                <Music className="w-3 h-3" />
                Tracks
              </div>
              {tracks.map((track, idx: number) => (
                <button
                  key={`track-${track.id}`}
                  onClick={() => handleSearchResultClick('track', track.id, { album_id: track.album_id })}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left focus:outline-hidden ${
                    searchResultIndex === (movies.length + tvShows.length + episodes.length + artists.length + albums.length + idx) ? 'bg-primary/20 ring-2 ring-inset ring-primary' : 'hover:bg-muted/50'
                  }`}
                >
                  <Music className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{track.title}</div>
                    <div className="text-xs text-muted-foreground truncate">{track.artist_name} — {track.album_title}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {showSearchResults && searchInput.length >= 2 && !hasSearchResults && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-card border border-border rounded-lg shadow-2xl p-4 z-9999">
          <div className="text-sm text-muted-foreground text-center">No results found</div>
        </div>
      )}
    </div>
  )
}
