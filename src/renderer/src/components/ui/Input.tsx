/**
 * Input — shared form control per docs/SKILL.md §2
 *
 * Sizes: sm (compact search/filter), md (standard form), lg (prominent)
 * Filled surface style per SKILL.md: controls are filled, not outlined at rest.
 */

import { forwardRef, type InputHTMLAttributes } from 'react'

type InputSize = 'sm' | 'md' | 'lg'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  inputSize?: InputSize
}

const sizeClasses: Record<InputSize, string> = {
  sm: 'px-3 py-1.5 text-caption',
  md: 'px-3 py-2 text-label',
  lg: 'px-4 py-2.5 text-label',
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ inputSize = 'md', className = '', ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={[
          'w-full bg-background border border-border/30 rounded-lg',
          'focus:outline-hidden focus:ring-2 focus:ring-primary',
          'placeholder:text-muted-foreground/50',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'transition-colors',
          sizeClasses[inputSize],
          className,
        ].join(' ')}
        {...props}
      />
    )
  }
)

Input.displayName = 'Input'

/**
 * Select — shared select control
 */
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  inputSize?: InputSize
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ inputSize = 'md', className = '', children, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={[
          'bg-background text-foreground border border-border/30 rounded-lg cursor-pointer',
          'focus:outline-hidden focus:ring-2 focus:ring-primary',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'transition-colors',
          sizeClasses[inputSize],
          className,
        ].join(' ')}
        {...props}
      >
        {children}
      </select>
    )
  }
)

Select.displayName = 'Select'
