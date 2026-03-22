/**
 * QualityBadges Component
 *
 * Displays quality indicator badges (HDR, 10-bit, Atmos, HFR) for media items.
 */

import { Trash2, HardDrive } from 'lucide-react'
import type { MediaItem } from './types'

interface QualityBadgesProps {
  item: MediaItem
  whiteBg?: boolean
  showEfficiency?: boolean
}

export function QualityBadges({ item, whiteBg = false, showEfficiency = true }: QualityBadgesProps) {
  const badges: Array<{ label: string; coloredClass: string; icon?: any }> = []

  // Efficiency "Trash" badge - show if score is below threshold (60%)
  if (showEfficiency && item.efficiency_score !== undefined && item.efficiency_score > 0 && item.efficiency_score < 60) {
    badges.push({ 
      label: 'Bloated', 
      coloredClass: 'bg-orange-600/90 text-white',
      icon: Trash2
    })
  }

  // Storage Debt badge - show if over 5GB for movies, 2GB for episodes
  const debtThreshold = item.type === 'movie' ? 5 * 1024 * 1024 * 1024 : 2 * 1024 * 1024 * 1024
  if (showEfficiency && item.storage_debt_bytes && item.storage_debt_bytes > debtThreshold) {
    const gb = Math.round(item.storage_debt_bytes / (1024 * 1024 * 1024))
    badges.push({ 
      label: `${gb}GB Waste`, 
      coloredClass: 'bg-red-600/90 text-white',
      icon: HardDrive
    })
  }

  // HDR badges - use same terminology as details page
  if (item.hdr_format === 'Dolby Vision') {
    badges.push({ label: 'Dolby Vision', coloredClass: 'bg-purple-600/90 text-white' })
  } else if (item.hdr_format === 'HDR10') {
    badges.push({ label: 'HDR10', coloredClass: 'bg-orange-600/90 text-white' })
  } else if (item.hdr_format === 'HLG') {
    badges.push({ label: 'HLG', coloredClass: 'bg-yellow-600/90 text-white' })
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

  if (badges.length === 0) return null

  const badgeClass = whiteBg
    ? 'bg-foreground text-background border border-border'
    : ''

  return (
    <div className={`flex flex-wrap gap-1 ${whiteBg ? '' : 'mt-1'}`}>
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
