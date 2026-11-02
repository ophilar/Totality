import { Sparkles } from 'lucide-react'

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
          These items have available disk-optimization analysis. Open an item to compare video transcoding, audio transcoding, and track removal.
        </p>
      </div>
    </div>
  )
}
