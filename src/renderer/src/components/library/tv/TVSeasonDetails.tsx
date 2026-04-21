import { formatSeasonLabel } from '../mediaUtils'
import { EpisodeRow } from './EpisodeRow'
import { MissingEpisodeRowWithArtwork } from './MissingEpisodeRowWithArtwork'
import type { MediaItem, TVShow, SeriesCompletenessData, MissingEpisode } from '../types'

export function TVSeasonDetails({
  selectedShow,
  selectedSeason,
  selectedShowData,
  seriesCompleteness,
  filterItem,
  onBack,
  onSelectEpisode,
  onRescanEpisode,
  onDismissUpgrade,
  expandedRecommendations,
  onToggleOptimize,
  onMissingItemClick,
  onDismissMissingEpisode
}: {
  selectedShow: string
  selectedSeason: number
  selectedShowData: TVShow
  seriesCompleteness: Map<string, SeriesCompletenessData>
  filterItem: (item: MediaItem) => boolean
  onBack: () => void
  onSelectEpisode: (id: number) => void
  onRescanEpisode?: (episode: MediaItem) => Promise<void>
  onDismissUpgrade?: (item: MediaItem) => void
  expandedRecommendations: Set<number>
  onToggleOptimize: (id: number) => void
  onMissingItemClick: (item: any) => void
  onDismissMissingEpisode?: (episode: MissingEpisode, seriesTitle: string, tmdbId?: string) => void
}) {
  const season = selectedShowData.seasons.get(selectedSeason)
  const completenessData = seriesCompleteness.get(selectedShow)

  // Get owned episodes for this season
  const ownedEpisodes = season ? season.episodes.filter(filterItem) : []
  const ownedEpisodeNumbers = new Set(ownedEpisodes.map(e => e.episode_number))

  // Parse missing episodes from completeness data, filter by current season
  let missingEpisodesForSeason: MissingEpisode[] = []
  if (completenessData?.missing_episodes) {
    try {
      const allMissing: MissingEpisode[] = JSON.parse(completenessData.missing_episodes) || []
      missingEpisodesForSeason = allMissing.filter(
        ep => ep.season_number === selectedSeason && !ownedEpisodeNumbers.has(ep.episode_number)
      )
    } catch {
      missingEpisodesForSeason = []
    }
  }

  // Get fallback poster for missing episodes (season poster > series poster)
  const missingEpisodePoster = season?.posterUrl || completenessData?.poster_url || selectedShowData.poster_url

  // Build combined list sorted by episode number
  type EpisodeItem = { type: 'owned'; episode: MediaItem } | { type: 'missing'; missing: MissingEpisode }
  const allEpisodeItems: EpisodeItem[] = [
    ...ownedEpisodes.map(e => ({ type: 'owned' as const, episode: e })),
    ...missingEpisodesForSeason.map(m => ({ type: 'missing' as const, missing: m }))
  ].sort((a, b) => {
    const aNum = a.type === 'owned' ? (a.episode.episode_number || 0) : a.missing.episode_number
    const bNum = b.type === 'owned' ? (b.episode.episode_number || 0) : b.missing.episode_number
    return aNum - bNum
  })

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
        Back to {selectedShowData.title}
      </button>

      <h3 className="text-xl font-bold">
        {selectedShowData.title} - {formatSeasonLabel(selectedSeason!)}
      </h3>

      <div className="divide-y divide-border/50">
        {allEpisodeItems.map((item) => (
          item.type === 'owned' ? (
            <EpisodeRow
              key={item.episode.id!}
              episode={item.episode}
              onClick={() => onSelectEpisode(item.episode.id!)}
              onRescan={onRescanEpisode}
              onDismissUpgrade={onDismissUpgrade}
              isExpanded={expandedRecommendations.has(item.episode.id!)}
              onToggleOptimize={() => onToggleOptimize(item.episode.id!)}
            />
          ) : (
            <MissingEpisodeRowWithArtwork
              key={`missing-${item.missing.season_number}-${item.missing.episode_number}`}
              episode={item.missing}
              tmdbId={completenessData?.tmdb_id}
              fallbackPosterUrl={missingEpisodePoster}
              onClick={() => onMissingItemClick({
                type: 'episode',
                title: item.missing.title || `Episode ${item.missing.episode_number}`,
                airDate: item.missing.air_date,
                seasonNumber: item.missing.season_number,
                episodeNumber: item.missing.episode_number,
                posterUrl: missingEpisodePoster,
                tmdbId: completenessData?.tmdb_id,
                seriesTitle: selectedShowData.title
              })}
              onDismiss={onDismissMissingEpisode ? () => onDismissMissingEpisode(item.missing, selectedShowData.title, completenessData?.tmdb_id) : undefined}
            />
          )
        ))}
      </div>
    </div>
  )
}
