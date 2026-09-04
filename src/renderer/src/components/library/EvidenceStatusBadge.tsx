import React from 'react'
import type { EvidenceStatus } from '@main/types/database'

export interface EvidenceStatusBadgeProps {
  status?: EvidenceStatus | 'unmeasured' | 'unknown' | null
  className?: string
}

export const EvidenceStatusBadge: React.FC<EvidenceStatusBadgeProps> = ({ status, className = '' }) => {
  if (!status || status === 'unknown' || status === 'unmeasured' || status === 'insufficient') {
    return (
      <span
        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground ${className}`}
        title={status === 'insufficient' ? 'Insufficient: Partial data or low confidence measurement' : 'Unmeasured: Analysis has not measured file optimization details'}
      >
        {status === 'insufficient' ? 'Insufficient' : 'Unmeasured'}
      </span>
    )
  }

  if (status === 'measured') {
    return (
      <span
        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ${className}`}
        title="Measured: Verified against media file streams and codec profiles"
      >
        Measured
      </span>
    )
  }

  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400 ${className}`}
      title="Estimated: Heuristic approximation based on container and bitrate tier"
    >
      Estimated
    </span>
  )
}
