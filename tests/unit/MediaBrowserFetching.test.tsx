/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MediaBrowser } from '@/components/library/MediaBrowser'
import { setupTestDb, cleanupTestDb, setupRealIntegratedBridge } from '@tests/TestUtils'
import { registerDatabaseHandlers } from '@main/ipc/database'
import { TestProviders } from '@tests/TestProviders'
import React from 'react'

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
    render(React.createElement(TestProviders, null, React.createElement(MediaBrowser)))

    await waitFor(() => {
      // Should show empty state message since DB is empty
      expect(screen.queryByText(/No movies found/i)).toBeTruthy()
    }, { timeout: 10000 })
  })
})
