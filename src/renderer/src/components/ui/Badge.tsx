/**
 * Badge — shared indicator component per docs/SKILL.md §9
 *
 * Color carries meaning, never mood:
 * - default: neutral info
 * - success: green (completed, available)
 * - warning: amber (needs attention)
 * - danger: red (failed, destructive)
 * - primary: accent color
 */

import type { ReactNode } from 'react'

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'primary'

interface BadgeProps {
  variant?: BadgeVariant
  children: ReactNode
  className?: string
}

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-muted text-muted-foreground',
  success: 'bg-green-500/15 text-green-500',
  warning: 'bg-amber-500/15 text-amber-500',
  danger: 'bg-destructive/15 text-destructive',
  primary: 'bg-primary/15 text-primary',
}

export function Badge({ variant = 'default', children, className = '' }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-medium rounded-full',
        variantClasses[variant],
        className,
      ].join(' ')}
    >
      {children}
    </span>
  )
}
