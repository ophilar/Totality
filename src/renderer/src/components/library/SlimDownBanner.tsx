import { Sparkles, Info } from 'lucide-react'

export function SlimDownBanner({ className = '' }: { className?: string }) {
  return (
    <div className={`p-4 bg-primary/10 border border-primary/20 rounded-lg flex gap-4 items-start ${className}`}>
      <div className="p-2 bg-primary/20 rounded-full shrink-0">
        <Sparkles className="w-5 h-5 text-primary" />
      </div>
      <div className="flex-1 space-y-2">
        <h3 className="font-semibold text-primary flex items-center gap-2">
          Space Optimization Recommendations
        </h3>
        <p className="text-sm text-muted-foreground leading-relaxed text-balance">
          You are viewing items that are inefficiently encoded or taking up excessive space.
          To save gigabytes per file without noticeable visual degradation:
        </p>
        <ul className="text-sm space-y-1.5 text-foreground/80 mt-2 list-disc list-inside">
          <li>
            <strong className="text-foreground">Re-encode to AV1:</strong> It provides equivalent quality to HEVC but at 20-30% lower bitrates. Default to CRF 24 for a baseline, or use HEVC (H.265) if AV1 playback is not supported on your devices.
          </li>
          <li>
            <strong className="text-foreground">Remove Unnecessary Audio:</strong> FLAC or uncompressed multi-channel audio tracks consume massive space. Keep an Opus 5.1/7.1 track and a stereo AAC track.
          </li>
          <li>
            <strong className="text-foreground">Prune Subtitles:</strong> Strip out languages you don't read to slightly lower overhead.
          </li>
        </ul>
        <div className="text-xs flex items-center gap-1 mt-3 bg-background/50 p-2 rounded w-fit border border-border/50">
          <Info className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">Tip: Target ~2-4 GB for 1080p, and ~8-15 GB for 4K items.</span>
        </div>
      </div>
    </div>
  )
}
