import { memo, useRef } from 'react'
import { Folder } from 'lucide-react'
import { formatSeasonLabel } from '@/components/library/mediaUtils'
import type { SeasonInfo } from '@/components/library/types'

export const SeasonCard = memo(({ season, showTitle, onClick }: { season: SeasonInfo; showTitle: string; onClick: () => void }) => {
  const cardRef = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      className="focus-poster-only group cursor-pointer hover-scale outline-hidden"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      <div className="aspect-2/3 bg-muted relative overflow-hidden rounded-md shadow-lg shadow-black/30">
        {season.posterUrl ? (
          <img
            src={season.posterUrl}
            alt={`${showTitle} - ${formatSeasonLabel(season.seasonNumber)}`}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted/50"><Folder className="w-16 h-16 text-white/30" strokeWidth={1.5} /></div>
        )}
      </div>

      {/* Title below poster */}
      <div className="pt-2">
        <h4 className="font-medium text-sm truncate">{formatSeasonLabel(season.seasonNumber)}</h4>
        <p className="text-xs text-muted-foreground">
          {season.episodes.length} {season.episodes.length === 1 ? 'Episode' : 'Episodes'}
        </p>
      </div>
    </div>
  )
}, (prevProps, nextProps) => {
  // Compare all props that affect rendering
  return prevProps.season.seasonNumber === nextProps.season.seasonNumber &&
         prevProps.showTitle === nextProps.showTitle &&
         prevProps.season.posterUrl === nextProps.season.posterUrl &&
         prevProps.season.episodes === nextProps.season.episodes
})
