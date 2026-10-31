import type { ReactNode } from 'react'

export type OptimizationFooterAction = {
  label: ReactNode
  onClick: () => void
  disabled?: boolean
  title?: string
  variant?: 'muted' | 'outline' | 'text'
}

export function OptimizationDialogFooter({ leadingAction, secondaryAction, status, primaryAction }: {
  leadingAction?: OptimizationFooterAction
  secondaryAction?: OptimizationFooterAction
  status?: ReactNode
  primaryAction?: OptimizationFooterAction
}) {
  return <div className="flex flex-col items-stretch justify-between gap-3 border-t border-border/10 bg-muted/10 p-4 sm:flex-row sm:items-center sm:p-5">
    <div className="flex min-w-0 items-center gap-3">
      {leadingAction && <button type="button" onClick={leadingAction.onClick} disabled={leadingAction.disabled} title={leadingAction.title} className="shrink-0 rounded-xl bg-muted px-5 py-2.5 text-xs font-bold transition-colors hover:bg-muted/80 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">{leadingAction.label}</button>}
      {status && <span role="status" className="min-w-0 text-xs text-muted-foreground">{status}</span>}
    </div>
    <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
      {secondaryAction && <button type="button" onClick={secondaryAction.onClick} disabled={secondaryAction.disabled} title={secondaryAction.title} className={`rounded-xl px-4 py-2.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${secondaryAction.variant === 'text' ? 'text-primary hover:underline' : secondaryAction.variant === 'outline' ? 'border border-border hover:bg-muted/50' : 'bg-muted hover:bg-muted/80'}`}>{secondaryAction.label}</button>}
      {primaryAction && <button type="button" onClick={primaryAction.onClick} disabled={primaryAction.disabled} title={primaryAction.title} className="flex items-center justify-center gap-2 rounded-xl bg-primary px-6 py-2.5 text-xs font-bold text-primary-foreground shadow-lg shadow-primary/20 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">{primaryAction.label}</button>}
    </div>
  </div>
}
