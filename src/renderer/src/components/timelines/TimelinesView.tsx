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
  RefreshCw,
} from 'lucide-react'
import { useSources } from '@/contexts/useSources'
import { useToast } from '@/contexts/ToastContext'
import type { TimelineRecipeSummary } from '@main/services/timelines/ITimelineRecipeProvider'
import type { ResolvedTimelineResult } from '@main/services/timelines/TimelineResolutionEngine'
import type { PlexPlaylistSummary } from '@main/services/timelines/PlexPlaylistSyncService'

export function TimelinesView() {
  const { sources, activeSourceId } = useSources()
  const { addToast } = useToast()

  const [recipes, setRecipes] = useState<TimelineRecipeSummary[]>([])
  const [selectedRecipeId, setSelectedRecipeId] = useState<string>('star-trek-chronological')
  const [selectedTimelineResult, setSelectedTimelineResult] = useState<ResolvedTimelineResult | null>(null)
  const [existingPlaylists, setExistingPlaylists] = useState<PlexPlaylistSummary[]>([])
  const [isLoadingRecipes, setIsLoadingRecipes] = useState(false)
  const [isResolvingTimeline, setIsResolvingTimeline] = useState(false)
  const [isSyncingPlaylist, setIsSyncingPlaylist] = useState(false)
  const [isRefreshingWeb, setIsRefreshingWeb] = useState(false)
  const [customImportInput, setCustomImportInput] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const [recipeSearchQuery, setRecipeSearchQuery] = useState('')
  const [filterMode, setFilterMode] = useState<'all' | 'matched' | 'missing'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [customPlaylistTitle, setCustomPlaylistTitle] = useState('')

  // Filter sources for Plex providers
  const plexSources = useMemo(
    () => sources.filter((s) => s.source_type === 'plex' && s.is_enabled),
    [sources]
  )

  const selectedPlexSourceId = useMemo(() => {
    if (activeSourceId && plexSources.some((s) => s.source_id === activeSourceId)) {
      return activeSourceId
    }
    return plexSources[0]?.source_id
  }, [activeSourceId, plexSources])

  const resolveSourceId = activeSourceId || undefined
  const visibleExistingPlaylists = selectedPlexSourceId ? existingPlaylists : []

  useEffect(() => {
    if (!selectedPlexSourceId) {
      return
    }
    let isMounted = true
    const fetchExistingPlaylists = async () => {
      try {
        const playlists = await window.electronAPI.timelinesGetPlexPlaylists(selectedPlexSourceId)
        if (isMounted) setExistingPlaylists(playlists)
      } catch {
        if (isMounted) setExistingPlaylists([])
      }
    }
    void fetchExistingPlaylists()
    return () => {
      isMounted = false
    }
  }, [selectedPlexSourceId])

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
        const result = await window.electronAPI.timelinesResolveTimeline(selectedRecipeId, resolveSourceId)
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
  }, [selectedRecipeId, resolveSourceId, addToast])

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault()
    const input = customImportInput.trim()
    if (!input) return

    setIsImporting(true)
    try {
      const timeline = await window.electronAPI.timelinesGetRecipe(input)
      setSelectedRecipeId(timeline.id)
      const sourceType: TimelineRecipeSummary['sourceType'] = input.startsWith('http')
        ? 'web'
        : timeline.id.startsWith('trakt-')
        ? 'trakt'
        : 'preset'

      setRecipes((prev) => [
        {
          id: timeline.id,
          name: timeline.name,
          franchise: timeline.franchise,
          description: timeline.description,
          totalItems: timeline.items.length,
          sourceType,
        },
        ...prev.filter((r) => r.id !== timeline.id),
      ])
      addToast({
        type: 'success',
        title: 'Timeline Imported',
        message: `Successfully loaded '${timeline.name}' (${timeline.items.length} items)`,
      })
      setCustomImportInput('')
    } catch (err: unknown) {
      addToast({
        type: 'error',
        title: 'Timeline Import Failed',
        message: `Failed to import viewing order: ${err instanceof Error ? err.message : String(err)}`,
      })
    } finally {
      setIsImporting(false)
    }
  }

  const handleSyncToPlex = async () => {
    if (!selectedPlexSourceId) {
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
        sourceId: selectedPlexSourceId,
        recipeId: selectedRecipeId,
        playlistTitle: customPlaylistTitle.trim() || selectedTimelineResult.timeline.name,
      })

      addToast({
        type: 'success',
        title: 'Playlist Synced',
        message: `Successfully synced playlist '${result.playlistTitle}' with ${result.matchedItemsSynced} items to Plex!`,
      })

      // Refresh existing playlists so new playlist appears in dropdown immediately
      try {
        const updatedPlaylists = await window.electronAPI.timelinesGetPlexPlaylists(selectedPlexSourceId)
        setExistingPlaylists(updatedPlaylists)
      } catch {
        // Non-fatal
      }
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

  const isWebImportedRecipe = useMemo(() => {
    const r = recipes.find((rec) => rec.id === selectedRecipeId)
    return r?.sourceType === 'web' || r?.sourceType === 'trakt' || selectedRecipeId.startsWith('web-') || selectedRecipeId.startsWith('trakt-')
  }, [recipes, selectedRecipeId])

  const handleRefresh = async () => {
    if (!selectedTimelineResult) return
    setIsRefreshingWeb(true)
    try {
      if (isWebImportedRecipe && selectedTimelineResult.timeline.sourceUrl) {
        const freshTimeline = await window.electronAPI.timelinesGetRecipe(selectedTimelineResult.timeline.sourceUrl)
        const result = await window.electronAPI.timelinesResolveTimeline(freshTimeline.id, resolveSourceId)
        setSelectedTimelineResult(result)
        addToast({
          type: 'success',
          title: 'Timeline Refreshed',
          message: `Successfully refreshed '${freshTimeline.name}' (${result.totalCount} items).`,
        })
      } else {
        // Preset / Canonical timeline: re-resolve local library matches
        const result = await window.electronAPI.timelinesResolveTimeline(selectedRecipeId, resolveSourceId)
        setSelectedTimelineResult(result)
        addToast({
          type: 'success',
          title: 'Timeline Re-resolved',
          message: `Successfully re-checked local library matches for '${result.timeline.name}' (${result.matchedCount}/${result.totalCount} matched).`,
        })
      }
    } catch (err: unknown) {
      addToast({
        type: 'error',
        title: 'Refresh Failed',
        message: `Failed to refresh timeline: ${err instanceof Error ? err.message : String(err)}`,
      })
    } finally {
      setIsRefreshingWeb(false)
    }
  }

  const filteredRecipes = useMemo(() => {
    if (!recipeSearchQuery.trim()) return recipes
    const q = recipeSearchQuery.toLowerCase()
    return recipes.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.franchise.toLowerCase().includes(q) ||
        (r.description && r.description.toLowerCase().includes(q))
    )
  }, [recipes, recipeSearchQuery])

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
    <div className="flex flex-row h-full overflow-hidden bg-background text-foreground">
      {/* Left Column / Master List Pane */}
      <div className="w-80 sm:w-88 border-r border-border flex flex-col shrink-0 bg-card/30">
        {/* Header & Master Search */}
        <div className="p-4 border-b border-border space-y-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <ListOrdered className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight">Franchise Timelines & Playlists</h1>
              <p className="text-xs text-muted-foreground">Curated franchise viewing orders</p>
            </div>
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={recipeSearchQuery}
              onChange={(e) => setRecipeSearchQuery(e.target.value)}
              placeholder="Search recipes or franchise..."
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        {/* Scrollable Master Recipe List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {isLoadingRecipes && recipes.length === 0 ? (
            <div className="py-8 flex flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              <span>Loading recipes...</span>
            </div>
          ) : filteredRecipes.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              No matching timeline recipes found.
            </div>
          ) : (
            filteredRecipes.map((recipe) => {
              const isSelected = recipe.id === selectedRecipeId
              const sourceBadge =
                recipe.sourceType === 'web'
                  ? 'Web Guide'
                  : recipe.sourceType === 'trakt'
                  ? 'Trakt'
                  : recipe.sourceType === 'ai'
                  ? 'AI Curated'
                  : 'Curated Preset'

              return (
                <button
                  key={recipe.id}
                  onClick={() => setSelectedRecipeId(recipe.id)}
                  className={`w-full p-3 rounded-xl text-left border transition-all flex flex-col justify-between cursor-pointer ${
                    isSelected
                      ? 'border-primary bg-primary/5 shadow-xs ring-1 ring-primary/20'
                      : 'border-border bg-card/60 hover:border-border/80 hover:bg-card'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">
                        {recipe.franchise}
                      </span>
                      <span className="text-[10px] font-medium text-muted-foreground">{sourceBadge}</span>
                    </div>
                    <h3 className="text-xs font-semibold text-foreground line-clamp-1">{recipe.name}</h3>
                    {recipe.description && (
                      <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{recipe.description}</p>
                    )}
                  </div>
                  <div className="mt-2 text-right">
                    <span className="text-[10px] text-muted-foreground font-mono">{recipe.totalItems} items</span>
                  </div>
                </button>
              )
            })
          )}
        </div>

        {/* Universal Importer Footer */}
        <div className="p-3 border-t border-border bg-card/50 shrink-0">
          <form onSubmit={handleImport} className="space-y-2">
            <input
              type="text"
              value={customImportInput}
              onChange={(e) => setCustomImportInput(e.target.value)}
              placeholder="Web Guide URL, Trakt, or AI..."
              className="w-full px-3 py-1.5 text-xs rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              type="submit"
              disabled={isImporting || !customImportInput.trim()}
              className="w-full py-1.5 px-3 text-xs font-medium rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground flex items-center justify-center gap-1 disabled:opacity-50 transition-colors cursor-pointer"
            >
              {isImporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />}
              Import Recipe
            </button>
          </form>
        </div>
      </div>

      {/* Right Column / Detail View Area */}
      <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden p-6 space-y-4">
        {isResolvingTimeline && !selectedTimelineResult ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <p className="text-xs">Resolving timeline against local library...</p>
          </div>
        ) : selectedTimelineResult ? (
          <>
            {/* Sync Control & Stats Card */}
            <div className="p-5 rounded-2xl border border-border bg-card/60 backdrop-blur-md shadow-xs shrink-0">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                <div className="space-y-2 flex-1">
                  <div className="flex flex-wrap items-center gap-3">
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
                    <button
                      onClick={handleRefresh}
                      disabled={isRefreshingWeb || isResolvingTimeline}
                      title={isWebImportedRecipe ? 'Re-fetch and update this viewing order live from web' : 'Re-check local library matches'}
                      className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 px-2 py-0.5 rounded-md hover:bg-secondary transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3 h-3 ${isRefreshingWeb ? 'animate-spin text-primary' : ''}`} />
                      <span>{isRefreshingWeb ? 'Refreshing...' : isWebImportedRecipe ? 'Update from Web' : 'Re-check Library'}</span>
                    </button>
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
                <div className="flex flex-col gap-2 p-3.5 rounded-xl bg-background/60 border border-border">
                  <div className="flex flex-col sm:flex-row items-start sm:items-end gap-3">
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-muted-foreground">Select or Name Plex Playlist</label>
                      <div className="flex items-center gap-2">
                        <select
                          value={visibleExistingPlaylists.some(p => p.title === customPlaylistTitle) ? customPlaylistTitle : 'custom-playlist-mode'}
                          onChange={(e) => {
                            if (e.target.value !== 'custom-playlist-mode') {
                              setCustomPlaylistTitle(e.target.value)
                            }
                          }}
                          className="px-3 py-1.5 text-xs rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary min-w-44"
                        >
                          <option value="custom-playlist-mode">-- Create New / Custom Playlist --</option>
                          {visibleExistingPlaylists.map((pl) => (
                            <option key={pl.ratingKey} value={pl.title}>
                              {pl.title} ({pl.leafCount ?? 0} items)
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={customPlaylistTitle}
                          onChange={(e) => setCustomPlaylistTitle(e.target.value)}
                          placeholder="Playlist Title"
                          className="px-3 py-1.5 text-xs rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary w-48"
                        />
                      </div>
                    </div>

                    <div>
                      <button
                        onClick={handleSyncToPlex}
                        disabled={isSyncingPlaylist || isResolvingTimeline || selectedTimelineResult.matchedCount === 0 || !customPlaylistTitle.trim()}
                        className="px-4 py-2 text-xs font-semibold rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground flex items-center gap-2 shadow-xs disabled:opacity-50 transition-all cursor-pointer"
                      >
                        {isSyncingPlaylist ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        Sync to Plex Playlist
                      </button>
                    </div>
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
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-1.5 p-1 bg-secondary/50 rounded-xl border border-border w-fit">
                <button
                  onClick={() => setFilterMode('all')}
                  className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                    filterMode === 'all' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  All ({selectedTimelineResult.totalCount})
                </button>
                <button
                  onClick={() => setFilterMode('matched')}
                  className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                    filterMode === 'matched'
                      ? 'bg-background shadow-xs text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Matched ({selectedTimelineResult.matchedCount})
                </button>
                <button
                  onClick={() => setFilterMode('missing')}
                  className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
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

            {/* Items Table with Dedicated Scroll Container */}
            <div className="flex-1 min-h-0 border border-border rounded-2xl overflow-hidden bg-card/40 backdrop-blur-md flex flex-col">
              <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="sticky top-0 z-10 bg-secondary border-b border-border text-muted-foreground font-semibold shadow-xs">
                    <tr>
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
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground text-xs">
            Select a timeline recipe from the left column to view details.
          </div>
        )}
      </div>
    </div>
  )
}
