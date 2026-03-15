import { useState } from 'react'

interface UsePanelStateOptions {
  externalShowCompletenessPanel?: boolean
  externalShowWishlistPanel?: boolean
  externalShowChatPanel?: boolean
  onToggleCompleteness?: () => void
  onToggleWishlist?: () => void
  onToggleChat?: () => void
}

interface UsePanelStateReturn {
  showCompletenessPanel: boolean
  showWishlistPanel: boolean
  showChatPanel: boolean
  setShowCompletenessPanel: (value: boolean | ((prev: boolean) => boolean)) => void
  setShowWishlistPanel: (value: boolean | ((prev: boolean) => boolean)) => void
  setShowChatPanel: (value: boolean | ((prev: boolean) => boolean)) => void
}

/**
 * Hook to manage completeness, wishlist, and chat panel visibility state
 *
 * Supports both internal state management and external control via props.
 * When external state is provided, it takes precedence over internal state.
 * Only one panel can be open at a time (mutual exclusivity).
 *
 * @param options External state and toggle handlers (optional)
 * @returns Panel visibility state and setters
 */
export function usePanelState({
  externalShowCompletenessPanel,
  externalShowWishlistPanel,
  externalShowChatPanel,
  onToggleCompleteness,
  onToggleWishlist,
  onToggleChat,
}: UsePanelStateOptions = {}): UsePanelStateReturn {
  // Internal panel state (used when external state not provided)
  const [internalShowCompletenessPanel, setInternalShowCompletenessPanel] = useState(false)
  const [internalShowWishlistPanel, setInternalShowWishlistPanel] = useState(false)
  const [internalShowChatPanel, setInternalShowChatPanel] = useState(false)

  // Use external state if provided, otherwise use internal
  const showCompletenessPanel = externalShowCompletenessPanel ?? internalShowCompletenessPanel
  const showWishlistPanel = externalShowWishlistPanel ?? internalShowWishlistPanel
  const showChatPanel = externalShowChatPanel ?? internalShowChatPanel

  // Wrap setters to support both internal and external state management
  const setShowCompletenessPanel = onToggleCompleteness
    ? (_value: boolean | ((prev: boolean) => boolean)) => {
        // When external toggle is provided, call it (ignores the value)
        onToggleCompleteness()
      }
    : setInternalShowCompletenessPanel

  const setShowWishlistPanel = onToggleWishlist
    ? (_value: boolean | ((prev: boolean) => boolean)) => {
        // When external toggle is provided, call it (ignores the value)
        onToggleWishlist()
      }
    : setInternalShowWishlistPanel

  const setShowChatPanel = onToggleChat
    ? (_value: boolean | ((prev: boolean) => boolean)) => {
        // When external toggle is provided, call it (ignores the value)
        onToggleChat()
      }
    : setInternalShowChatPanel

  return {
    showCompletenessPanel,
    showWishlistPanel,
    showChatPanel,
    setShowCompletenessPanel,
    setShowWishlistPanel,
    setShowChatPanel,
  }
}
