import React, { useState, useEffect } from 'react'
import { RefreshCw, Pencil, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react'
import { SeasonCard } from './SeasonCard'
import { MissingSeasonCardWithArtwork } from './MissingSeasonCardWithArtwork'
import { getStatusBadge, formatSeasonLabel } from '../mediaUtils'
import type { TVShow, TVSeason, SeriesCompletenessData, SeasonInfo } from '../types'

export function TVShowDetails({
  selectedShow,
  selectedShowData,
  selectedShowLoading,
  seriesCompleteness,
  onBack,
  onAnalyzeSeries,
  onFixMatch,
  onSelectSeason,
  onMissingItemClick,
  onDismissMissingSeason,
  posterMinWidth
}: {
  selectedShow: string
  selectedShowData: TVShow | null
  selectedShowLoading: boolean
  seriesCompleteness: Map<string, SeriesCompletenessData>
  onBack: () => void
  onAnalyzeSeries: (seriesTitle: string) => void
  onFixMatch?: (title: string, sourceId: string, folderPath?: string) => void
  onSelectSeason: (season: number | null) => void
  onMissingItemClick: (item: any) => void
  onDismissMissingSeason?: (seasonNumber: number, seriesTitle: string, tmdbId?: string) => void
  posterMinWidth: number
}) {
  const [showOverviewExpanded, setShowOverviewExpanded] = useState(false)
  const [copiedTitle, setCopiedTitle] = useState(false)
  const [showOverview, setShowOverview] = useState<string | null>(null)

  useEffect(() => {
    setShowOverviewExpanded(false)
    setCopiedTitle(false)
    setShowOverview(null)

    if (selectedShow) {
      const completenessData = seriesCompleteness.get(selectedShow)
      if (completenessData?.tmdb_id) {
        window.electronAPI.tmdbGetTVShowDetails(completenessData.tmdb_id)
          .then(details => { if (details?.overview) setShowOverview(details.overview) })
          .catch(() => { /* ignore */ })
      }
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

  // Parse missing seasons from completeness data
  let missingSeasonNumbers: number[] = []
  if (completenessData?.missing_seasons) {
    try {
      missingSeasonNumbers = JSON.parse(completenessData.missing_seasons) || []
    } catch {
      missingSeasonNumbers = []
    }
  }

  // Build combined list of owned and missing seasons
  const ownedSeasonNumbers = new Set(ownedSeasons.map(s => s.seasonNumber))
  const allSeasonItems: Array<{ type: 'owned' | 'missing'; seasonNumber: number; season?: TVSeason }> = [
    ...ownedSeasons.map(s => ({ type: 'owned' as const, seasonNumber: s.seasonNumber, season: s })),
    ...missingSeasonNumbers
      .filter(num => !ownedSeasonNumbers.has(num))
      .map(num => ({ type: 'missing' as const, seasonNumber: num }))
  ].sort((a, b) => a.seasonNumber - b.seasonNumber)

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
      <div className="flex gap-6 mb-6">
        {/* Poster */}
        {selectedShowData.poster_url && (
          <div className="w-44 aspect-2/3 bg-muted rounded-lg overflow-hidden shrink-0 shadow-lg shadow-black/30">
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
            <h3 className="text-3xl font-bold">{selectedShowData.title}</h3>
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
          <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
            <span>{ownedSeasons.length} of {totalSeasons} Seasons</span>
            {completenessData?.status && (
              <>
                <span>•</span>
                <span>{getStatusBadge(completenessData.status)?.text || completenessData.status}</span>
              </>
            )}
          </div>

          {/* Action buttons row */}
          <div className="flex items-center gap-3 mt-3">
            <button
              onClick={() => selectedShow && onAnalyzeSeries(selectedShow)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
              title="Analyze Series"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Analyze Series
            </button>
            {onFixMatch && (
              <button
                onClick={() => selectedShow && onFixMatch(selectedShow, '', undefined)}
                className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                title="Fix Match"
              >
                <Pencil className="w-4 h-4" />
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

      <div
        className="grid gap-8"
        style={{
          gridTemplateColumns: `repeat(auto-fill, ${posterMinWidth}px)`
        }}
      >
        {allSeasonItems.map((item) => (
          item.type === 'owned' && item.season ? (
            <SeasonCard
              key={item.seasonNumber}
              season={item.season as SeasonInfo}
              showTitle={selectedShowData.title}
              onClick={() => onSelectSeason(item.seasonNumber)}
            />
          ) : (
            <MissingSeasonCardWithArtwork
              key={`missing-${item.seasonNumber}`}
              seasonNumber={item.seasonNumber}
              showTitle={selectedShowData.title}
              tmdbId={completenessData?.tmdb_id}
              fallbackPosterUrl={completenessData?.poster_url || selectedShowData.poster_url}
              onClick={() => onMissingItemClick({
                type: 'season',
                title: formatSeasonLabel(item.seasonNumber),
                seasonNumber: item.seasonNumber,
                posterUrl: completenessData?.poster_url || selectedShowData.poster_url,
                tmdbId: completenessData?.tmdb_id,
                seriesTitle: selectedShowData.title
              })}
              onDismiss={onDismissMissingSeason ? () => onDismissMissingSeason(item.seasonNumber, selectedShowData.title, completenessData?.tmdb_id) : undefined}
            />
          )
        ))}
      </div>
    </div>
  )
}
