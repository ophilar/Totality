import { memo } from 'react'
import { formatBytes } from '@/components/library/mediaUtils'
import { RecoverableWasteDisplay } from '@/components/library/RecoverableWasteDisplay'
import { EfficiencyDisplay } from '@/components/library/EfficiencyDisplay'
import { EvidenceStatusBadge } from '@/components/library/EvidenceStatusBadge'
import type { EvidenceStatus } from '@main/types/database'

export interface MediaMetricsRowProps {
  fileSize?: number | null
  storageDebtBytes?: number | null
  efficiencyScore?: number | null
  evidenceStatus?: EvidenceStatus | null
  className?: string
}

export const MediaMetricsRow = memo(function MediaMetricsRow({
  fileSize,
  storageDebtBytes,
  efficiencyScore,
  evidenceStatus,
  className = 'flex items-center gap-1.5 text-[10px] text-muted-foreground mt-1 flex-wrap'
}: MediaMetricsRowProps) {
  return (
    <div className={className}>
      <span>{fileSize == null ? 'Size unavailable' : formatBytes(fileSize)}</span>
      <span>·</span>
      <RecoverableWasteDisplay bytes={storageDebtBytes} />
      <span>·</span>
      <EfficiencyDisplay score={efficiencyScore} showBadge={false} />
      {evidenceStatus && <EvidenceStatusBadge status={evidenceStatus} />}
    </div>
  )
})
