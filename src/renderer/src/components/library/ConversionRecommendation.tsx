import { useState } from 'react'
import { Zap, Copy, Check } from 'lucide-react'
import type { MediaItem } from './types'

export function ConversionRecommendation({ item, compact = false }: { item: MediaItem, compact?: boolean }) {
  const [copied, setCopied] = useState<'av1' | 'h265' | null>(null)
  
  const is4K = item.resolution?.includes('4K') || item.resolution?.includes('2160p')
  const isFilm = (item as any).genres?.toLowerCase().includes('drama') || (item as any).genres?.toLowerCase().includes('history')
  
  const av1RF = is4K ? 22 : 24
  const h265RF = is4K ? 24 : 20
  
  const av1Params = `tune=0:enable-overlays=1${isFilm ? ':film-grain=20' : ''}`
  const x265Params = `aq-mode=3:no-open-gop=1${isFilm ? ':psy-rd=2.0' : ''}`

  const av1Command = `ffmpeg -i input.mkv -c:v libsvtav1 -crf ${av1RF} -preset 6 -pix_fmt yuv420p10le -svtav1-params ${av1Params} -c:a libopus -b:a 128k output.mkv`
  const h265Command = `ffmpeg -i input.mkv -c:v libx265 -crf ${h265RF} -preset slow -pix_fmt yuv420p10le -x265-params ${x265Params} -c:a copy output.mp4`

  const hbAV1 = `Encoder: AV1 10-bit (SVT), RF: ${av1RF}, Preset: 6, Advanced: ${av1Params}`
  const hbH265 = `Encoder: H.265 10-bit (x265), RF: ${h265RF}, Preset: Slow, Advanced: ${x265Params}`

  const copyToClipboard = (text: string, type: 'av1' | 'h265') => {
    navigator.clipboard.writeText(text)
    setCopied(type)
    setTimeout(() => setCopied(null), 2000)
  }

  const baseClasses = compact ? "mt-2 p-2 text-[10px]" : "mt-4 p-4 text-xs"

  return (
    <div className={`${baseClasses} bg-background/50 rounded-md border border-border/50 space-y-2 overflow-hidden`}>
      <div className="flex items-center justify-between">
        <span className="font-bold text-primary flex items-center gap-1">
          <Zap className={compact ? "w-3 h-3" : "w-4 h-4"} /> RECOMMENDED: AV1 (Best Quality/Size)
        </span>
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between group/cmd">
          <code className="text-muted-foreground truncate flex-1 mr-2">{av1Command}</code>
          <button onClick={() => copyToClipboard(av1Command, 'av1')} className="p-1 hover:text-primary transition-colors">
            {copied === 'av1' ? <Check className={compact ? "w-3 h-3" : "w-4 h-4"} /> : <Copy className={compact ? "w-3 h-3" : "w-4 h-4"} />}
          </button>
        </div>
        <div className="text-muted-foreground italic truncate">{hbAV1}</div>
      </div>
      
      <div className="pt-1 border-t border-border/30">
        <span className="font-bold text-muted-foreground flex items-center gap-1 mb-1 uppercase tracking-tight">
          COMPATIBILITY: H.265 (HEVC)
        </span>
        <div className="flex items-center justify-between group/cmd">
          <code className="text-muted-foreground truncate flex-1 mr-2">{h265Command}</code>
          <button onClick={() => copyToClipboard(h265Command, 'h265')} className="p-1 hover:text-primary transition-colors">
            {copied === 'h265' ? <Check className={compact ? "w-3 h-3" : "w-4 h-4"} /> : <Copy className={compact ? "w-3 h-3" : "w-4 h-4"} />}
          </button>
        </div>
        <div className="text-muted-foreground italic truncate">{hbH265}</div>
      </div>
    </div>
  )
}
