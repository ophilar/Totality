import React, { createContext, useContext, useState, useMemo } from 'react'

export interface PanelContextType {
  showCompletenessPanel: boolean
  setShowCompletenessPanel: React.Dispatch<React.SetStateAction<boolean>>
  showWishlistPanel: boolean
  setShowWishlistPanel: React.Dispatch<React.SetStateAction<boolean>>
  showChatPanel: boolean
  setShowChatPanel: React.Dispatch<React.SetStateAction<boolean>>
  showAIInsights: boolean
  setShowAIInsights: React.Dispatch<React.SetStateAction<boolean>>
  aiInsightsInitialReport: string | undefined
  setAiInsightsInitialReport: React.Dispatch<React.SetStateAction<string | undefined>>
  toggleCompleteness: () => void
  toggleWishlist: () => void
  toggleChat: () => void
  openAIInsights: (report?: string) => void
  closeAIInsights: () => void
}

const PanelContext = createContext<PanelContextType | undefined>(undefined)

export function PanelProvider({ children }: { children: React.ReactNode }) {
  const [showCompletenessPanel, setShowCompletenessPanel] = useState(false)
  const [showWishlistPanel, setShowWishlistPanel] = useState(false)
  const [showChatPanel, setShowChatPanel] = useState(false)
  const [showAIInsights, setShowAIInsights] = useState(false)
  const [aiInsightsInitialReport, setAiInsightsInitialReport] = useState<string | undefined>(undefined)

  const toggleCompleteness = () => {
    setShowCompletenessPanel(prev => {
      const next = !prev
      if (next) {
        setShowWishlistPanel(false)
        setShowChatPanel(false)
      }
      return next
    })
  }

  const toggleWishlist = () => {
    setShowWishlistPanel(prev => {
      const next = !prev
      if (next) {
        setShowCompletenessPanel(false)
        setShowChatPanel(false)
      }
      return next
    })
  }

  const toggleChat = () => {
    setShowChatPanel(prev => {
      const next = !prev
      if (next) {
        setShowCompletenessPanel(false)
        setShowWishlistPanel(false)
      }
      return next
    })
  }

  const openAIInsights = (report?: string) => {
    setAiInsightsInitialReport(report)
    setShowAIInsights(true)
  }

  const closeAIInsights = () => {
    setShowAIInsights(false)
    setAiInsightsInitialReport(undefined)
  }

  const value = useMemo(() => ({
    showCompletenessPanel,
    setShowCompletenessPanel,
    showWishlistPanel,
    setShowWishlistPanel,
    showChatPanel,
    setShowChatPanel,
    showAIInsights,
    setShowAIInsights,
    aiInsightsInitialReport,
    setAiInsightsInitialReport,
    toggleCompleteness,
    toggleWishlist,
    toggleChat,
    openAIInsights,
    closeAIInsights
  }), [showCompletenessPanel, showWishlistPanel, showChatPanel, showAIInsights, aiInsightsInitialReport])

  return (
    <PanelContext.Provider value={value}>
      {children}
    </PanelContext.Provider>
  )
}

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
