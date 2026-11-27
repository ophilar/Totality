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
  BrowserWindow: Object.assign(vi.fn(() => ({
    webContents: {
      send: vi.fn(),
    },
  })), { getAllWindows: vi.fn(() => []) }),
  safeStorage: {
    isAsyncEncryptionAvailable: vi.fn(async () => false),
    encryptStringAsync: vi.fn(async (str: string) => Buffer.from(str)),
    decryptStringAsync: vi.fn(async (buf: Buffer) => ({ result: buf.toString(), shouldReEncrypt: false })),
  },
}))

// Global test utilities
declare global {
  var __TEST__: boolean
}
globalThis.__TEST__ = true
