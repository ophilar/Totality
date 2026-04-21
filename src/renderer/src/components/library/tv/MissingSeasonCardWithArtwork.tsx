import React, { useState, useEffect, memo } from 'react'
import { MissingItemCard } from '../MissingItemCard'
import { formatSeasonLabel } from '../mediaUtils'

export const MissingSeasonCardWithArtwork = memo(({
  seasonNumber,
  showTitle,
  tmdbId,
  fallbackPosterUrl,
  onClick,
  onDismiss
}: {
  seasonNumber: number
  showTitle: string
  tmdbId?: string
  fallbackPosterUrl?: string
  onClick: () => void
  onDismiss?: () => void
}) => {
  const [posterUrl, setPosterUrl] = useState<string | undefined>(fallbackPosterUrl)

  useEffect(() => {
    if (tmdbId) {
      window.electronAPI.seriesGetSeasonPoster(tmdbId, seasonNumber)
        .then((url) => {
          if (url) setPosterUrl(url)
        })
        .catch((err) => {
          window.electronAPI.log.warn('[TVShowsView]', `Failed to fetch ${formatSeasonLabel(seasonNumber)} poster:`, err)
        })
    }
  }, [tmdbId, seasonNumber])

  return (
    <MissingItemCard
      type="season"
      title={formatSeasonLabel(seasonNumber)}
      subtitle={showTitle}
      posterUrl={posterUrl}
      onClick={onClick}
      onDismiss={onDismiss}
      tmdbId={tmdbId}
      seriesTitle={showTitle}
      seasonNumber={seasonNumber}
    />
  )
})
