import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useFocusTrap } from '@/hooks/useFocusTrap'

export function OptimizationDialogShell({
  title,
  subtitle,
  leading,
  onClose,
  closeText,
  footer,
  wide = false,
  children,
}: {
  title: string
  subtitle: string
  leading: ReactNode
  onClose: () => void
  closeText?: string
  footer?: ReactNode
  wide?: boolean
  children: ReactNode
}) {
  const dialogId = useId()
  const dialogRef = useRef<HTMLDivElement | null>(null)
  useFocusTrap(true, dialogRef)

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-250 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200 motion-reduce:animate-none" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${dialogId}-title`}
        tabIndex={-1}
        className={`relative bg-card border border-border sm:rounded-2xl shadow-2xl ${wide ? 'max-w-3xl' : 'max-w-2xl'} w-full h-dvh sm:h-auto sm:max-h-[92vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 motion-reduce:animate-none`}
        onClick={event => event.stopPropagation()}
      >
        <header className="p-4 sm:p-5 border-b border-border/20 flex justify-between items-center bg-muted/20">
          <div className="flex min-w-0 items-center gap-3">
            <div className="shrink-0 rounded-xl bg-primary/10 p-2.5 text-primary">{leading}</div>
            <div className="min-w-0">
              <h2 id={`${dialogId}-title`} className="text-lg font-bold leading-tight">{title}</h2>
              <p className="max-w-[450px] truncate text-xs text-muted-foreground">{subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeText ?? 'Close optimization dialog'}
            title={closeText ?? 'Close'}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
          >
            {closeText ? <span className="px-1 text-xs font-semibold">{closeText}</span> : <X className="h-5 w-5" />}
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && <footer className="shrink-0 border-t border-border/10 bg-muted/10 p-4 sm:p-5">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}
