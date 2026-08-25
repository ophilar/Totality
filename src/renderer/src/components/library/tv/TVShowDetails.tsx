import { useState, useEffect } from 'react'
import { Virtuoso } from 'react-virtuoso'
import { RefreshCw, Pencil, ChevronDown, ChevronUp, Copy, Check, Database, Zap } from 'lucide-react'
import { EpisodeRow } from '@/components/library/tv/EpisodeRow'
import { MissingEpisodeRowWithArtwork } from '@/components/library/tv/MissingEpisodeRowWithArtwork'
import { parseMissingEpisodes, parseMissingSeasons } from '@/components/library/tv/completenessParsing'
import { getStatusBadge, formatSeasonLabel, formatLanguage } from '@/components/library/mediaUtils'
import type { MediaItem, TVShow, TVShowSummary, SeriesCompletenessData, MissingEpisode } from '@/components/library/types'

export function TVShowDetails({
  selectedShow,
  selectedShowData,
  selectedShowLoading,
  seriesCompleteness,
  onBack,
  onAnalyzeSeries,
  onFixMatch,
  filterItem,
  onSelectEpisode,
  onRescanEpisode,
  onDismissUpgrade,
  expandedRecommendations,
  onToggleOptimize,
  onMissingItemClick,
  onDismissMissingEpisode,
  onDismissMissingSeason,
  onTranscodeShow
}: {
  selectedShow: string
  selectedShowData: TVShow | null
  selectedShowLoading: boolean
  seriesCompleteness: Map<string, SeriesCompletenessData>
  onBack: () => void
  onAnalyzeSeries: (seriesTitle: string) => Promise<void> | void
  onFixMatch?: (title: string, sourceId: string, folderPath?: string) => void
  filterItem: (item: MediaItem) => boolean
  onSelectEpisode: (id: number) => void
  onRescanEpisode?: (episode: MediaItem) => Promise<void>
  onDismissUpgrade?: (item: MediaItem) => void
  expandedRecommendations: Set<number>
  onToggleOptimize: (id: number) => void
  onMissingItemClick: (item: import('@/components/library/types').MissingItemPopupData) => void
  onDismissMissingEpisode?: (episode: MissingEpisode, seriesTitle: string, tmdbId?: string) => void
  onDismissMissingSeason?: (seasonNumber: number, seriesTitle: string, tmdbId?: string) => void
  onTranscodeShow?: (show: TVShowSummary) => void
}) {
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [showOverviewExpanded, setShowOverviewExpanded] = useState(false)
  const [copiedTitle, setCopiedTitle] = useState(false)
  const [showOverview, setShowOverview] = useState<string | null>(null)
  const [arrStatus, setArrStatus] = useState<'idle' | 'working' | 'success' | 'error'>('idle')
  const [audioLanguages, setAudioLanguages] = useState<string[]>([])

  useEffect(() => {
    queueMicrotask(() => { setShowOverviewExpanded(false); setCopiedTitle(false); setShowOverview(null); setAudioLanguages([]) })

    if (selectedShow) {
      const completenessData = seriesCompleteness.get(selectedShow)
      if (completenessData?.tmdb_id) {
        window.electronAPI.tmdbGetTVShowDetails(completenessData.tmdb_id)
          .then(details => { if (details?.overview) setShowOverview(details.overview) })
          .catch(() => { /* ignore */ })
      }

      if (window.electronAPI.seriesGetAudioLanguages) {
        window.electronAPI.seriesGetAudioLanguages(selectedShow)
          .then(langs => { if (Array.isArray(langs) && langs.length > 0) setAudioLanguages(langs) })
          .catch(() => { /* ignore */ })
      }
    }
  }, [selectedShow, seriesCompleteness])

  useEffect(() => {
    const completenessData = seriesCompleteness.get(selectedShow)
    const diagnostics = [
      parseMissingSeasons(completenessData?.missing_seasons).diagnostic,
      parseMissingEpisodes(completenessData?.missing_episodes).diagnostic,
    ].filter((diagnostic): diagnostic is NonNullable<typeof diagnostic> => diagnostic !== undefined)
    for (const diagnostic of diagnostics) {
      window.electronAPI.log.error('TVShowDetails', diagnostic.message, { seriesTitle: selectedShow, field: diagnostic.field })
    }
  }, [selectedShow, seriesCompleteness])

  if (selectedShowLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh]">
        <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground mb-4" />
        <p className="text-muted-foreground">Loading episodes...</p>
      </div>
    )
  }

  if (!selectedShowData) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] text-center">
        <button onClick={onBack} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          Back to TV Shows
        </button>
        <p className="text-muted-foreground">No episodes found for this show</p>
      </div>
    )
  }

  const ownedSeasons = Array.from(selectedShowData.seasons.values()).sort((a, b) => a.seasonNumber - b.seasonNumber)
  const completenessData = seriesCompleteness.get(selectedShow)
  const firstEpisode = ownedSeasons[0]?.episodes[0]

  const handleSonarrSearch = async () => {
    if (!completenessData?.tvdb_id) return
    const baseUrl = await window.electronAPI.getSetting('sonarr_url')
    const apiKey = await window.electronAPI.getSetting('sonarr_api_key')
    if (!baseUrl || !apiKey) return
    if (!window.confirm(`Ask Sonarr to search for a better release of “${selectedShowData.title}”?`)) return
    setArrStatus('working')
    try {
      const managed = await window.electronAPI.arrFindManagedSeries({ baseUrl, apiKey }, Number(completenessData.tvdb_id)) as { id?: number } | null
      if (!managed?.id) throw new Error('This series is not managed by Sonarr')
      const command = await window.electronAPI.arrSearchSeries({ baseUrl, apiKey }, managed.id) as { id?: number }
      if (!command.id) throw new Error('Sonarr did not return a command ID')
      await window.electronAPI.arrWaitForCommand({ baseUrl, apiKey }, command.id)
      setArrStatus('success')
    } catch (err: unknown) {
      setArrStatus('error')
      window.alert(`Sonarr Search Failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  const missingSeasonsResult = parseMissingSeasons(completenessData?.missing_seasons)
  const missingEpisodesResult = parseMissingEpisodes(completenessData?.missing_episodes)
  const parseDiagnostics = [missingSeasonsResult.diagnostic, missingEpisodesResult.diagnostic].filter(Boolean)

  // Build combined list of owned and missing seasons
  const allSeasonNumbers = [...new Set([...ownedSeasons.map(s => s.seasonNumber), ...missingSeasonsResult.value])].sort((a, b) => a - b)
  const missingEpisodes = missingEpisodesResult.value

  const totalSeasons = completenessData?.total_seasons || ownedSeasons.length

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to TV Shows
      </button>

      {/* Show Header */}
      <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 mb-6">
        {/* Poster */}
        {selectedShowData.poster_url && (
          <div className="w-28 sm:w-44 aspect-2/3 bg-muted rounded-lg overflow-hidden shrink-0 shadow-lg shadow-black/30">
            <img
              src={selectedShowData.poster_url}
              alt={selectedShowData.title}
              loading="lazy"
              className="w-full h-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}
            />
          </div>
        )}

        {/* Info */}
        <div className="flex-1 min-w-0">
          {/* Title */}
          <div className="flex items-center gap-1.5">
            <h3 className="text-2xl sm:text-3xl font-bold break-words">{selectedShowData.title}</h3>
            <button
              onClick={(e) => {
                e.stopPropagation()
                navigator.clipboard.writeText(selectedShowData.title)
                setCopiedTitle(true)
                setTimeout(() => setCopiedTitle(false), 1500)
              }}
              className="shrink-0 p-1 text-muted-foreground hover:text-foreground transition-colors"
              title="Copy title"
            >
              {copiedTitle ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>

          {/* Metadata line */}
          <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground flex-wrap">
            <span>{ownedSeasons.length} of {totalSeasons} Seasons</span>
            {firstEpisode?.original_language && (
              <>
                <span>•</span>
                <span>Original: {formatLanguage(firstEpisode.original_language)}</span>
              </>
            )}
            {audioLanguages.length > 0 && (
              <>
                <span>•</span>
                <span>Audio: {audioLanguages.map(l => formatLanguage(l)).join(', ')}</span>
              </>
            )}
            {completenessData?.status && (
              <>
                <span>•</span>
                <span>{getStatusBadge(completenessData.status)?.text || completenessData.status}</span>
              </>
            )}
          </div>

          {/* Action buttons row */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-3">
            <button
              onClick={async () => {
                if (!selectedShow || isAnalyzing) return
                setIsAnalyzing(true)
                try {
                  await onAnalyzeSeries(selectedShow)
                } finally {
                  setIsAnalyzing(false)
                }
              }}
              disabled={isAnalyzing}
              className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50 cursor-pointer"
              title="Analyze Series"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isAnalyzing ? 'animate-spin' : ''}`} />
              {isAnalyzing ? 'Analyzing...' : 'Analyze Series'}
            </button>
            {onTranscodeShow && (
              <button
                onClick={() => {
                  if (!selectedShowData) return
                  const allSeasons = Array.from(selectedShowData.seasons.values())
                  const firstEpisode = allSeasons[0]?.episodes[0]
                  const totalEpisodes = allSeasons.reduce((sum, s) => sum + s.episodes.length, 0)
                  const totalSeasons = selectedShowData.seasons.size
                  onTranscodeShow({
                    series_title: selectedShowData.title,
                    source_id: firstEpisode?.source_id || '',
                    poster_url: selectedShowData.poster_url,
                    original_language: firstEpisode?.original_language || null,
                    season_count: totalSeasons,
                    episode_count: totalEpisodes,
                    total_seasons: totalSeasons,
                    total_episodes: totalEpisodes,
                  })
                }}
                className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary/15 text-primary hover:bg-primary/25 border border-primary/30 rounded-md font-semibold transition-colors cursor-pointer"
                title="Optimize entire TV series with hardware transcoding"
              >
                <Zap className="w-3.5 h-3.5 fill-current text-primary" />
                Optimize Series
              </button>
            )}
            {onFixMatch && (
              <button
                onClick={() => selectedShow && onFixMatch(selectedShow, '', undefined)}
                className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                title="Fix Match"
              >
                <Pencil className="w-4 h-4" />
              </button>
            )}
            {completenessData?.tvdb_id && (
              <button onClick={handleSonarrSearch} disabled={arrStatus === 'working'} className="flex items-center gap-2 px-3 py-1.5 text-sm bg-muted rounded-md hover:bg-muted/80 disabled:opacity-50" title="Search in Sonarr">
                {arrStatus === 'working' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
                {arrStatus === 'working' ? 'Searching...' : 'Search in Sonarr'}
              </button>
            )}
          </div>

          {/* Overview */}
          {showOverview && (
            <div className="mt-3 max-w-2xl">
              <p className={`text-sm text-muted-foreground leading-relaxed ${showOverviewExpanded ? '' : 'line-clamp-3'}`}>
                {showOverview}
              </p>
              <button
                onClick={() => setShowOverviewExpanded(!showOverviewExpanded)}
                className="flex items-center gap-1 text-sm text-primary hover:text-primary/80 mt-1 transition-colors"
              >
                {showOverviewExpanded ? (
                  <><span>Less</span><ChevronUp className="w-4 h-4" /></>
                ) : (
                  <><span>More</span><ChevronDown className="w-4 h-4" /></>
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="min-h-[40vh]">
        {parseDiagnostics.length > 0 && (
          <div role="alert" className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            Completeness metadata could not be read. Owned episodes remain available; missing-item data needs a fresh analysis.
          </div>
        )}
        <Virtuoso
          data={allSeasonNumbers}
          overscan={800}
          style={{ height: 'min(70vh, 900px)' }}
          itemContent={(_, seasonNumber) => {
          const season = selectedShowData.seasons.get(seasonNumber)
          const ownedEpisodes = season?.episodes.filter(filterItem) || []
          const ownedEpisodeNumbers = new Set(ownedEpisodes.map(e => e.episode_number))
          const seasonMissingEpisodes = missingEpisodes.filter(ep => ep.season_number === seasonNumber && !ownedEpisodeNumbers.has(ep.episode_number))
          const episodeItems = [
            ...ownedEpisodes.map(episode => ({ type: 'owned' as const, episode })),
            ...seasonMissingEpisodes.map(missing => ({ type: 'missing' as const, missing })),
          ].sort((a, b) => (a.type === 'owned' ? a.episode.episode_number || 0 : a.missing.episode_number) - (b.type === 'owned' ? b.episode.episode_number || 0 : b.missing.episode_number))
          return (
            <section key={seasonNumber} aria-labelledby={`season-${seasonNumber}`}>
              <div className="flex items-center justify-between border-b border-border/60 pb-2 mb-1">
                <h4 id={`season-${seasonNumber}`} className="text-lg font-semibold">{formatSeasonLabel(seasonNumber)}</h4>
                {!season && <span className="text-xs text-muted-foreground">Missing season</span>}
                {season && <span className="text-xs text-muted-foreground">{episodeItems.length} episodes</span>}
              </div>
              {episodeItems.length > 0 ? (
                <div className="divide-y divide-border/50">
                  {episodeItems.map(item => item.type === 'owned' ? (
                    <EpisodeRow key={item.episode.id!} episode={item.episode} onClick={() => onSelectEpisode(item.episode.id!)} onRescan={onRescanEpisode} onDismissUpgrade={onDismissUpgrade} isExpanded={expandedRecommendations.has(item.episode.id!)} onToggleOptimize={() => onToggleOptimize(item.episode.id!)} />
                  ) : (
                    <MissingEpisodeRowWithArtwork key={`missing-${item.missing.season_number}-${item.missing.episode_number}`} episode={item.missing} tmdbId={completenessData?.tmdb_id} fallbackPosterUrl={season?.posterUrl || completenessData?.poster_url || selectedShowData.poster_url} onClick={() => onMissingItemClick({ type: 'episode', title: item.missing.title || `Episode ${item.missing.episode_number}`, airDate: item.missing.air_date, seasonNumber: item.missing.season_number, episodeNumber: item.missing.episode_number, posterUrl: season?.posterUrl || completenessData?.poster_url || selectedShowData.poster_url, tmdbId: completenessData?.tmdb_id, seriesTitle: selectedShowData.title })} onDismiss={onDismissMissingEpisode ? () => onDismissMissingEpisode(item.missing, selectedShowData.title, completenessData?.tmdb_id) : undefined} />
                  ))}
                </div>
              ) : <p className="py-3 text-sm text-muted-foreground">No episodes available.</p>}
              {!season && onDismissMissingSeason && <button type="button" className="mt-2 min-h-6 text-xs text-muted-foreground underline" onClick={() => onDismissMissingSeason(seasonNumber, selectedShowData.title, completenessData?.tmdb_id)}>Dismiss missing season</button>}
            </section>
          )
          }}
        />
      </div>
    </div>
  )
}
