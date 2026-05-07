/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MediaBrowser } from '@/components/library/MediaBrowser'
import { LibraryProvider } from '@/contexts/LibraryContext'
import { SourceProvider } from '@/contexts/SourceContext'
import { ToastProvider } from '@/contexts/ToastContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { WishlistProvider } from '@/contexts/WishlistContext'
import { ScrollMemoryProvider } from '@/contexts/ScrollMemoryContext'
import { setupTestDb, cleanupTestDb, setupRealIntegratedBridge } from '@tests/TestUtils'
import { registerDatabaseHandlers } from '@main/ipc/database'
import React from 'react'

const AllProviders = ({ children }: { children: React.ReactNode }) => (
  <ToastProvider>
    <ThemeProvider>
      <SourceProvider>
        <WishlistProvider>
          <ScrollMemoryProvider>
            <LibraryProvider>
              {children}
            </LibraryProvider>
          </ScrollMemoryProvider>
        </WishlistProvider>
      </SourceProvider>
    </ThemeProvider>
  </ToastProvider>
)

describe('MediaBrowser Data Fetching (Real Integrated Bridge)', () => {
  let db: any

  beforeEach(async () => {
    db = await setupTestDb()
    setupRealIntegratedBridge()
    registerDatabaseHandlers()
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('triggers data fetching on mount and handles empty state', async () => {
    render(React.createElement(AllProviders, null, React.createElement(MediaBrowser)))

    await waitFor(() => {
      // Should show empty state message since DB is empty
      expect(screen.queryByText(/No movies found/i)).toBeTruthy()
    }, { timeout: 10000 })
  })
})
