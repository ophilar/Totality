import { useContext } from 'react'
import { PanelContext } from './PanelContextStore'

export function usePanel() {
  const context = useContext(PanelContext)
  if (!context) {
    return {
      showCompletenessPanel: false,
      setShowCompletenessPanel: () => {},
      showWishlistPanel: false,
      setShowWishlistPanel: () => {},
      showChatPanel: false,
      setShowChatPanel: () => {},
      showAIInsights: false,
      setShowAIInsights: () => {},
      aiInsightsInitialReport: undefined,
      setAiInsightsInitialReport: () => {},
      toggleCompleteness: () => {},
      toggleWishlist: () => {},
      toggleChat: () => {},
      openAIInsights: () => {},
      closeAIInsights: () => {}
    }
  }
  return context
}
