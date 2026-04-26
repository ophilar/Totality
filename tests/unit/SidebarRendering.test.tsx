/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Sidebar } from '../../src/renderer/src/components/layout/Sidebar'
import { useSources } from '../../src/renderer/src/contexts/SourceContext'
import { LibraryType } from '../../src/main/types/database'
import React from 'react'

// Mock useSources
vi.mock('../../src/renderer/src/contexts/SourceContext', () => ({
  useSources: vi.fn(),
}))

describe('Sidebar Rendering', () => {
  const mockOnOpenAbout = vi.fn()
  const mockOnToggleCollapse = vi.fn()

  beforeEach(() => {
    vi.resetAllMocks()
    
    // Mock window.electronAPI
    const mockElectronAPI = {
      onLibraryUpdated: vi.fn().mockReturnValue(() => {}),
      onScanCompleted: vi.fn().mockReturnValue(() => {}),
      onQualityAnalysisProgress: vi.fn().mockReturnValue(() => {}),
      onMusicScanProgress: vi.fn().mockReturnValue(() => {}),
      onTaskQueueUpdated: vi.fn().mockReturnValue(() => {}),
      taskQueueGetState: vi.fn().mockResolvedValue({ currentTask: null, queue: [], isPaused: false }),
      sourcesGetLibrariesWithStatus: vi.fn().mockResolvedValue([]),
      log: { error: vi.fn(), warn: vi.fn() }
    }
    vi.stubGlobal('window', { 
      electronAPI: mockElectronAPI, 
      navigator: { clipboard: { writeText: vi.fn() } } 
    })

    ;(useSources as any).mockReturnValue({
      sources: [
        { source_id: 's1', display_name: 'Local Movies', source_type: 'local' },
        { source_id: 's2', display_name: 'Plex Server', source_type: 'plex' }
      ],
      isLoading: false,
      scanProgress: new Map(),
      connectionStatus: new Map(),
      newItemCounts: new Map(),
      activeSourceId: 's1',
      setActiveSource: vi.fn(),
      refreshSources: vi.fn(),
      stopScan: vi.fn(),
      removeSource: vi.fn(),
      clearNewItems: vi.fn(),
      refreshLibraryTypes: vi.fn(),
    })
  })

  it('should render source list when expanded', () => {
    render(
      <Sidebar
        onOpenAbout={mockOnOpenAbout}
        isCollapsed={false}
        onToggleCollapse={mockOnToggleCollapse}
      />
    )

    expect(screen.getByText('Local Movies')).toBeTruthy()
    expect(screen.getByText('Plex Server')).toBeTruthy()
    expect(screen.getByText('Media Sources')).toBeTruthy()
  })

  it('should render icons only when collapsed', () => {
    render(
      <Sidebar
        onOpenAbout={mockOnOpenAbout}
        isCollapsed={true}
        onToggleCollapse={mockOnToggleCollapse}
      />
    )

    expect(screen.queryByText('Local Movies')).toBeNull()
    expect(screen.queryByText('Media Sources')).toBeNull()
    
    // Check for the collapse/expand button
    const toggleButton = screen.getByLabelText('Expand sidebar')
    expect(toggleButton).toBeTruthy()
  })

  it('should call onToggleCollapse when toggle button clicked', () => {
    render(
      <Sidebar
        onOpenAbout={mockOnOpenAbout}
        isCollapsed={false}
        onToggleCollapse={mockOnToggleCollapse}
      />
    )

    const toggleButton = screen.getByLabelText('Collapse sidebar')
    fireEvent.click(toggleButton)
    expect(mockOnToggleCollapse).toHaveBeenCalled()
  })

  it('should show loading state', () => {
    ;(useSources as any).mockReturnValue({
      sources: [],
      isLoading: true,
      scanProgress: new Map(),
      connectionStatus: new Map(),
      newItemCounts: new Map(),
    })

    render(
      <Sidebar
        onOpenAbout={mockOnOpenAbout}
        isCollapsed={false}
        onToggleCollapse={mockOnToggleCollapse}
      />
    )

    // Check for loader (Loader2 has animate-spin)
    const loader = document.querySelector('.animate-spin')
    expect(loader).toBeTruthy()
  })
})
