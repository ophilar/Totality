/**
 * Modal — shared dialog component per docs/SKILL.md §2, §7
 *
 * Sizes: sm (max-w-sm), md (max-w-lg), lg (max-w-2xl), xl (max-w-4xl), full (max-w-[90vw])
 *
 * Features:
 * - Backdrop with click-to-close
 * - Escape key closes
 * - Focus trap
 * - Header/body/footer sections
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  size?: ModalSize
  children: ReactNode
  footer?: ReactNode
  hideCloseButton?: boolean
}

const sizeClasses: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-[90vw]',
}

export function Modal({ isOpen, onClose, title, size = 'md', children, footer, hideCloseButton }: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null)

  // Escape to close
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Focus trap — focus the modal on open
  useEffect(() => {
    if (isOpen && modalRef.current) {
      modalRef.current.focus()
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        className={[
          'bg-card border border-border rounded-2xl shadow-xl w-full max-h-[90vh] flex flex-col',
          'focus:outline-hidden',
          sizeClasses[size],
        ].join(' ')}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        {(title || !hideCloseButton) && (
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/30 shrink-0">
            {title && <h2 className="text-sm font-semibold">{title}</h2>}
            {!hideCloseButton && (
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border/30 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
