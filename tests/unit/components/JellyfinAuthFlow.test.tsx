/**
 * @vitest-environment jsdom
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { JellyfinAuthFlow } from '@/components/sources/JellyfinAuthFlow'
import { useSources } from '@/contexts/SourceContext'

vi.mock('@/contexts/SourceContext', () => ({
  useSources: vi.fn(),
}))

const mockGetLibraries = vi.fn()
const mockRefreshSources = vi.fn()

const mockElectronAPI = {
  jellyfinDiscoverServers: vi.fn(),
  embyDiscoverServers: vi.fn(),
  jellyfinTestServerUrl: vi.fn(),
  embyTestServerUrl: vi.fn(),
  jellyfinAuthenticateApiKey: vi.fn(),
  embyAuthenticateApiKey: vi.fn(),
  sourcesSetLibrariesEnabled: vi.fn(),
  taskQueueAddTask: vi.fn(),
  log: {
    error: vi.fn(),
  },
}

vi.stubGlobal('window', {
  electronAPI: mockElectronAPI,
})

describe('JellyfinAuthFlow Component', () => {
  const defaultProps = {
    onSuccess: vi.fn(),
    onBack: vi.fn(),
    isEmby: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useSources).mockReturnValue({
      getLibraries: mockGetLibraries,
      refreshSources: mockRefreshSources,
      sources: [],
      supportedProviders: [],
      addSource: vi.fn(),
      removeSource: vi.fn(),
      syncSource: vi.fn(),
      isLoading: false,
    } as any)

    mockElectronAPI.jellyfinDiscoverServers.mockResolvedValue([])
    mockElectronAPI.embyDiscoverServers.mockResolvedValue([])
    mockElectronAPI.jellyfinTestServerUrl.mockResolvedValue({ success: true, serverName: 'Test Jellyfin' })
    mockElectronAPI.embyTestServerUrl.mockResolvedValue({ success: true, serverName: 'Test Emby' })
    mockElectronAPI.jellyfinAuthenticateApiKey.mockResolvedValue({
      success: true,
      source: { source_id: 'src-123' },
    })
    mockElectronAPI.embyAuthenticateApiKey.mockResolvedValue({
      success: true,
      source: { source_id: 'src-456' },
    })
    mockElectronAPI.sourcesSetLibrariesEnabled.mockResolvedValue(true)
    mockElectronAPI.taskQueueAddTask.mockResolvedValue(true)
    mockGetLibraries.mockResolvedValue([])
  })

  describe('Discovery step', () => {
    it('calls jellyfinDiscoverServers on mount when isEmby is false', async () => {
      render(<JellyfinAuthFlow {...defaultProps} />)

      await screen.findByText('No Jellyfin servers found on your network. Enter address below.')
      expect(mockElectronAPI.jellyfinDiscoverServers).toHaveBeenCalledTimes(1)
      expect(mockElectronAPI.embyDiscoverServers).not.toHaveBeenCalled()
    })

    it('calls embyDiscoverServers on mount when isEmby is true', async () => {
      render(<JellyfinAuthFlow {...defaultProps} isEmby={true} />)

      await screen.findByText('No Emby servers found on your network. Enter address below.')
      expect(mockElectronAPI.embyDiscoverServers).toHaveBeenCalledTimes(1)
      expect(mockElectronAPI.jellyfinDiscoverServers).not.toHaveBeenCalled()
    })

    it('renders empty state when no servers are discovered', async () => {
      render(<JellyfinAuthFlow {...defaultProps} />)

      expect(await screen.findByText('No Jellyfin servers found on your network. Enter address below.')).toBeTruthy()
    })

    it('renders list of servers if servers are discovered and allows selecting one', async () => {
      mockElectronAPI.jellyfinDiscoverServers.mockResolvedValue([
        { id: '1', name: 'Server One', address: 'http://192.168.1.10:8096' },
        { id: '2', name: 'Server Two', address: 'http://192.168.1.20:8096' },
      ])

      render(<JellyfinAuthFlow {...defaultProps} />)

      expect(await screen.findByText('Server One')).toBeTruthy()
      expect(screen.getByText('Server Two')).toBeTruthy()

      fireEvent.click(screen.getByText('Server Two'))

      expect(await screen.findByText('API Key')).toBeTruthy()
      expect(screen.getByText('http://192.168.1.20:8096')).toBeTruthy()
    })

    it('allows rescan via handleDiscover button when servers exist', async () => {
      mockElectronAPI.jellyfinDiscoverServers
        .mockResolvedValueOnce([{ id: '1', name: 'Server One', address: 'http://192.168.1.10:8096' }])
        .mockResolvedValueOnce([{ id: '2', name: 'Server Two', address: 'http://192.168.1.20:8096' }])

      render(<JellyfinAuthFlow {...defaultProps} />)

      expect(await screen.findByText('Server One')).toBeTruthy()

      const rescanBtn = screen.getByText('Rescan')
      fireEvent.click(rescanBtn)

      expect(await screen.findByText('Server Two')).toBeTruthy()
      expect(mockElectronAPI.jellyfinDiscoverServers).toHaveBeenCalledTimes(2)
    })

    it('handles manual URL entry validation and errors', async () => {
      render(<JellyfinAuthFlow {...defaultProps} />)

      expect(await screen.findByText('No Jellyfin servers found on your network. Enter address below.')).toBeTruthy()

      const input = screen.getByPlaceholderText('http://192.168.1.100:8096')
      const connectBtn = screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement
      expect(connectBtn.disabled).toBe(true)

      fireEvent.change(input, { target: { value: 'http://192.168.1.100:8096' } })
      expect(connectBtn.disabled).toBe(false)

      mockElectronAPI.jellyfinTestServerUrl.mockResolvedValueOnce({
        success: false,
        error: 'Connection refused',
      })

      fireEvent.click(connectBtn)

      expect(await screen.findByText('Connection refused')).toBeTruthy()
    })

    it('handles successful manual URL entry transition to auth step', async () => {
      render(<JellyfinAuthFlow {...defaultProps} />)

      expect(await screen.findByText('No Jellyfin servers found on your network. Enter address below.')).toBeTruthy()

      const input = screen.getByPlaceholderText('http://192.168.1.100:8096')
      fireEvent.change(input, { target: { value: 'http://192.168.1.100:8096' } })

      mockElectronAPI.jellyfinTestServerUrl.mockResolvedValueOnce({
        success: true,
        serverName: 'Manual Jellyfin',
      })

      const connectBtn = screen.getByRole('button', { name: 'Connect' })
      fireEvent.click(connectBtn)

      expect(await screen.findByText('Manual Jellyfin')).toBeTruthy()
      expect(screen.getByText('http://192.168.1.100:8096')).toBeTruthy()
      expect(screen.getByText('API Key')).toBeTruthy()
    })

    it('calls onBack when back button in discovery step is clicked', async () => {
      render(<JellyfinAuthFlow {...defaultProps} />)

      expect(await screen.findByText('No Jellyfin servers found on your network. Enter address below.')).toBeTruthy()

      const backBtn = screen.getByRole('button', { name: 'Back' })
      fireEvent.click(backBtn)

      expect(defaultProps.onBack).toHaveBeenCalledTimes(1)
    })
  })

  describe('Auth Method step', () => {
    async function navigateToAuthStep() {
      mockElectronAPI.jellyfinDiscoverServers.mockResolvedValue([
        { id: '1', name: 'Discovered Server', address: 'http://192.168.1.50:8096' },
      ])
      render(<JellyfinAuthFlow {...defaultProps} />)
      const serverItem = await screen.findByText('Discovered Server')
      fireEvent.click(serverItem)
      expect(await screen.findByText('API Key')).toBeTruthy()
    }

    it('validates API key presence', async () => {
      await navigateToAuthStep()

      const connectBtn = screen.getByRole('button', { name: 'Connect' })
      fireEvent.click(connectBtn)

      expect(await screen.findByText('API key is required')).toBeTruthy()
    })

    it('handles authentication failure', async () => {
      mockElectronAPI.jellyfinAuthenticateApiKey.mockResolvedValueOnce({
        success: false,
        error: 'Invalid API Key',
      })

      await navigateToAuthStep()

      const apiKeyInput = screen.getByPlaceholderText('Enter your API key')
      fireEvent.change(apiKeyInput, { target: { value: 'wrong-key' } })

      const connectBtn = screen.getByRole('button', { name: 'Connect' })
      fireEvent.click(connectBtn)

      expect(await screen.findByText('Invalid API Key')).toBeTruthy()
    })

    it('allows changing server back to discovery step', async () => {
      await navigateToAuthStep()

      const changeBtn = screen.getByText('Change')
      fireEvent.click(changeBtn)

      expect(await screen.findByPlaceholderText('http://192.168.1.100:8096')).toBeTruthy()
    })

    it('authenticates successfully and advances to libraries step', async () => {
      mockGetLibraries.mockResolvedValueOnce([
        { id: 'lib-1', name: 'Movies', type: 'movie', itemCount: 150 },
        { id: 'lib-2', name: 'Music', type: 'music', itemCount: 500 },
      ])

      await navigateToAuthStep()

      const apiKeyInput = screen.getByPlaceholderText('Enter your API key')
      fireEvent.change(apiKeyInput, { target: { value: 'valid-api-key' } })

      const connectBtn = screen.getByRole('button', { name: 'Connect' })
      fireEvent.click(connectBtn)

      expect(await screen.findByText('Select libraries to include:')).toBeTruthy()
      expect(screen.getByText('Movies')).toBeTruthy()
      expect(screen.getByText('(150 items)')).toBeTruthy()
      expect(screen.getByText('Music')).toBeTruthy()
      expect(screen.getByText('(500 items)')).toBeTruthy()
    })
  })

  describe('Libraries step and Completion', () => {
    beforeEach(async () => {
      mockElectronAPI.jellyfinDiscoverServers.mockResolvedValue([
        { id: '1', name: 'Discovered Server', address: 'http://192.168.1.50:8096' },
      ])
      mockGetLibraries.mockResolvedValue([
        { id: 'lib-1', name: 'Movies', type: 'movie', itemCount: 100 },
        { id: 'lib-2', name: 'TV Shows', type: 'show', itemCount: 50 },
        { id: 'lib-3', name: 'Music Library', type: 'music', itemCount: 300 },
      ])
    })

    async function navigateToLibrariesStep() {
      render(<JellyfinAuthFlow {...defaultProps} />)
      const serverBtn = await screen.findByText('Discovered Server')
      fireEvent.click(serverBtn)
      expect(await screen.findByText('API Key')).toBeTruthy()

      const apiKeyInput = screen.getByPlaceholderText('Enter your API key')
      fireEvent.change(apiKeyInput, { target: { value: 'valid-api-key' } })

      const connectBtn = screen.getByRole('button', { name: 'Connect' })
      fireEvent.click(connectBtn)

      expect(await screen.findByText('Select libraries to include:')).toBeTruthy()
    }

    it('allows toggling libraries, select all, deselect all', async () => {
      await navigateToLibrariesStep()

      const deselectBtn = screen.getByText('Deselect All')
      fireEvent.click(deselectBtn)

      const doneBtn = screen.getByRole('button', { name: 'Select at least one library' }) as HTMLButtonElement
      expect(doneBtn.disabled).toBe(true)

      const selectAllBtn = screen.getByText('Select All')
      fireEvent.click(selectAllBtn)

      const doneBtnActive = screen.getByRole('button', { name: 'Done' }) as HTMLButtonElement
      expect(doneBtnActive.disabled).toBe(false)
    })

    it('completes setup, saves libraries, refreshes sources, queues task scans, and calls onSuccess', async () => {
      await navigateToLibrariesStep()

      const doneBtn = screen.getByRole('button', { name: 'Done' })
      fireEvent.click(doneBtn)

      expect(await screen.findByText('Select libraries to include:')).toBeTruthy()

      expect(mockElectronAPI.sourcesSetLibrariesEnabled).toHaveBeenCalledWith('src-123', [
        { id: 'lib-1', name: 'Movies', type: 'movie', enabled: true },
        { id: 'lib-2', name: 'TV Shows', type: 'show', enabled: true },
        { id: 'lib-3', name: 'Music Library', type: 'music', enabled: true },
      ])
      expect(mockRefreshSources).toHaveBeenCalledTimes(1)
      expect(mockElectronAPI.taskQueueAddTask).toHaveBeenCalledWith({
        type: 'library-scan',
        label: 'Scan Movies (Discovered Server)',
        sourceId: 'src-123',
        libraryId: 'lib-1',
      })
      expect(mockElectronAPI.taskQueueAddTask).toHaveBeenCalledWith({
        type: 'library-scan',
        label: 'Scan TV Shows (Discovered Server)',
        sourceId: 'src-123',
        libraryId: 'lib-2',
      })
      expect(mockElectronAPI.taskQueueAddTask).toHaveBeenCalledWith({
        type: 'music-scan',
        label: 'Scan Music Library (Discovered Server)',
        sourceId: 'src-123',
        libraryId: 'lib-3',
      })
      expect(defaultProps.onSuccess).toHaveBeenCalledTimes(1)
    })
  })
})
