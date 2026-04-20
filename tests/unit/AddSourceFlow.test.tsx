/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AddSourceModal } from '../../src/renderer/src/components/sources/AddSourceModal'
import { useSources } from '../../src/renderer/src/contexts/SourceContext'
import { useToast } from '../../src/renderer/src/contexts/ToastContext'
import React from 'react'

// Mock context hooks
vi.mock('../../src/renderer/src/contexts/SourceContext', () => ({
  useSources: vi.fn(),
}))

vi.mock('../../src/renderer/src/contexts/ToastContext', () => ({
  useToast: vi.fn(),
}))

// Mock useFocusTrap
vi.mock('../../src/renderer/src/hooks/useFocusTrap', () => ({
  useFocusTrap: vi.fn(),
}))

// Mock window.electronAPI
const mockElectronAPI = {
  sourcesGetSupportedProviders: vi.fn().mockResolvedValue(['local', 'plex', 'jellyfin']),
  sourcesAdd: vi.fn().mockResolvedValue({ source_id: 's1' }),
  sourcesTestConnection: vi.fn().mockResolvedValue({ success: true }),
  pathSelectDirectory: vi.fn().mockResolvedValue('/selected/path'),
  onSettingsChanged: vi.fn().mockReturnValue(() => {}),
  mediaAnalyzerIsAvailable: vi.fn().mockResolvedValue(true),
}
vi.stubGlobal('window', { electronAPI: mockElectronAPI })

describe('AddSourceModal Rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(useSources as any).mockReturnValue({
      refreshSources: vi.fn(),
      supportedProviders: ['local', 'plex', 'jellyfin', 'emby', 'kodi', 'mediamonkey'],
    })
    ;(useToast as any).mockReturnValue({
      addToast: vi.fn(),
    })
  })

  it('should render provider selection first', async () => {
    render(<AddSourceModal onClose={() => {}} onSuccess={() => {}} />)
    
    expect(await screen.findByText('Local Folder')).toBeTruthy()
    expect(screen.getByText('Plex')).toBeTruthy()
  })

  it('should navigate to local folder flow when selected', async () => {
    render(<AddSourceModal onClose={() => {}} onSuccess={() => {}} />)
    
    const btn = await screen.findByText('Local Folder')
    fireEvent.click(btn)
    
    // Check for elements in LocalFolderFlow
    expect(await screen.findByText('Add Local Folder')).toBeTruthy()
    expect(screen.getByText('Browse')).toBeTruthy()
  })
})
