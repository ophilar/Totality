/**
 * Vitest Global Setup
 *
 * This file runs before each test file.
 * Use it to set up mocks and global test utilities.
 */

import { vi } from 'vitest'

// Mock Electron-specific modules that don't work in Node test environment
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      switch (name) {
        case 'userData': return '/mock/user/data'
        case 'appData': return '/mock/app/data'
        case 'temp': return '/mock/temp'
        default: return `/mock/${name}`
      }
    }),
    getName: vi.fn(() => 'totality-test'),
    getVersion: vi.fn(() => '0.1.0-test'),
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn(),
  },
  contextBridge: {
    exposeInMainWorld: vi.fn(),
  },
  BrowserWindow: vi.fn(() => ({
    webContents: {
      send: vi.fn(),
    },
  })),
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn((str: string) => Buffer.from(str)),
    decryptString: vi.fn((buf: Buffer) => buf.toString()),
  },
}))

// Mock Better-SQLite3 for environments where it can't be compiled
// However, for unit tests we usually want the real thing in :memory:
// We only mock it if absolutely necessary or to track calls.

// Global test utilities
declare global {
  var __TEST__: boolean
}
globalThis.__TEST__ = true
