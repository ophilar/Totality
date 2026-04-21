

import { Search, X, Film, Tv, User, Disc3, Music, CircleFadingArrowUp } from 'lucide-react'
import { MoviePlaceholder, TvPlaceholder, EpisodePlaceholder } from '../../ui/MediaPlaceholders'
import type { MediaItem, MusicArtist, MusicAlbum, MusicTrack } from '../../../../../main/types/database'

interface SearchAutocompleteProps {
  searchInput: string
  setSearchInput: (val: string) => void
  showSearchResults: boolean
  setShowSearchResults: (val: boolean) => void
  searchResultIndex: number
  setSearchResultIndex: (idx: number) => void
  searchContainerRef: React.RefObject<HTMLDivElement>
  searchInputRef: React.RefObject<HTMLInputElement>
  globalSearchResults: any
  hasSearchResults: boolean
  flattenedResults: any[]
  handleSearchKeyDown: (e: React.KeyboardEvent) => void
  handleSearchResultClick: (type: any, id: any, extra?: any) => void
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
        }}
        onFocus={() => setShowSearchResults(true)}
        onKeyDown={handleSearchKeyDown}
        className="w-full pl-10 pr-8 py-2 bg-muted/50 border border-border/50 rounded-lg text-sm placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-primary"
        aria-label="Search all libraries"
        aria-autocomplete="list"
      />
      {searchInput && (
        <button
          onClick={() => {
            setSearchInput('')
            setShowSearchResults(false)
            setSearchResultIndex(-1)
          }}
          className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground z-10 focus:outline-hidden focus:ring-2 focus:ring-primary rounded"
          aria-label="Clear search"
        >
          <X className="w-4 h-4" />
        </button>
      )}

      {/* Search Results Dropdown */}
      {showSearchResults && searchInput.length >= 2 && hasSearchResults && (
        <div
          role="listbox"
          className="absolute top-full left-0 right-0 mt-2 bg-card border border-border rounded-lg shadow-2xl overflow-hidden z-9999 max-h-[400px] overflow-y-auto"
        >
          {/* Movies */}
          {globalSearchResults.movies.length > 0 && (
            <div role="group">
              <div className="px-3 py-2 text-xs font-semibold text-foreground/70 bg-muted/50 flex items-center gap-2">
                <Film className="w-3 h-3" />
                Movies
              </div>
              {globalSearchResults.movies.map((movie: MediaItem, idx: number) => (
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
          {globalSearchResults.tvShows.length > 0 && (
            <div role="group">
              <div className="px-3 py-2 text-xs font-semibold text-foreground/70 bg-muted/50 flex items-center gap-2">
                <Tv className="w-3 h-3" />
                TV Shows
              </div>
              {globalSearchResults.tvShows.map((show: any, idx: number) => (
                <button
                  key={`tv-${show.id}`}
                  onClick={() => handleSearchResultClick('tv', show.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left focus:outline-hidden ${
                    searchResultIndex === (globalSearchResults.movies.length + idx) ? 'bg-primary/20 ring-2 ring-inset ring-primary' : 'hover:bg-muted/50'
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
          {globalSearchResults.episodes.length > 0 && (
            <div role="group">
              <div className="px-3 py-2 text-xs font-semibold text-foreground/70 bg-muted/50 flex items-center gap-2">
                <Tv className="w-3 h-3" />
                Episodes
              </div>
              {globalSearchResults.episodes.map((episode: MediaItem, idx: number) => (
                <button
                  key={`episode-${episode.id}`}
                  onClick={() => handleSearchResultClick('episode', episode.id, { series_title: episode.series_title })}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left focus:outline-hidden ${
                    searchResultIndex === (globalSearchResults.movies.length + globalSearchResults.tvShows.length + idx) ? 'bg-primary/20 ring-2 ring-inset ring-primary' : 'hover:bg-muted/50'
                  }`}
                >
                  {episode.episode_thumb_url ? (
                    <img src={episode.episode_thumb_url} alt="" className="w-12 h-8 object-cover rounded" />
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
          {globalSearchResults.artists.length > 0 && (
            <div role="group">
              <div className="px-3 py-2 text-xs font-semibold text-foreground/70 bg-muted/50 flex items-center gap-2">
                <User className="w-3 h-3" />
                Artists
              </div>
              {globalSearchResults.artists.map((artist: MusicArtist, idx: number) => (
                <button
                  key={`artist-${artist.id}`}
                  onClick={() => handleSearchResultClick('artist', artist.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left focus:outline-hidden ${
                    searchResultIndex === (globalSearchResults.movies.length + globalSearchResults.tvShows.length + globalSearchResults.episodes.length + idx) ? 'bg-primary/20 ring-2 ring-inset ring-primary' : 'hover:bg-muted/50'
                  }`}
                >
                  <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center shrink-0 overflow-hidden">
                    {artist.thumb_url ? <img src={artist.thumb_url} alt="" className="w-full h-full object-cover" /> : <User className="w-4 h-4 text-muted-foreground" />}
                  </div>
                  <div className="flex-1 min-w-0 font-medium text-sm truncate">{artist.name}</div>
                </button>
              ))}
            </div>
          )}

          {globalSearchResults.albums.length > 0 && (
            <div role="group">
              <div className="px-3 py-2 text-xs font-semibold text-foreground/70 bg-muted/50 flex items-center gap-2">
                <Disc3 className="w-3 h-3" />
                Albums
              </div>
              {globalSearchResults.albums.map((album: MusicAlbum, idx: number) => (
                <button
                  key={`album-${album.id}`}
                  onClick={() => handleSearchResultClick('album', album.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left focus:outline-hidden ${
                    searchResultIndex === (globalSearchResults.movies.length + globalSearchResults.tvShows.length + globalSearchResults.episodes.length + globalSearchResults.artists.length + idx) ? 'bg-primary/20 ring-2 ring-inset ring-primary' : 'hover:bg-muted/50'
                  }`}
                >
                  <div className="w-8 h-8 bg-muted rounded overflow-hidden shrink-0">
                    {album.thumb_url ? <img src={album.thumb_url} alt="" className="w-full h-full object-cover" /> : <Disc3 className="w-4 h-4 text-muted-foreground" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{album.title}</div>
                    <div className="text-xs text-muted-foreground truncate">{album.artist_name}</div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {globalSearchResults.tracks.length > 0 && (
            <div role="group">
              <div className="px-3 py-2 text-xs font-semibold text-foreground/70 bg-muted/50 flex items-center gap-2">
                <Music className="w-3 h-3" />
                Tracks
              </div>
              {globalSearchResults.tracks.map((track: MusicTrack, idx: number) => (
                <button
                  key={`track-${track.id}`}
                  onClick={() => handleSearchResultClick('track', track.id, { album_id: track.album_id })}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left focus:outline-hidden ${
                    searchResultIndex === (globalSearchResults.movies.length + globalSearchResults.tvShows.length + globalSearchResults.episodes.length + globalSearchResults.artists.length + globalSearchResults.albums.length + idx) ? 'bg-primary/20 ring-2 ring-inset ring-primary' : 'hover:bg-muted/50'
                  }`}
                >
                  <Music className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{track.title}</div>
                    <div className="text-xs text-muted-foreground truncate">{track.artist_name} — {track.album_name}</div>
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
