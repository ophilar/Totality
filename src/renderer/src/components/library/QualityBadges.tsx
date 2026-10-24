/**
 * QualityBadges Component
 *
 * Displays estimated savings and media-quality badges.
 */

import { HardDrive } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { MediaItem } from './types'
import { normalizeHdrFormatValue } from '@main/types/mediaContracts'
import { EstimatedSavingsDisplay } from './EstimatedSavingsDisplay'

interface QualityBadgesProps {
  item: MediaItem
  whiteBg?: boolean
  showSavings?: boolean
}

/** Keep dynamic HDR formats distinct from the base HDR10 label. */
export function formatHdrLabel(value?: string | null): string | undefined {
  const normalized = normalizeHdrFormatValue(value)
  return normalized === 'SDR' ? undefined : normalized
}

export function QualityBadges({ item, whiteBg = false, showSavings = true }: QualityBadgesProps) {
  const badges: Array<{ label: string; coloredClass: string; icon?: LucideIcon }> = []

  badges.push({
    label: item.tier_quality === 'UNKNOWN' ? 'Quality unknown' : `${item.tier_quality} quality`,
    coloredClass: item.tier_quality === 'UNKNOWN' ? 'bg-muted text-muted-foreground' : 'bg-muted text-muted-foreground',
  })

  // HDR badges - use same terminology as details page
  const hdrLabel = formatHdrLabel(item.hdr_format)
  if (hdrLabel === 'Dolby Vision') {
    badges.push({ label: hdrLabel, coloredClass: 'bg-purple-600/90 text-white' })
  } else if (hdrLabel === 'HDR10+') {
    badges.push({ label: hdrLabel, coloredClass: 'bg-pink-600/90 text-white' })
  } else if (hdrLabel === 'HDR10') {
    badges.push({ label: hdrLabel, coloredClass: 'bg-orange-600/90 text-white' })
  } else if (hdrLabel === 'HLG') {
    badges.push({ label: hdrLabel, coloredClass: 'bg-yellow-600/90 text-white' })
  }

  // 10-bit color - show actual bit depth like details page
  if (item.color_bit_depth && item.color_bit_depth >= 10) {
    badges.push({ label: `${item.color_bit_depth}-bit`, coloredClass: 'bg-green-600/90 text-white' })
  }

  // Object audio - use generic term since it could be Atmos or DTS:X
  if (item.has_object_audio) {
    badges.push({ label: 'Immersive Audio', coloredClass: 'bg-blue-600/90 text-white' })
  }

  // High frame rate - show actual frame rate like details page
  if (item.video_frame_rate && item.video_frame_rate >= 50) {
    badges.push({ label: `${Math.round(item.video_frame_rate)}fps`, coloredClass: 'bg-red-600/90 text-white' })
  }

  const hasOptimizationMetrics = showSavings && item.estimated_savings_bytes != null
  if (badges.length === 0 && !hasOptimizationMetrics) return null

  const badgeClass = whiteBg
    ? 'bg-foreground text-background border border-border'
    : ''

  return (
    <div className={`flex flex-wrap gap-1 ${whiteBg ? '' : 'mt-1'}`}>
      {showSavings && item.estimated_savings_bytes != null && (
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${whiteBg ? 'bg-foreground text-background border border-border' : 'bg-orange-600/90 text-white'}`} title={`Estimated combined storage savings · ${item.savings_coverage ?? 'insufficient'} evidence`}>
          <HardDrive className="w-3 h-3" />
          Estimated savings <EstimatedSavingsDisplay bytes={item.estimated_savings_bytes} className={whiteBg ? 'text-background' : 'text-white'} /> · {item.savings_coverage ?? 'insufficient'}
        </span>
      )}
      {badges.map((badge, idx) => (
        <span
          key={idx}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${whiteBg ? badgeClass : badge.coloredClass}`}
        >
          {badge.icon && <badge.icon className="w-3 h-3" />}
          {badge.label}
        </span>
      ))}
    </div>
  )
}
