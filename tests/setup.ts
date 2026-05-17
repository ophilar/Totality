/**
 * Vitest Global Setup
 */

import { vi } from 'vitest'

// Mock Electron
vi.mock('electron', () => {
  const workerId = process.env.VITEST_WORKER_ID || process.pid
  const baseDir = `./tests/tmp/worker-${workerId}`
  
  const mockApp = {
    getPath: vi.fn((name: string) => name === 'userData' ? baseDir : `${baseDir}/${name}`),
    getName: vi.fn(() => 'totality-test'),
    getVersion: vi.fn(() => '0.1.0-test'),
    isReady: vi.fn(() => true),
    whenReady: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    disableHardwareAcceleration: vi.fn(),
    commandLine: { appendSwitch: vi.fn() },
    emit: vi.fn(),
  }

  const mockBrowserWindow = Object.assign(vi.fn().mockImplementation(function() {
    return {
      webContents: { send: vi.fn(), openDevTools: vi.fn() },
      on: vi.fn(),
      once: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
      removeMenu: vi.fn(),
      focus: vi.fn(),
      isVisible: vi.fn().mockReturnValue(true),
    }
  }), {
    getAllWindows: vi.fn().mockReturnValue([]),
    fromWebContents: vi.fn(),
  })

  return {
    app: mockApp,
    ipcMain: {
      handle: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      emit: vi.fn(),
      removeHandler: vi.fn(),
    },
    protocol: {
      registerSchemesAsPrivileged: vi.fn(),
      handle: vi.fn(),
    },
    net: { fetch: vi.fn() },
    Tray: vi.fn().mockImplementation(() => ({
      setToolTip: vi.fn(),
      setContextMenu: vi.fn(),
      on: vi.fn(),
    })),
    Menu: { buildFromTemplate: vi.fn() },
    nativeImage: {
      createFromPath: vi.fn(() => ({
        resize: vi.fn().mockReturnThis(),
      })),
    },
    session: {
      defaultSession: {
        webRequest: { onHeadersReceived: vi.fn() },
      },
    },
    contextBridge: { exposeInMainWorld: vi.fn() },
    BrowserWindow: mockBrowserWindow,
    dialog: {
      showErrorBox: vi.fn(),
      showMessageBox: vi.fn(),
      showOpenDialog: vi.fn(),
      showSaveDialog: vi.fn(),
    },
    shell: { openExternal: vi.fn(), openPath: vi.fn() },
    safeStorage: {
      isEncryptionAvailable: vi.fn(() => true),
      encryptString: vi.fn((str: string) => Buffer.from(str)),
      decryptString: vi.fn((buf: Buffer) => buf.toString()),
    },
  }
})

// Mock child_process
vi.mock('child_process', () => {
  const mockProc = {
    on: vi.fn().mockImplementation(function(evt, handler) {
      if (evt === 'close' || evt === 'exit') setImmediate(() => handler(0))
      return this
    }),
    stdout: { on: vi.fn().mockReturnThis(), pipe: vi.fn().mockReturnThis() },
    stderr: { on: vi.fn().mockReturnThis(), pipe: vi.fn().mockReturnThis() },
    stdin: { write: vi.fn(), end: vi.fn(), on: vi.fn().mockReturnThis() },
    kill: vi.fn(),
    unref: vi.fn(),
  }
  const result = {
    exec: vi.fn((cmd, options, callback) => {
      const cb = typeof options === 'function' ? options : callback
      if (cb) setImmediate(() => cb(null, { stdout: '' }, ''))
      return mockProc
    }),
    execFile: vi.fn((file, args, options, callback) => {
      const cb = typeof options === 'function' ? options : typeof args === 'function' ? args : callback
      if (cb) setImmediate(() => cb(null, { stdout: '' }, ''))
      return mockProc
    }),
    execSync: vi.fn().mockReturnValue(''),
    spawn: vi.fn().mockReturnValue(mockProc),
    fork: vi.fn(),
  }
  return { ...result, default: result }
})

// Mock react-virtuoso for JSDOM/Happy-dom
vi.mock('react-virtuoso', () => {
  const React = require('react')
  return {
    Virtuoso: ({ totalCount, data, itemContent, components }: any) => {
      const items = []
      const count = data ? data.length : totalCount
      for (let i = 0; i < count; i++) {
        items.push(React.createElement('div', { key: i }, itemContent(i, data ? data[i] : undefined)))
      }
      return React.createElement('div', { 'data-testid': 'mock-virtuoso' }, [
        components?.Header && React.createElement(components.Header),
        ...items,
        components?.Footer && React.createElement(components.Footer)
      ])
    },
    VirtuosoGrid: ({ totalCount, data, itemContent, components }: any) => {
      const items = []
      const count = data ? data.length : totalCount
      for (let i = 0; i < count; i++) {
        items.push(React.createElement('div', { key: i }, itemContent(i, data ? data[i] : undefined)))
      }
      const List = components?.List || 'div'
      return React.createElement('div', { 'data-testid': 'mock-virtuoso-grid' }, [
        components?.Header && React.createElement(components.Header),
        React.createElement(List, { style: { display: 'grid' } }, items),
        components?.Footer && React.createElement(components.Footer)
      ])
    }
  }
})

globalThis.__TEST__ = true
