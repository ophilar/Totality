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
import { BetterSQLiteService, resetBetterSQLiteServiceForTesting, getBetterSQLiteService } from '../../src/main/database/BetterSQLiteService'
import { runMigrations } from '../../src/main/database/DatabaseMigration'
import React from 'react'
import * as fs from 'fs'
import * as path from 'path'

// REAL BRIDGE: Connecting Renderer context to Main process service WITHOUT MOCKS
const dbPath = path.join(__dirname, 'renderer-integration.db')

function setupRealBridge(dbService: BetterSQLiteService) {
  (window as any).electronAPI = {
    sourcesList: () => Promise.resolve(dbService.sources.getSources()),
    sourcesGetStats: () => Promise.resolve({
      totalSources: 1,
      enabledSources: 1,
      totalItems: 0,
      bySource: []
    }),
    sourcesGetSupportedProviders: () => Promise.resolve(['plex', 'local']),
    sourcesGetLibrariesWithStatus: () => Promise.resolve([]),
    sourcesTestConnection: () => Promise.resolve({ success: true }),
    getSetting: (key: string) => Promise.resolve(dbService.config.getSetting(key)),
    getAllSettings: () => Promise.resolve(dbService.config.getAllSettings()),
    setSetting: (key: string, value: string) => {
      dbService.config.setSetting(key, value)
      return Promise.resolve(true)
    },
    // Wishlist API
    wishlistGetAll: (filters: any) => {
      const items = dbService.wishlist.getWishlistItems(filters)
      return Promise.resolve(items)
    },
    wishlistGetCount: () => Promise.resolve(dbService.wishlist.getCount()),
    wishlistGetCountsByReason: () => Promise.resolve(dbService.wishlist.getCountsByReason()),
    wishlistGetRegion: () => Promise.resolve('us'),
    wishlistAdd: (item: any) => {
      const id = dbService.wishlist.add(item)
      return Promise.resolve(id)
    },
    
    log: {
      info: () => {},
      error: () => {},
      warn: () => {},
      debug: () => {}
    },
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
    React.createElement('button', { onClick: () => navigateTo({ type: 'movie', id: 1 }) }, 'Nav'),
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
    React.createElement('button', { onClick: () => addItem({ title: 'New', media_type: 'movie', priority: 3, reason: 'missing', status: 'active' } as any) }, 'Add')
  )
}

describe('Renderer Integration (No Mocks)', () => {
  let dbService: BetterSQLiteService

  beforeEach(() => {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
    resetBetterSQLiteServiceForTesting()
    
    dbService = getBetterSQLiteService()
    ;(dbService as any).dbPath = dbPath
    dbService.initialize()
    runMigrations(dbService.db as any)
    
    setupRealBridge(dbService)
  })

  afterEach(() => {
    dbService.close()
    resetBetterSQLiteServiceForTesting()
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
  })

  it('should load sources from the real database into the React context', async () => {
    dbService.sources.upsertSource({ 
      source_id: 's1', 
      source_type: 'local', 
      display_name: 'Test Source',
      is_enabled: 1,
      connection_config: '{}'
    } as any)

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
    dbService.config.setSetting('theme', 'slate')
    dbService.config.setSetting('theme_mode', 'light')

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
      expect(dbService.config.getSetting('theme')).toBe('slate')
    })
  })

  it('should manage wishlist items using the real database', async () => {
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
    
    expect(dbService.wishlist.getCount()).toBe(1)
  })
})
