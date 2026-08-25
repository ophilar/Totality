import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Search, Check, Star, Calendar, Loader2 } from 'lucide-react'
import { useFocusTrap } from '@/hooks/useFocusTrap'

interface MetadataSearchResult {
  id: string
  provider: string
  title: string
  year?: number
  type: 'movie' | 'tv' | 'anime' | 'music' | 'artwork'
  posterUrl?: string
  bannerUrl?: string
  overview?: string
  score?: number
  network?: string
  status?: string
  country?: string
  originalLanguage?: string
  firstAirDate?: string
  releaseDate?: string
  externalIds?: {
    tmdbId?: number | string
    tvdbId?: number | string
    imdbId?: string
    anilistId?: number | string
    musicBrainzId?: string
  }
}

interface MusicBrainzArtistResult {
  id: string
  name: string
  sort_name?: string
  country?: string
  disambiguation?: string
  score: number
}

interface MusicBrainzReleaseResult {
  id: string
  title: string
  artist_credit?: string
  date?: string
  country?: string
  score: number
}

type SearchResult = MetadataSearchResult | MusicBrainzArtistResult | MusicBrainzReleaseResult

interface MatchFixModalProps {
  isOpen: boolean
  onClose: () => void
  type: 'series' | 'movie' | 'artist' | 'album'
  currentTitle: string
  currentYear?: number
  filePath?: string    // File path for context
  artistName?: string  // For album searches
  sourceId?: string    // For series
  mediaItemId?: number // For movies
  artistId?: number    // For artists
  albumId?: number     // For albums
  onMatchFixed?: () => void
}

export function MatchFixModal({
  isOpen,
  onClose,
  type,
  currentTitle,
  currentYear: _currentYear,
  filePath,
  artistName,
  sourceId,
  mediaItemId,
  artistId,
  albumId,
  onMatchFixed,
}: MatchFixModalProps) {
  const [searchQuery, setSearchQuery] = useState(currentTitle)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [isFixing, setIsFixing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null)
  const [expandedOverviews, setExpandedOverviews] = useState<Record<number, boolean>>({})
  const modalRef = useRef<HTMLDivElement>(null!)

  // Focus trap
  useFocusTrap(isOpen, modalRef as React.RefObject<HTMLElement>)

  const [includeExpanded, setIncludeExpanded] = useState(false)

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSearchQuery(currentTitle)
      setSearchResults([])
      setSelectedResult(null)
      setError(null)
      setIncludeExpanded(false)
      setExpandedOverviews({})

      async function checkExpandedMatching() {
        if (type === 'movie' && mediaItemId) {
          try {
            const item = (await window.electronAPI.getMediaItem(mediaItemId)) as {
              source_id?: string
              library_id?: string
            } | null
            if (item?.source_id && item?.library_id) {
              const libs = await window.electronAPI.sourcesGetLibrariesWithStatus(item.source_id)
              const lib = libs.find(
                (l) => l.id === item.library_id
              ) as { isProtected?: boolean; allowExpandedMatching?: boolean } | undefined
              if (lib?.isProtected && lib?.allowExpandedMatching) {
                setIncludeExpanded(true)
              }
            }
          } catch (e) {
            console.error('Failed to check expanded matching status:', e)
          }
        }
      }
      checkExpandedMatching()
    }
  }, [isOpen, currentTitle, type, mediaItemId])

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return

    window.electronAPI.log.info(
      '[MatchFixModal]',
      '[MatchFixModal] Searching for:',
      searchQuery,
      'type:',
      type
    )
    setIsSearching(true)
    setError(null)
    setSearchResults([])
    setExpandedOverviews({})

    try {
      let results: SearchResult[] = []

      switch (type) {
        case 'series':
        case 'movie':
          results = await window.electronAPI.mediaSearchMetadata(
            searchQuery,
            type === 'movie' ? 'movie' : 'tv',
            includeExpanded
          )
          break
        case 'artist':
          results = await window.electronAPI.mediaSearchMetadata(searchQuery, 'music')
          break
        case 'album':
          if (artistName) results = await window.electronAPI.mediaSearchMetadata(searchQuery, 'music', undefined, artistName)
          break
      }

      window.electronAPI.log.info('[MatchFixModal]', '[MatchFixModal] Got results:', results.length, results)
      setSearchResults(results)
    } catch (err: unknown) {
      window.electronAPI.log.error('[MatchFixModal]', '[MatchFixModal] Search error:', err)
      setError((err as Error).message || 'Search failed')
    } finally {
      setIsSearching(false)
    }
  }, [searchQuery, type, artistName, includeExpanded])

  const handleFixMatch = useCallback(async () => {
    if (!selectedResult) return

    setIsFixing(true)
    setError(null)

    try {
      switch (type) {
        case 'series':
          if (sourceId) {
            await window.electronAPI.seriesFixMatch(
              currentTitle,
              sourceId,
              (selectedResult as MetadataSearchResult).provider,
              (selectedResult as MetadataSearchResult).id
            )
          }
          break
        case 'movie':
          if (mediaItemId !== undefined) {
            await window.electronAPI.movieFixMatch(
              mediaItemId,
              (selectedResult as MetadataSearchResult).provider,
              (selectedResult as MetadataSearchResult).id
            )
          }
          break
        case 'artist':
          if (artistId !== undefined) {
            await window.electronAPI.musicFixArtistMatch(
              artistId,
              (selectedResult as MusicBrainzArtistResult).id
            )
          }
          break
        case 'album':
          if (albumId !== undefined) {
            await window.electronAPI.musicFixAlbumMatch(
              albumId,
              (selectedResult as MusicBrainzReleaseResult).id
            )
          }
          break
      }

      onMatchFixed?.()
      onClose()
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to fix match')
    } finally {
      setIsFixing(false)
    }
  }, [selectedResult, type, currentTitle, sourceId, mediaItemId, artistId, albumId, onMatchFixed, onClose])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'Enter' && !isSearching) {
      handleSearch()
    }
  }

  const toggleExpandOverview = (index: number, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpandedOverviews((prev) => ({
      ...prev,
      [index]: !prev[index]
    }))
  }

  const getTypeLabel = () => {
    switch (type) {
      case 'series': return 'TV Show'
      case 'movie': return 'Movie'
      case 'artist': return 'Artist'
      case 'album': return 'Album'
    }
  }

  const getResultTitle = (result: SearchResult): string => {
    if ('title' in result && result.title) return result.title
    if ('name' in result && result.name) return result.name
    return 'Unknown'
  }

  const getResultYear = (result: SearchResult): string | null => {
    if ('firstAirDate' in result && result.firstAirDate) {
      return result.firstAirDate
    }
    if ('releaseDate' in result && result.releaseDate) {
      return result.releaseDate
    }
    if ('year' in result && result.year) {
      return result.year.toString()
    }
    if ('date' in result && result.date) {
      return result.date.split('-')[0]
    }
    return null
  }

  const getResultScore = (result: SearchResult): number => {
    if ('score' in result && result.score !== undefined) {
      // If it's a MetadataSearchResult, score is usually 0-10. If it's MusicBrainz, it's 0-100.
      if ('provider' in result) return result.score
      return result.score / 10
    }
    return 0
  }

  const getResultPoster = (result: SearchResult): string | null => {
    if ('posterUrl' in result) return result.posterUrl || null
    return null
  }

  const getResultSubtitle = (result: SearchResult): string | null => {
    if ('disambiguation' in result && result.disambiguation) {
      return result.disambiguation
    }
    if ('country' in result && result.country && !('firstAirDate' in result || 'provider' in result)) {
      return result.country
    }
    if ('artist_credit' in result && result.artist_credit) {
      return result.artist_credit
    }
    return null
  }

  if (!isOpen) return null

  return createPortal(
    <div
      className="fixed inset-0 z-200 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        className="bg-card rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border/30 bg-sidebar-gradient rounded-t-xl">
          <div className="min-w-0 flex-1 mr-4">
            <h2 className="text-lg font-semibold">Fix {getTypeLabel()} Match</h2>
            <p className="text-sm text-muted-foreground">
              Current: <span className="text-foreground">{currentTitle}</span>
            </p>
            {filePath && (
              <p className="text-xs text-muted-foreground/70 truncate mt-1" title={filePath}>
                {filePath}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-md hover:bg-muted transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-border/30">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Search for ${getTypeLabel().toLowerCase()}...`}
                className="w-full pl-10 pr-4 py-2 bg-background border border-border rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-primary"
                autoFocus
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={isSearching || !searchQuery.trim()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isSearching ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              Search
            </button>
          </div>

          {error && (
            <p className="mt-2 text-sm text-red-500">{error}</p>
          )}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-4">
          {searchResults.length === 0 && !isSearching && (
            <div className="text-center text-muted-foreground py-8">
              {searchQuery ? 'No results found. Try a different search.' : 'Enter a search query to find matches.'}
            </div>
          )}

          <div className="space-y-2">
            {searchResults.map((result, index) => {
              const isSelected = selectedResult === result
              const title = getResultTitle(result)
              const dateOrYear = getResultYear(result)
              const score = getResultScore(result)
              const poster = getResultPoster(result)
              const subtitle = getResultSubtitle(result)
              const isMetadataResult = 'provider' in result
              const metaResult = isMetadataResult ? (result as MetadataSearchResult) : null

              return (
                <div
                  key={index}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedResult(result)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setSelectedResult(result)
                    }
                  }}
                  className={`w-full flex items-start gap-3 p-3 rounded-lg text-left transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-primary/20 border-2 border-primary'
                      : 'bg-muted/30 hover:bg-muted/50 border-2 border-transparent'
                  }`}
                >
                  {/* Poster/Thumbnail */}
                  <div className="w-12 h-16 shrink-0 bg-muted rounded overflow-hidden">
                    {poster ? (
                      <img
                        src={poster}
                        alt={title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                        No Image
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-medium truncate">{title}</div>
                      {isSelected && (
                        <Check className="w-5 h-5 text-primary shrink-0" />
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 mt-1 text-sm text-muted-foreground">
                      {dateOrYear && (
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {dateOrYear}
                        </span>
                      )}
                      {score > 0 && (
                        <span className="flex items-center gap-1">
                          <Star className="w-3 h-3 text-yellow-500" />
                          {score.toFixed(1)}
                        </span>
                      )}
                      {metaResult?.network && (
                        <span className="px-1.5 py-0.5 rounded bg-secondary text-[10px] font-medium text-secondary-foreground">
                          {metaResult.network}
                        </span>
                      )}
                      {metaResult?.country && (
                        <span className="px-1.5 py-0.5 rounded bg-secondary text-[10px] font-medium text-secondary-foreground">
                          {metaResult.country}
                        </span>
                      )}
                      {metaResult?.status && (
                        <span className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-medium text-muted-foreground border border-border/40">
                          {metaResult.status}
                        </span>
                      )}
                      {metaResult?.originalLanguage && (
                        <span className="px-1.5 py-0.5 rounded bg-secondary/60 text-[10px] uppercase text-muted-foreground">
                          {metaResult.originalLanguage}
                        </span>
                      )}
                      {subtitle && (
                        <span className="truncate text-xs">{subtitle}</span>
                      )}
                    </div>

                    {metaResult?.externalIds && Object.values(metaResult.externalIds).some(Boolean) && (
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        {metaResult.externalIds.tmdbId && (
                          <span className="px-1.5 py-0.5 rounded bg-muted/60 font-mono text-[10px] text-muted-foreground border border-border/30">
                            TMDB: {metaResult.externalIds.tmdbId}
                          </span>
                        )}
                        {metaResult.externalIds.tvdbId && (
                          <span className="px-1.5 py-0.5 rounded bg-muted/60 font-mono text-[10px] text-muted-foreground border border-border/30">
                            TVDB: {metaResult.externalIds.tvdbId}
                          </span>
                        )}
                        {metaResult.externalIds.imdbId && (
                          <span className="px-1.5 py-0.5 rounded bg-muted/60 font-mono text-[10px] text-muted-foreground border border-border/30">
                            IMDb: {metaResult.externalIds.imdbId}
                          </span>
                        )}
                        {metaResult.externalIds.anilistId && (
                          <span className="px-1.5 py-0.5 rounded bg-muted/60 font-mono text-[10px] text-muted-foreground border border-border/30">
                            AniList: {metaResult.externalIds.anilistId}
                          </span>
                        )}
                        {metaResult.externalIds.musicBrainzId && (
                          <span className="px-1.5 py-0.5 rounded bg-muted/60 font-mono text-[10px] text-muted-foreground border border-border/30">
                            MusicBrainz: {metaResult.externalIds.musicBrainzId}
                          </span>
                        )}
                      </div>
                    )}

                    {'overview' in result && result.overview && (
                      <div className="mt-1.5">
                        <p className={`text-xs text-muted-foreground ${expandedOverviews[index] ? '' : 'line-clamp-2'}`}>
                          {result.overview}
                        </p>
                        {result.overview.length > 80 && (
                          <button
                            type="button"
                            onClick={(e) => toggleExpandOverview(index, e)}
                            className="inline-block text-[10px] text-primary hover:underline mt-0.5 font-medium cursor-pointer"
                          >
                            {expandedOverviews[index] ? 'Show less' : 'Show more'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-border/30">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleFixMatch}
            disabled={!selectedResult || isFixing}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isFixing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            Apply Match
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
