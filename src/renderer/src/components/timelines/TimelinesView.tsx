import React, { useState, useEffect, useMemo } from 'react'
import {
  ListOrdered,
  Film,
  Tv,
  CheckCircle2,
  AlertCircle,
  Send,
  Loader2,
  ExternalLink,
  Info,
  Search,
} from 'lucide-react'
import { useSources } from '@/contexts/SourceContext'
import { useToast } from '@/contexts/ToastContext'
import type { TimelineRecipeSummary } from '@main/services/timelines/ITimelineRecipeProvider'
import type { ResolvedTimelineResult } from '@main/services/timelines/TimelineResolutionEngine'


export function TimelinesView() {
  const { sources, activeSourceId } = useSources()
  const { addToast } = useToast()

  const [recipes, setRecipes] = useState<TimelineRecipeSummary[]>([])
  const [selectedRecipeId, setSelectedRecipeId] = useState<string>('star-trek-chronological')
  const [selectedTimelineResult, setSelectedTimelineResult] = useState<ResolvedTimelineResult | null>(null)
  const [isLoadingRecipes, setIsLoadingRecipes] = useState(false)
  const [isResolvingTimeline, setIsResolvingTimeline] = useState(false)
  const [isSyncingPlaylist, setIsSyncingPlaylist] = useState(false)
  const [customTraktInput, setCustomTraktInput] = useState('')
  const [isLoadingTrakt, setIsLoadingTrakt] = useState(false)
  const [filterMode, setFilterMode] = useState<'all' | 'matched' | 'missing'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [customPlaylistTitle, setCustomPlaylistTitle] = useState('')

  // Filter sources for Plex providers
  const plexSources = useMemo(
    () => sources.filter((s) => s.source_type === 'plex' && s.is_enabled),
    [sources]
  )

  const selectedSourceId = useMemo(() => {
    if (activeSourceId && plexSources.some((s) => s.source_id === activeSourceId)) {
      return activeSourceId
    }
    return plexSources[0]?.source_id
  }, [activeSourceId, plexSources])

  useEffect(() => {
    let isMounted = true

    const fetchRecipes = async () => {
      setIsLoadingRecipes(true)
      try {
        const list = await window.electronAPI.timelinesListRecipes()
        if (!isMounted) return
        setRecipes(list)
        if (list.length > 0 && !selectedRecipeId) {
          setSelectedRecipeId(list[0].id)
        }
      } catch (err: unknown) {
        if (!isMounted) return
        addToast({
          type: 'error',
          title: 'Timeline Recipes',
          message: `Failed to load timeline recipes: ${err instanceof Error ? err.message : String(err)}`,
        })
      } finally {
        if (isMounted) {
          setIsLoadingRecipes(false)
        }
      }
    }

    void fetchRecipes()

    return () => {
      isMounted = false
    }
  }, [selectedRecipeId, addToast])

  useEffect(() => {
    if (!selectedRecipeId) return
    let isMounted = true

    const fetchResolvedTimeline = async () => {
      setIsResolvingTimeline(true)
      try {
        const result = await window.electronAPI.timelinesResolveTimeline(selectedRecipeId, selectedSourceId)
        if (!isMounted) return
        setSelectedTimelineResult(result)
        setCustomPlaylistTitle(result.timeline.name)
      } catch (err: unknown) {
        if (!isMounted) return
        addToast({
          type: 'error',
          title: 'Timeline Resolution',
          message: `Failed to resolve timeline '${selectedRecipeId}': ${err instanceof Error ? err.message : String(err)}`,
        })
      } finally {
        if (isMounted) {
          setIsResolvingTimeline(false)
        }
      }
    }

    void fetchResolvedTimeline()

    return () => {
      isMounted = false
    }
  }, [selectedRecipeId, selectedSourceId, addToast])


  const handleImportTrakt = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!customTraktInput.trim()) return

    setIsLoadingTrakt(true)
    try {
      const timeline = await window.electronAPI.timelinesGetRecipe(customTraktInput.trim())
      setSelectedRecipeId(timeline.id)
      setRecipes((prev) => [
        {
          id: timeline.id,
          name: timeline.name,
          franchise: timeline.franchise,
          description: timeline.description,
          totalItems: timeline.items.length,
          sourceType: 'trakt',
        },
        ...prev.filter((r) => r.id !== timeline.id),
      ])
      addToast({
        type: 'success',
        title: 'Trakt List Imported',
        message: `Successfully loaded Trakt timeline '${timeline.name}' (${timeline.items.length} items)`,
      })
      setCustomTraktInput('')
    } catch (err: unknown) {
      addToast({
        type: 'error',
        title: 'Trakt Import Failed',
        message: `Failed to load Trakt list: ${err instanceof Error ? err.message : String(err)}`,
      })
    } finally {
      setIsLoadingTrakt(false)
    }
  }

  const handleSyncToPlex = async () => {
    if (!selectedSourceId) {
      addToast({
        type: 'error',
        title: 'Sync Playlist',
        message: 'Please select an active Plex source to sync playlists.',
      })
      return
    }
    if (!selectedTimelineResult) return

    setIsSyncingPlaylist(true)
    try {
      const result = await window.electronAPI.timelinesSyncPlexPlaylist({
        sourceId: selectedSourceId,
        recipeId: selectedRecipeId,
        playlistTitle: customPlaylistTitle.trim() || selectedTimelineResult.timeline.name,
      })

      addToast({
        type: 'success',
        title: 'Playlist Synced',
        message: `Successfully synced playlist '${result.playlistTitle}' with ${result.matchedItemsSynced} items to Plex!`,
      })
    } catch (err: unknown) {
      addToast({
        type: 'error',
        title: 'Plex Sync Error',
        message: `Plex Playlist Sync failed: ${err instanceof Error ? err.message : String(err)}`,
      })
    } finally {
      setIsSyncingPlaylist(false)
    }
  }


  const displayedItems = useMemo(() => {
    if (!selectedTimelineResult) return []
    return selectedTimelineResult.items.filter((item) => {
      if (filterMode === 'matched' && item.status !== 'matched') return false
      if (filterMode === 'missing' && item.status !== 'missing') return false
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase()
        const matchTitle = item.title.toLowerCase().includes(query)
        const matchSeries = item.seriesTitle?.toLowerCase().includes(query)
        const matchEra = item.timelineEra?.toLowerCase().includes(query)
        return matchTitle || matchSeries || matchEra
      }
      return true
    })
  }, [selectedTimelineResult, filterMode, searchQuery])

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-background text-foreground">
      {/* Top Banner / Header */}
      <div className="p-6 border-b border-border bg-card/40 backdrop-blur-md">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-primary/10 text-primary">
                <ListOrdered className="w-6 h-6" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight">Franchise Timelines & Playlists</h1>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Curated chronological and air-date franchise orders with 1-click Plex playlist synchronization.
            </p>
          </div>

          {/* Trakt Importer & Plex Server Select */}
          <div className="flex items-center gap-3">
            <form onSubmit={handleImportTrakt} className="flex items-center gap-2">
              <input
                type="text"
                value={customTraktInput}
                onChange={(e) => setCustomTraktInput(e.target.value)}
                placeholder="Trakt list: username/list-slug"
                className="px-3 py-1.5 text-xs rounded-lg border border-border bg-background/80 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary w-56"
              />
              <button
                type="submit"
                disabled={isLoadingTrakt || !customTraktInput.trim()}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-secondary hover:bg-secondary/80 text-secondary-foreground flex items-center gap-1 disabled:opacity-50 transition-colors"
              >
                {isLoadingTrakt ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />}
                Import
              </button>
            </form>
          </div>
        </div>

        {/* Recipe Selection Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-6">
          {isLoadingRecipes && recipes.length === 0 ? (
            <div className="col-span-full py-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              <span>Loading franchise timeline recipes...</span>
            </div>
          ) : (
            recipes.map((recipe) => {
              const isSelected = recipe.id === selectedRecipeId
              return (
                <button
                  key={recipe.id}
                  onClick={() => setSelectedRecipeId(recipe.id)}
                  className={`p-3.5 rounded-xl text-left border transition-all flex flex-col justify-between ${
                    isSelected
                      ? 'border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20'
                      : 'border-border bg-card/60 hover:border-border/80 hover:bg-card'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">
                        {recipe.franchise}
                      </span>
                      <span className="text-xs text-muted-foreground font-mono">{recipe.totalItems} items</span>
                    </div>
                    <h3 className="text-sm font-semibold text-foreground line-clamp-1">{recipe.name}</h3>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{recipe.description}</p>
                  </div>
                </button>
              )
            })
          )}
        </div>

      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {selectedTimelineResult && (
          <>
            {/* Sync Control & Stats Card */}
            <div className="p-5 rounded-2xl border border-border bg-card/60 backdrop-blur-md shadow-sm">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                <div className="space-y-2 flex-1">
                  <div className="flex items-center gap-3">
                    <h2 className="text-lg font-bold">{selectedTimelineResult.timeline.name}</h2>
                    {selectedTimelineResult.timeline.sourceUrl && (
                      <a
                        href={selectedTimelineResult.timeline.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-primary hover:underline flex items-center gap-1"
                      >
                        Source <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{selectedTimelineResult.timeline.description}</p>

                  {/* Progress Bar */}
                  <div className="pt-2">
                    <div className="flex justify-between text-xs mb-1.5 font-medium">
                      <span>
                        Local Library Completeness: {selectedTimelineResult.matchedCount} /{' '}
                        {selectedTimelineResult.totalCount} ({selectedTimelineResult.completionPercentage}%)
                      </span>
                      <span className="text-muted-foreground">{selectedTimelineResult.missingCount} Missing</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all duration-500 rounded-full"
                        style={{ width: `${selectedTimelineResult.completionPercentage}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Playlist Sync Action Box */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-3.5 rounded-xl bg-background/60 border border-border">
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted-foreground">Plex Playlist Name</label>
                    <input
                      type="text"
                      value={customPlaylistTitle}
                      onChange={(e) => setCustomPlaylistTitle(e.target.value)}
                      placeholder="Playlist Title"
                      className="px-3 py-1.5 text-xs rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary w-60"
                    />
                  </div>

                  <div className="pt-4 sm:pt-0">
                    <button
                      onClick={handleSyncToPlex}
                      disabled={isSyncingPlaylist || isResolvingTimeline || selectedTimelineResult.matchedCount === 0}
                      className="px-4 py-2 text-xs font-semibold rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground flex items-center gap-2 shadow-sm disabled:opacity-50 transition-all cursor-pointer"
                    >
                      {isSyncingPlaylist ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      Sync to Plex Playlist
                    </button>
                  </div>
                </div>
              </div>

              {/* Watched State Note */}
              <div className="mt-4 pt-4 border-t border-border flex items-center gap-2 text-xs text-muted-foreground">
                <Info className="w-4 h-4 text-primary shrink-0" />
                <span>
                  <strong>Safe Sync Guarantee:</strong> Syncing manages Plex playlist entries only. Your watch history,
                  played scrobbles, and playback bookmarks remain 100% untouched.
                </span>
              </div>
            </div>

            {/* Filter and Search Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 p-1 bg-secondary/50 rounded-xl border border-border w-fit">
                <button
                  onClick={() => setFilterMode('all')}
                  className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${
                    filterMode === 'all' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  All ({selectedTimelineResult.totalCount})
                </button>
                <button
                  onClick={() => setFilterMode('matched')}
                  className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${
                    filterMode === 'matched'
                      ? 'bg-background shadow-xs text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Matched ({selectedTimelineResult.matchedCount})
                </button>
                <button
                  onClick={() => setFilterMode('missing')}
                  className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${
                    filterMode === 'missing'
                      ? 'bg-background shadow-xs text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Missing ({selectedTimelineResult.missingCount})
                </button>
              </div>

              <div className="relative w-full sm:w-72">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search timeline items..."
                  className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-border bg-card/60 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            {/* Items Table */}
            <div className="border border-border rounded-2xl overflow-hidden bg-card/40 backdrop-blur-md">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-border bg-secondary/30 text-muted-foreground font-semibold">
                      <th className="py-3 px-4 w-12 text-center">#</th>
                      <th className="py-3 px-4 w-20">Type</th>
                      <th className="py-3 px-4">Title / Series</th>
                      <th className="py-3 px-4 w-32">Timeline Era</th>
                      <th className="py-3 px-4 w-36">Identifiers</th>
                      <th className="py-3 px-4 w-44">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {displayedItems.map((item) => (
                      <tr key={`${item.order}-${item.title}`} className="hover:bg-muted/30 transition-colors">
                        <td className="py-3 px-4 text-center font-mono text-muted-foreground">{item.order}</td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold ${
                              item.type === 'movie'
                                ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
                                : 'bg-blue-500/10 text-blue-500 border border-blue-500/20'
                            }`}
                          >
                            {item.type === 'movie' ? <Film className="w-3 h-3" /> : <Tv className="w-3 h-3" />}
                            {item.type === 'movie' ? 'Movie' : 'Episode'}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-foreground">{item.title}</div>
                          {item.seriesTitle && (
                            <div className="text-muted-foreground text-[11px]">
                              {item.seriesTitle}
                              {item.seasonNumber !== undefined && item.episodeNumber !== undefined && (
                                <span className="font-mono ml-1">
                                  (S{String(item.seasonNumber).padStart(2, '0')}E
                                  {String(item.episodeNumber).padStart(2, '0')})
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-muted-foreground">
                          {item.timelineEra ? (
                            <span className="px-2 py-0.5 rounded-full bg-secondary text-[11px] font-medium">
                              {item.timelineEra}
                            </span>
                          ) : (
                            item.airDate || '-'
                          )}
                        </td>
                        <td className="py-3 px-4 text-[11px] font-mono text-muted-foreground">
                          {item.identifiers.tmdbId && <span className="mr-2">TMDB:{item.identifiers.tmdbId}</span>}
                          {item.identifiers.tvdbId && <span>TVDB:{item.identifiers.tvdbId}</span>}
                        </td>
                        <td className="py-3 px-4">
                          {item.status === 'matched' ? (
                            <div className="flex flex-col">
                              <span className="inline-flex items-center gap-1.5 text-emerald-500 font-semibold">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Matched
                              </span>
                              {item.matchedMediaItem && (
                                <span className="text-[10px] text-muted-foreground font-mono">
                                  {item.matchedMediaItem.resolution} • {item.matchedMediaItem.videoCodec.toUpperCase()}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                              <AlertCircle className="w-3.5 h-3.5 text-muted-foreground/60" />
                              Missing in Library
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
