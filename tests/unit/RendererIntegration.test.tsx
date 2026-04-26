/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { SourceProvider, useSources } from '../../src/renderer/src/contexts/SourceContext'
import { ToastProvider } from '../../src/renderer/src/contexts/ToastContext'
import { NavigationProvider, useNavigation } from '../../src/renderer/src/contexts/NavigationContext'
import { ThemeProvider, useTheme } from '../../src/renderer/src/contexts/ThemeContext'
import { WishlistProvider, useWishlist } from '../../src/renderer/src/contexts/WishlistContext'
import { LibraryType } from '../../src/main/types/database'


import React from 'react'
import * as fs from 'fs'
import * as path from 'path'

// REAL BRIDGE: Connecting Renderer context to Main process service WITHOUT MOCKS

let mockDb = {
  sources: [] as any[],
  settings: { theme: 'default', theme_mode: 'dark' } as Record<string, any>,
  wishlist: [] as any[]
}

function setupMockBridge() {
  (window as any).electronAPI = {
    sourcesList: () => Promise.resolve(mockDb.sources),
    sourcesGetStats: () => Promise.resolve({
      totalSources: 1,
      enabledSources: 1,
      totalItems: 0,
      bySource: []
    }),
    sourcesGetSupportedProviders: () => Promise.resolve(['plex', 'local']),
    sourcesGetLibrariesWithStatus: () => Promise.resolve([]),
    sourcesTestConnection: () => Promise.resolve({ success: true }),
    getSetting: (key: string) => Promise.resolve(mockDb.settings[key]),
    getAllSettings: () => Promise.resolve(mockDb.settings),
    setSetting: (key: string, value: string) => {
      mockDb.settings[key] = value
      return Promise.resolve(true)
    },
    wishlistGetAll: () => Promise.resolve(mockDb.wishlist),
    wishlistGetCount: () => Promise.resolve(mockDb.wishlist.length),
    wishlistGetCountsByReason: () => Promise.resolve([]),
    wishlistGetRegion: () => Promise.resolve('us'),
    wishlistAdd: (item: any) => {
      mockDb.wishlist.push({ id: mockDb.wishlist.length + 1, ...item })
      return Promise.resolve(mockDb.wishlist.length)
    },
    log: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
    onSourcesScanProgress: () => () => {},
    onScanCompleted: () => () => {},
    onSettingsChanged: () => () => {},
    onSourcesScanCompleted: () => () => {},
    onWishlistAutoCompleted: () => () => {},
  }
}


function SourceConsumer() {
  const { sources, isLoading } = useSources()
  if (isLoading) return React.createElement('div', null, 'Loading...')
  return React.createElement('div', null, `Sources: ${sources.length}`)
}

function NavConsumer() {
  const { navigateTo, pendingNavigation, canGoBack, pushNavState } = useNavigation()
  return React.createElement('div', null, 
    React.createElement('button', { onClick: () => navigateTo({ type: LibraryType.Movie as any, id: 1 }) }, 'Nav'),
    React.createElement('button', { onClick: () => pushNavState({ view: 'library' }) }, 'Push'),
    React.createElement('span', null, `Pending: ${pendingNavigation?.id || 'none'}`),
    React.createElement('span', null, `Back: ${canGoBack}`)
  )
}

function ThemeConsumer() {
  const { theme, mode, setTheme } = useTheme()
  return React.createElement('div', null,
    React.createElement('span', null, `Theme: ${theme}`),
    React.createElement('span', null, `Mode: ${mode}`),
    React.createElement('button', { onClick: () => setTheme('slate') }, 'SetSlate')
  )
}

function WishlistConsumer() {
  const { items, addItem } = useWishlist()
  return React.createElement('div', null,
    React.createElement('span', null, `Items: ${items.length}`),
    React.createElement('button', { onClick: () => addItem({ title: 'New', media_type: LibraryType.Movie as any, priority: 3, reason: 'missing', status: 'active' } as any) }, 'Add')
  )
}

describe('Renderer Integration (Mocked Bridge)', () => {
  beforeEach(() => {
    mockDb = {
      sources: [],
      settings: { theme: 'default', theme_mode: 'dark' },
      wishlist: []
    }
    setupMockBridge()
  })

  it('should load sources from the mock bridge into the React context', async () => {
    mockDb.sources.push({
      source_id: 's1', 
      source_type: 'local', 
      display_name: 'Test Source',
      is_enabled: 1,
      connection_config: '{}'
    })

    render(
      React.createElement(ToastProvider, null,
        React.createElement(SourceProvider, null, 
          React.createElement(SourceConsumer)
        )
      )
    )

    await waitFor(() => {
      expect(screen.getByText('Sources: 1')).toBeTruthy()
    }, { timeout: 5000 })
  })

  it('should handle navigation state across components', () => {
    render(
      React.createElement(NavigationProvider, null,
        React.createElement(NavConsumer)
      )
    )

    fireEvent.click(screen.getByText('Nav'))
    expect(screen.getByText('Pending: 1')).toBeTruthy()

    fireEvent.click(screen.getByText('Push'))
    expect(screen.getByText('Back: true')).toBeTruthy()
  })

  it('should sync theme with database settings', async () => {
    mockDb.settings['theme'] = 'slate'
    mockDb.settings['theme_mode'] = 'light'

    render(
      React.createElement(ThemeProvider, null,
        React.createElement(ThemeConsumer)
      )
    )

    await waitFor(() => {
      expect(screen.getByText('Theme: slate')).toBeTruthy()
      expect(screen.getByText('Mode: light')).toBeTruthy()
    })

    fireEvent.click(screen.getByText('SetSlate'))
    
    await waitFor(() => {
      expect(mockDb.settings['theme']).toBe('slate')
    })
  })

  it('should manage wishlist items using the mock bridge', async () => {
    render(
      React.createElement(ToastProvider, null,
        React.createElement(WishlistProvider, null,
          React.createElement(WishlistConsumer)
        )
      )
    )

    await waitFor(() => {
      expect(screen.getByText('Items: 0')).toBeTruthy()
    })

    await act(async () => {
      fireEvent.click(screen.getByText('Add'))
    })

    // Add logging to setupRealBridge if needed to see if wishlistGetAll is called
    await waitFor(() => {
      expect(screen.getByText('Items: 1')).toBeTruthy()
    }, { timeout: 2000 })
    
    expect(mockDb.wishlist.length).toBe(1)
  })
})
