/**
 * Card — shared surface component per docs/SKILL.md §2, §4
 *
 * Variants:
 * - raised: standard card (bg-card with border)
 * - muted: settings section (bg-muted/30 with subtle border)
 * - flat: list item (bg-muted/20 with hover)
 *
 * Padding: sm (p-3), md (p-4), lg (p-6)
 */

import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'

type CardVariant = 'raised' | 'muted' | 'flat'
type CardPadding = 'none' | 'sm' | 'md' | 'lg'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant
  padding?: CardPadding
  children: ReactNode
}

const variantClasses: Record<CardVariant, string> = {
  raised: 'bg-card border border-border rounded-2xl',
  muted: 'bg-muted/30 border border-border/40 rounded-lg',
  flat: 'bg-muted/20 hover:bg-muted/40 rounded-md transition-colors',
}

const paddingClasses: Record<CardPadding, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ variant = 'raised', padding = 'md', children, className = '', ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={[variantClasses[variant], paddingClasses[padding], className].join(' ')}
        {...props}
      >
        {children}
      </div>
    )
  }
)

Card.displayName = 'Card'
