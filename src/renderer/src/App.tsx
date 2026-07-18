import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { MediaBrowser } from '@/components/library/MediaBrowser'
import { Dashboard } from '@/components/dashboard/Dashboard'
import { WishlistPanel } from '@/components/wishlist/WishlistPanel'
import { CompletenessPanel } from '@/components/library/CompletenessPanel'
import { ChatPanel } from '@/components/chat/ChatPanel'
import type { ViewContext } from '@/hooks/useChat'
import { AIInsightsPanel } from '@/components/library/AIInsightsPanel'
import { SourceProvider, useSources } from '@/contexts/SourceContext'
import { WishlistProvider } from '@/contexts/WishlistContext'
import { NavigationProvider, useNavigation } from '@/contexts/NavigationContext'
import { ToastProvider } from '@/contexts/ToastContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { LibraryProvider, useLibrary } from '@/contexts/LibraryContext'
import { AddSourceModal } from '@/components/sources/AddSourceModal'
import { AboutModal } from '@/components/ui/AboutModal'
import { SettingsPanel } from '@/components/settings/SettingsPanel'
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard'
import { SplashScreen } from '@/components/layout/SplashScreen'
import { ToastContainer } from '@/components/ui/Toast'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { SectionErrorBoundary } from '@/components/ui/SectionErrorBoundary'
import type { MediaViewType, SeriesStats, CollectionStats, MusicCompletenessStats, AnalysisProgress } from '@/components/library/types'

type AppView = 'dashboard' | 'library'

import { usePanel } from '@/contexts/PanelContext'

function AppContent() {
  const { isLoading, sources, activeSourceId, hasMovies, hasTV, hasMusic } = useSources()
  const [showAddSourceModal, setShowAddSourceModal] = useState(false)
  const [showAboutModal, setShowAboutModal] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState<string | undefined>(undefined)
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(null)
  const [splashComplete, setSplashComplete] = useState(() => sessionStorage.getItem('splashShown') === 'true')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('sidebar-collapsed') === 'true')
  const [currentView, setCurrentView] = useState<AppView>('dashboard')
  const { view: libraryTab, setView: setLibraryTab } = useLibrary()

  // Navigation history
  const { pushNavState, goBack, goForward, canGoBack, canGoForward } = useNavigation()
  const isRestoringRef = useRef(false)

  const {
    showCompletenessPanel,
    showWishlistPanel,
    showChatPanel,
    showAIInsights,
    aiInsightsInitialReport,
    openAIInsights,
    closeAIInsights,
  } = usePanel()

  // Auto-refresh state (passed up from MediaBrowser)
  const [isAutoRefreshing, setIsAutoRefreshing] = useState(false)

  // Completeness panel state - managed at app level for both Dashboard and Library views
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress | null>(null)
  const [analysisType, setAnalysisType] = useState<'series' | 'collections' | 'music' | null>(null)

  // Persist sidebar collapsed state
  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', String(sidebarCollapsed))
  }, [sidebarCollapsed])
  const hasSignaledReady = useRef(false)

  const markSplashShown = () => {
    sessionStorage.setItem('splashShown', 'true')
    setSplashComplete(true)
  }

  useEffect(() => {
    window.electronAPI.getSetting('onboarding_completed')
      .then(value => setOnboardingComplete(value === 'true'))
      .catch(err => {
        window.electronAPI.log.error('[App]', 'Failed to load onboarding state:', err)
        setOnboardingComplete(false)
      })
  }, [])

  // Signal to main process that we're ready to show content
  useEffect(() => {
    if (!hasSignaledReady.current && !isLoading && onboardingComplete !== null) {
      hasSignaledReady.current = true
      // Small delay to ensure content is painted
      setTimeout(() => {
        window.electronAPI.appReady()
      }, 50)
    }
  }, [isLoading, onboardingComplete])

  // Listen for completeness analysis progress events
  useEffect(() => {
    const cleanupSeriesProgress = window.electronAPI.onSeriesProgress((prog: unknown) => {
      setAnalysisProgress(prog as AnalysisProgress)
      setIsAnalyzing(true)
      setAnalysisType('series')
    })
    const cleanupCollectionsProgress = window.electronAPI.onCollectionsProgress((prog: unknown) => {
      setAnalysisProgress(prog as AnalysisProgress)
      setIsAnalyzing(true)
      setAnalysisType('collections')
    })
    const cleanupMusicProgress = window.electronAPI.onMusicAnalysisProgress((prog: unknown) => {
      setAnalysisProgress(prog as AnalysisProgress)
      setIsAnalyzing(true)
      setAnalysisType('music')
    })

    // Listen for task queue updates to detect completion
    const cleanupTaskQueue = window.electronAPI.onTaskQueueUpdated((state: unknown) => {
      const queueState = state as { currentTask: { status: string } | null }
      if (!queueState.currentTask || queueState.currentTask.status === 'completed') {
        setIsAnalyzing(false)
        setAnalysisProgress(null)
        setAnalysisType(null)
      }
    })

    return () => {
      cleanupSeriesProgress()
      cleanupCollectionsProgress()
      cleanupMusicProgress()
      cleanupTaskQueue()
    }
  }, [])

  // Analysis handlers
  const handleAnalyzeSeries = async (_libraryId?: string) => {
    try {
      const sourceName = activeSourceId
        ? sources.find(s => s.source_id === activeSourceId)?.display_name
        : 'All Sources'
      await window.electronAPI.taskQueueAddTask({
        type: 'series-completeness',
        label: `Analyze TV Series (${sourceName || 'All Sources'})`,
        sourceId: activeSourceId || undefined,
      })
    } catch (err) {
      window.electronAPI.log.error('[App]', 'Failed to queue series analysis:', err)
    }
  }

  const handleAnalyzeCollections = async (_libraryId?: string) => {
    try {
      const sourceName = activeSourceId
        ? sources.find(s => s.source_id === activeSourceId)?.display_name
        : 'All Sources'
      await window.electronAPI.taskQueueAddTask({
        type: 'collection-completeness',
        label: `Analyze Collections (${sourceName || 'All Sources'})`,
        sourceId: activeSourceId || undefined,
      })
    } catch (err) {
      window.electronAPI.log.error('[App]', 'Failed to queue collections analysis:', err)
    }
  }

  const handleAnalyzeMusic = async () => {
    try {
      const sourceName = activeSourceId
        ? sources.find(s => s.source_id === activeSourceId)?.display_name
        : 'All Sources'
      await window.electronAPI.taskQueueAddTask({
        type: 'music-completeness',
        label: `Analyze Music (${sourceName || 'All Sources'})`,
        sourceId: activeSourceId || undefined,
      })
    } catch (err) {
      window.electronAPI.log.error('[App]', 'Failed to queue music analysis:', err)
    }
  }

  const handleCancelAnalysis = async () => {
    try {
      await window.electronAPI.taskQueueCancelCurrent()
    } catch (err) {
      window.electronAPI.log.error('[App]', 'Failed to cancel analysis:', err)
    }
  }

  const handleOnboardingComplete = async () => {
    try {
      await window.electronAPI.setSetting('onboarding_completed', 'true')
      markSplashShown()
      setOnboardingComplete(true)
    } catch (error) {
      window.electronAPI.log.error('[App]', 'Failed to save onboarding state:', error)
    }
  }

  const handleAddSourceSuccess = async () => {
    setShowAddSourceModal(false)
    if (!onboardingComplete) await handleOnboardingComplete()
  }

  const handleNavigateToLibrary = (tab?: MediaViewType) => {
    const newTab = tab || libraryTab
    if (!isRestoringRef.current) {
      pushNavState({ view: 'library', tab: newTab })
    }
    if (tab) setLibraryTab(tab)
    setCurrentView('library')
  }

  const handleNavigateToDashboard = () => {
    if (!isRestoringRef.current) {
      pushNavState({ view: 'dashboard' })
    }
    setCurrentView('dashboard')
  }

  const handleBack = useCallback(() => {
    const restored = goBack()
    if (!restored) return
    isRestoringRef.current = true
    setCurrentView(restored.view)
    if (restored.view === 'library' && restored.tab) {
      setLibraryTab(restored.tab)
    }
    window.dispatchEvent(new CustomEvent('navigate-restore', { detail: restored }))
    isRestoringRef.current = false
  }, [goBack])

  const handleForward = useCallback(() => {
    const restored = goForward()
    if (!restored) return
    isRestoringRef.current = true
    setCurrentView(restored.view)
    if (restored.view === 'library' && restored.tab) {
      setLibraryTab(restored.tab)
    }
    window.dispatchEvent(new CustomEvent('navigate-restore', { detail: restored }))
    isRestoringRef.current = false
  }, [goForward])

  // Keyboard shortcuts for back/forward
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault()
        handleBack()
      } else if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault()
        handleForward()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleBack, handleForward])

  const handleOpenSettings = (initialTab?: string) => {
    setSettingsInitialTab(initialTab)
    setShowSettingsModal(true)
  }

  const chatViewContext = useMemo((): ViewContext => ({
    currentView: currentView as 'dashboard' | 'library',
    libraryTab: currentView === 'library' ? libraryTab as 'movies' | 'tv' | 'music' : undefined,
    activeSourceId: activeSourceId || undefined,
  }), [currentView, libraryTab, activeSourceId])

  if (isLoading || onboardingComplete === null) {
    return (
      <div className="h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    )
  }

  // Onboarding disabled for now - to re-enable, uncomment the line below
  // const showOnboarding = sources.length === 0 && !onboardingComplete
  const showOnboarding = false
  const showSplash = !splashComplete

  if (showOnboarding) {
    return (
      <>
        <OnboardingWizard
          onComplete={handleOnboardingComplete}
          onAddSource={() => setShowAddSourceModal(true)}
        />
        {showAddSourceModal && (
          <AddSourceModal
            onClose={() => setShowAddSourceModal(false)}
            onSuccess={handleAddSourceSuccess}
          />
        )}
      </>
    )
  }

  return (
    <>
      {/* Render main app - it loads behind the splash screen */}
      <div className="relative h-screen overflow-hidden bg-main-gradient text-foreground">
        <Sidebar
          onOpenAbout={() => setShowAboutModal(true)}
          isCollapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        />

        {/* Global Top Bar */}
        <TopBar
          currentView={currentView}
          libraryTab={libraryTab}
          onNavigateHome={handleNavigateToDashboard}
          onNavigateToLibrary={handleNavigateToLibrary}
          onOpenSettings={() => handleOpenSettings()}
          isAutoRefreshing={isAutoRefreshing}
          hasMovies={hasMovies}
          hasTV={hasTV}
          hasMusic={hasMusic}
          onBack={handleBack}
          canGoBack={canGoBack}
          onForward={handleForward}
          canGoForward={canGoForward}
        />

        <main
          className="fixed top-[88px] bottom-4 transition-[left,right] duration-300 ease-out"
          style={{
            left: sidebarCollapsed ? '96px' : '288px',
            right: showCompletenessPanel || showWishlistPanel || showChatPanel ? '352px' : '16px'
          }}
        >
          {currentView === 'dashboard' ? (
            <SectionErrorBoundary section="Dashboard">
              <Dashboard
                onNavigateToLibrary={handleNavigateToLibrary}
                onAddSource={() => setShowAddSourceModal(true)}
                sidebarCollapsed={sidebarCollapsed}
                hasMovies={hasMovies}
                hasTV={hasTV}
                hasMusic={hasMusic}
              />
            </SectionErrorBoundary>
          ) : (
            <SectionErrorBoundary section="Media Library">
              <MediaBrowser
                onAddSource={() => setShowAddSourceModal(true)}
                sidebarCollapsed={sidebarCollapsed}
                onOpenSettings={handleOpenSettings}
                hideHeader={true}
                libraryTab={libraryTab}
                onLibraryTabChange={setLibraryTab}
                onAutoRefreshChange={setIsAutoRefreshing}
              />
            </SectionErrorBoundary>
          )}
        </main>
        {showAddSourceModal && (
          <AddSourceModal
            onClose={() => setShowAddSourceModal(false)}
            onSuccess={handleAddSourceSuccess}
          />
        )}
        <AboutModal isOpen={showAboutModal} onClose={() => setShowAboutModal(false)} />
        <SettingsPanel
          isOpen={showSettingsModal}
          onClose={() => {
            setShowSettingsModal(false)
            setSettingsInitialTab(undefined)
          }}
          initialTab={settingsInitialTab as 'library' | 'quality' | 'services' | 'appearance' | 'data' | 'update' | 'troubleshoot' | undefined}
        />
        {/* Panels - rendered at App level for Dashboard view */}
        {currentView === 'dashboard' && (
          <>
            <SectionErrorBoundary section="Completeness Panel" compact>
            <CompletenessPanel
                onAnalyzeSeries={handleAnalyzeSeries}
                onAnalyzeCollections={handleAnalyzeCollections}
                onAnalyzeMusic={handleAnalyzeMusic}
                onCancel={handleCancelAnalysis}
                isAnalyzing={isAnalyzing}
                analysisProgress={analysisProgress}
                analysisType={analysisType}
                onDataRefresh={() => {}}
                hasTV={hasTV}
                hasMovies={hasMovies}
                hasMusic={hasMusic}
                onOpenSettings={handleOpenSettings}
                libraries={[]}
              />
            </SectionErrorBoundary>
            <SectionErrorBoundary section="Wishlist Panel" compact>
              <WishlistPanel
                onOpenAIAdvice={() => openAIInsights('wishlist')}
              />
            </SectionErrorBoundary>
          </>
        )}
        {/* Chat Panel - rendered at App level, available in all views */}
        <ChatPanel
          onOpenSettings={() => handleOpenSettings('services')}
          viewContext={chatViewContext}
        />
        <AIInsightsPanel
          onOpenSettings={() => handleOpenSettings('services')}
        />
      </div>
      {/* Splash screen overlays the app and fades out to reveal it */}
      {showSplash && <SplashScreen onComplete={markSplashShown} />}
      {/* Toast notifications */}
      <ToastContainer />
    </>
  )
}

import { ScrollMemoryProvider } from '@/contexts/ScrollMemoryContext'
import { PanelProvider } from '@/contexts/PanelContext'

function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <ThemeProvider>
          <SourceProvider>
            <WishlistProvider>
              <NavigationProvider>
                <LibraryProvider>
                  <ScrollMemoryProvider>
                    <PanelProvider>
                      <AppContent />
                    </PanelProvider>
                  </ScrollMemoryProvider>
                </LibraryProvider>
              </NavigationProvider>
            </WishlistProvider>
          </SourceProvider>
        </ThemeProvider>
      </ToastProvider>
    </ErrorBoundary>
  )
}

export default App
