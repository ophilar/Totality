export function OptimizationEncodingProgress({
  label,
  status,
  percent,
  phase,
  fps,
  speed,
  eta,
  elapsed,
  onCancel,
}: {
  label?: string
  status: string
  percent: number | null
  phase?: string | null
  fps?: string | null
  speed?: string | null
  eta?: string | null
  elapsed?: string
  onCancel?: () => void
}) {
  const validPercent = percent !== null && Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : null

  return <section className="space-y-4 rounded-xl border border-primary/20 bg-primary/5 p-4" aria-label="Optimization progress">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <p role="status" className="text-sm font-semibold">{status}</p>
        {label && <p className="truncate text-xs text-muted-foreground">{label}</p>}
        {phase && <p className="text-xs text-muted-foreground">{phase}</p>}
      </div>
      {onCancel && <button type="button" onClick={onCancel} className="rounded-md border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">Cancel</button>}
    </div>
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs"><span>Progress</span><span className="tabular-nums">{validPercent === null ? 'Not available' : `${validPercent.toFixed(1)}%`}</span></div>
      <progress aria-label="Optimization progress" max={100} value={validPercent ?? undefined} className="h-2 w-full overflow-hidden rounded-full accent-primary" />
    </div>
    <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
      <div><dt className="text-muted-foreground">Frame rate</dt><dd className="font-mono">{fps || 'Not available'}</dd></div>
      <div><dt className="text-muted-foreground">Speed</dt><dd className="font-mono">{speed || 'Not available'}</dd></div>
      <div><dt className="text-muted-foreground">Time remaining</dt><dd className="font-mono">{eta || 'Not available'}</dd></div>
      {elapsed && <div><dt className="text-muted-foreground">Elapsed</dt><dd className="font-mono">{elapsed}</dd></div>}
    </dl>
  </section>
}
