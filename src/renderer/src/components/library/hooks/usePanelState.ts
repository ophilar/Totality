import { useState } from 'react'
import { usePanel } from '@/contexts/PanelContext'

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
 * Hook to manage completeness, wishlist, and chat panel visibility state.
 * Refactored to leverage PanelContext globally, while preserving fallback for tests.
 */
export function usePanelState({
  externalShowCompletenessPanel,
  externalShowWishlistPanel,
  externalShowChatPanel,
  onToggleCompleteness,
  onToggleWishlist,
  onToggleChat,
}: UsePanelStateOptions = {}): UsePanelStateReturn {
  try {
    const context = usePanel()
    return {
      showCompletenessPanel: context.showCompletenessPanel,
      showWishlistPanel: context.showWishlistPanel,
      showChatPanel: context.showChatPanel,
      setShowCompletenessPanel: (value) => {
        if (typeof value === 'function') {
          context.setShowCompletenessPanel(value)
        } else {
          context.setShowCompletenessPanel(value)
        }
      },
      setShowWishlistPanel: (value) => {
        if (typeof value === 'function') {
          context.setShowWishlistPanel(value)
        } else {
          context.setShowWishlistPanel(value)
        }
      },
      setShowChatPanel: (value) => {
        if (typeof value === 'function') {
          context.setShowChatPanel(value)
        } else {
          context.setShowChatPanel(value)
        }
      },
    }
  } catch (error) {
    // Fall back to original logic if Context is not present (e.g. in isolated tests)
    const [internalShowCompletenessPanel, setInternalShowCompletenessPanel] = useState(false)
    const [internalShowWishlistPanel, setInternalShowWishlistPanel] = useState(false)
    const [internalShowChatPanel, setInternalShowChatPanel] = useState(false)

    return {
      showCompletenessPanel: externalShowCompletenessPanel ?? internalShowCompletenessPanel,
      showWishlistPanel: externalShowWishlistPanel ?? internalShowWishlistPanel,
      showChatPanel: externalShowChatPanel ?? internalShowChatPanel,
      setShowCompletenessPanel: onToggleCompleteness
        ? () => onToggleCompleteness()
        : setInternalShowCompletenessPanel,
      setShowWishlistPanel: onToggleWishlist
        ? () => onToggleWishlist()
        : setInternalShowWishlistPanel,
      setShowChatPanel: onToggleChat
        ? () => onToggleChat()
        : setInternalShowChatPanel,
    }
  }
}
