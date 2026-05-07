/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { SourceProvider, useSources } from '@/contexts/SourceContext'
import { ToastProvider } from '@/contexts/ToastContext'
import { NavigationProvider, useNavigation } from '@/contexts/NavigationContext'
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext'
import { WishlistProvider, useWishlist } from '@/contexts/WishlistContext'
import { LibraryType } from '@main/types/database'
import { setupTestDb, cleanupTestDb, setupRealIntegratedBridge } from '@tests/TestUtils'
import { registerDatabaseHandlers } from '@main/ipc/database'
import { registerWishlistHandlers } from '@main/ipc/wishlist'
import { registerSourceHandlers } from '@main/ipc/sources'
import { registerTaskQueueHandlers } from '@main/ipc/taskQueue'

import React from 'react'

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

describe('Renderer Integration (Real Bridge & DB)', () => {
  let db: any

  beforeEach(async () => {
    db = await setupTestDb()
    setupRealIntegratedBridge()
    registerDatabaseHandlers()
    registerWishlistHandlers()
    registerSourceHandlers()
    registerTaskQueueHandlers()
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('should load sources from the real database into the React context', async () => {
    // Add source directly to real DB
    await db.sources.upsertSource({
      source_id: 's1', 
      source_type: 'local' as any, 
      display_name: 'Real Source',
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

  it('should sync theme with real database settings', async () => {
    await db.config.setSetting('theme', 'slate')
    await db.config.setSetting('theme_mode', 'light')

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
    
    await waitFor(async () => {
      expect(await db.config.getSetting('theme')).toBe('slate')
    })
  })

  it('should manage wishlist items in the real database', async () => {
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
      // Wait for async effect in addItem
      await new Promise(resolve => setTimeout(resolve, 500))
    })

    await waitFor(() => {
      expect(screen.getByText('Items: 1')).toBeTruthy()
    }, { timeout: 5000 })
    
    expect((await db.wishlist.getItems({})).length).toBe(1)
  })
})
