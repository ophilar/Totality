import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ipcMain } from 'electron'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import { getLoggingService } from '@main/services/LoggingService'

// Import all registration functions
import { registerDatabaseHandlers } from '@main/ipc/database'
import { registerQualityHandlers } from '@main/ipc/quality'
import { registerSeriesHandlers } from '@main/ipc/series'
import { registerCollectionHandlers } from '@main/ipc/collections'
import { registerSourceHandlers } from '@main/ipc/sources'
import { registerJellyfinHandlers } from '@main/ipc/jellyfin'
import { registerMusicHandlers } from '@main/ipc/music'
import { registerWishlistHandlers } from '@main/ipc/wishlist'
import { registerMonitoringHandlers } from '@main/ipc/monitoring'
import { registerNotificationHandlers } from '@main/ipc/notifications'
import { registerTaskQueueHandlers } from '@main/ipc/taskQueue'
import { registerLoggingHandlers } from '@main/ipc/logging'
import { registerAutoUpdateHandlers } from '@main/ipc/autoUpdate'
import { registerGeminiHandlers } from '@main/ipc/gemini'
import { registerDuplicateHandlers } from '@main/ipc/duplicates'
import { registerTranscodingHandlers } from '@main/ipc/transcoding'
import { registerMediaHandlers } from '@main/ipc/media'

describe('IPC Duplicate Handler Auditor', () => {
  let db: any
  const registeredChannels = new Set<string>()

  beforeEach(async () => {
    registeredChannels.clear()
    vi.clearAllMocks()
    db = await setupTestDb()
    getLoggingService().setDatabaseGetter(() => db)

    // Intercept ipcMain.handle to assert uniqueness
    vi.mocked(ipcMain.handle).mockImplementation((channel: string) => {
      if (registeredChannels.has(channel)) {
        throw new Error(`Duplicate IPC handler registered: "${channel}"`)
      }
      registeredChannels.add(channel)
      return undefined as any
    })
  })

  afterEach(() => {
    cleanupTestDb()
  })

  it('runs all 17 IPC registrations with no duplicate handlers', () => {
    const registrars = [
      registerDatabaseHandlers,
      registerQualityHandlers,
      registerSeriesHandlers,
      registerCollectionHandlers,
      registerSourceHandlers,
      registerJellyfinHandlers,
      registerMusicHandlers,
      registerWishlistHandlers,
      registerMonitoringHandlers,
      registerNotificationHandlers,
      registerTaskQueueHandlers,
      registerLoggingHandlers,
      registerAutoUpdateHandlers,
      registerGeminiHandlers,
      registerDuplicateHandlers,
      registerTranscodingHandlers,
      registerMediaHandlers
    ]

    expect(() => {
      for (const register of registrars) {
        register()
      }
    }).not.toThrow()
  })
})
