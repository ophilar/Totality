import { useEffect, useRef, RefObject } from 'react'

// Selector for all focusable elements
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

const activeTraps: HTMLElement[] = []

/**
 * Hook to trap focus within a container element.
 * When active, Tab/Shift+Tab will cycle through focusable elements
 * within the container, preventing focus from escaping.
 *
 * @param isActive - Whether the focus trap is active
 * @param containerRef - Ref to the container element
 * @param autoFocusFirst - Whether to auto-focus the first element when activated
 */
export function useFocusTrap(
  isActive: boolean,
  containerRef: RefObject<HTMLElement | null>,
  autoFocusFirst: boolean = true
) {
  const previousActiveElement = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!isActive || !containerRef.current) return

    const container = containerRef.current

    // Save the currently focused element to restore later
    previousActiveElement.current = document.activeElement as HTMLElement

    // Get all focusable elements within the container
    const getFocusableElements = (): HTMLElement[] => {
      return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter(el => {
          // Filter out hidden elements
          const style = window.getComputedStyle(el)
          return style.display !== 'none' && style.visibility !== 'hidden'
        })
    }

    activeTraps.push(container)
    let focusTimer: ReturnType<typeof setTimeout> | undefined

    // Auto-focus the intended input, or the first control, when the overlay opens.
    if (autoFocusFirst) {
      focusTimer = setTimeout(() => {
        if (activeTraps[activeTraps.length - 1] !== container) return
        const target = container.querySelector<HTMLElement>('[autofocus]') ?? getFocusableElements()[0] ?? container
        target.focus()
      }, 0)
    }

    // Handle Tab key to trap focus
    const handleKeyDown = (e: KeyboardEvent) => {
      if (activeTraps[activeTraps.length - 1] !== container) return
      if (e.key !== 'Tab') return

      const focusableElements = getFocusableElements()
      if (focusableElements.length === 0) return

      const firstElement = focusableElements[0]
      const lastElement = focusableElements[focusableElements.length - 1]

      if (e.shiftKey) {
        // Shift+Tab - if on first element, go to last
        if (document.activeElement === firstElement) {
          e.preventDefault()
          lastElement.focus()
        }
      } else {
        // Tab - if on last element, go to first
        if (document.activeElement === lastElement) {
          e.preventDefault()
          firstElement.focus()
        }
      }
    }

    // Handle focus leaving the container
    const handleFocusOut = (e: FocusEvent) => {
      if (activeTraps[activeTraps.length - 1] !== container) return
      if (!container.contains(e.relatedTarget as Node)) {
        // Focus is leaving the container, bring it back
        const focusableElements = getFocusableElements()
        if (focusableElements.length > 0) {
          e.preventDefault()
          focusableElements[0].focus()
        }
      }
    }

    container.addEventListener('keydown', handleKeyDown)
    container.addEventListener('focusout', handleFocusOut)

    return () => {
      if (focusTimer) clearTimeout(focusTimer)
      container.removeEventListener('keydown', handleKeyDown)
      container.removeEventListener('focusout', handleFocusOut)
      const trapIndex = activeTraps.lastIndexOf(container)
      if (trapIndex >= 0) activeTraps.splice(trapIndex, 1)

      // Restore focus to previous element when trap is deactivated
      if (previousActiveElement.current && document.body.contains(previousActiveElement.current)) {
        previousActiveElement.current.focus()
      }
    }
  }, [isActive, containerRef, autoFocusFirst])
}
