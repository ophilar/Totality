/**
 * Button — shared component per docs/SKILL.md §3
 *
 * Variants: primary, secondary, tertiary, danger, danger-secondary, danger-tertiary
 * Sizes: sm (32px), md (40px), lg (48px)
 * States: default, hover, focus-visible, press, disabled, loading
 */

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger' | 'danger-secondary' | 'danger-tertiary'
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon-sm' | 'icon-md'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: ReactNode
  children?: ReactNode
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground border border-transparent hover:bg-primary/90 active:scale-[0.98]',
  secondary: 'bg-transparent text-foreground border border-border hover:bg-muted active:scale-[0.98]',
  tertiary: 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50 border-none active:scale-[0.98]',
  danger: 'bg-destructive text-white border border-transparent hover:bg-destructive/90 active:scale-[0.98]',
  'danger-secondary': 'bg-transparent text-destructive border border-destructive/50 hover:bg-destructive/10 active:scale-[0.98]',
  'danger-tertiary': 'bg-transparent text-destructive hover:bg-destructive/10 border-none active:scale-[0.98]',
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-sm gap-2',
  'icon-sm': 'h-8 w-8 p-0 justify-center',
  'icon-md': 'h-10 w-10 p-0 justify-center',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading = false, icon, children, className = '', disabled, ...props }, ref) => {
    const isIconOnly = size === 'icon-sm' || size === 'icon-md'

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={[
          'inline-flex items-center font-medium rounded-lg transition-colors',
          'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          'disabled:opacity-50 disabled:pointer-events-none',
          variantClasses[variant],
          sizeClasses[size],
          className,
        ].join(' ')}
        {...props}
      >
        {loading ? (
          <Loader2 className={isIconOnly ? 'w-4 h-4 animate-spin' : 'w-4 h-4 animate-spin shrink-0'} />
        ) : icon ? (
          <span className="shrink-0">{icon}</span>
        ) : null}
        {!isIconOnly && children && (
          <span className={loading ? 'opacity-0' : ''}>{children}</span>
        )}
      </button>
    )
  }
)

Button.displayName = 'Button'
