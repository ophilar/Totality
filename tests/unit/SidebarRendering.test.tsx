/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { Sidebar } from '@/components/layout/Sidebar'
import { SourceProvider } from '@/contexts/SourceContext'
import { ToastProvider } from '@/contexts/ToastContext'
import { cleanupTestDb, setupRealIntegratedBridge, setupTestDb } from '@tests/TestUtils'
import React from 'react'

describe('Sidebar Rendering', () => {
  const mockOnOpenAbout = vi.fn()
  const mockOnToggleCollapse = vi.fn()
  let api: ReturnType<typeof setupRealIntegratedBridge>['api']

  beforeEach(async () => {
    vi.resetAllMocks()
    const db = await setupTestDb()
    await Promise.all([
      db.sources.upsertSource({
        source_id: 's1', source_type: 'local', display_name: 'Local Movies',
        connection_config: '{}', is_enabled: 0,
      }),
      db.sources.upsertSource({
        source_id: 's2', source_type: 'plex', display_name: 'Plex Server',
        connection_config: '{}', is_enabled: 0,
      }),
    ])
    api = setupRealIntegratedBridge().api
    Object.assign(window, {
      electronAPI: api,
    })
  })

  afterEach(() => {
    cleanup()
    cleanupTestDb()
  })

  function renderSidebar(isCollapsed = false) {
    return render(
      <ToastProvider>
        <SourceProvider>
          <Sidebar
            onOpenAbout={mockOnOpenAbout}
            isCollapsed={isCollapsed}
            onToggleCollapse={mockOnToggleCollapse}
          />
        </SourceProvider>
      </ToastProvider>
    )
  }

  it('should render source list when expanded', async () => {
    await act(async () => {
      renderSidebar()
    })

    expect(screen.getByText('Local Movies')).toBeTruthy()
    expect(screen.getByText('Plex Server')).toBeTruthy()
    expect(screen.getByText('Media Sources')).toBeTruthy()
  })

  it('should render icons only when collapsed', async () => {
    await act(async () => {
      renderSidebar(true)
    })

    expect(screen.queryByText('Local Movies')).toBeNull()
    expect(screen.queryByText('Media Sources')).toBeNull()
    
    // Check for the collapse/expand button
    const toggleButton = screen.getByLabelText('Expand sidebar')
    expect(toggleButton).toBeTruthy()
  })

  it('should call onToggleCollapse when toggle button clicked', async () => {
    await act(async () => {
      renderSidebar()
    })

    const toggleButton = screen.getByLabelText('Collapse sidebar')
    await act(async () => {
      fireEvent.click(toggleButton)
    })
    expect(mockOnToggleCollapse).toHaveBeenCalled()
  })

  it('should show loading state', async () => {
    let resolveSources!: (sources: []) => void
    api.sourcesList = () => new Promise(resolve => { resolveSources = resolve })

    await act(async () => {
      renderSidebar()
    })

    // Check for loader (Loader2 has animate-spin)
    const loader = document.querySelector('.animate-spin')
    expect(loader).toBeTruthy()

    await act(async () => resolveSources([]))
  })
})



