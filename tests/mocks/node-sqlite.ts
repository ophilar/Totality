
class MockDatabaseSync {
  constructor() {}
  exec() {}
  prepare() { 
    return { 
      all: () => [], 
      get: () => null, 
      run: () => ({ lastInsertRowid: 0, changes: 0 }),
      values: () => []
    } 
  }
  close() {}
}

let DatabaseSyncExport: any = MockDatabaseSync

// Use process.env.VITEST to detect node environment but avoid Vite bundling
if (typeof window === 'undefined') {
  try {
    // Try require as a fallback if import fails in CJS-like Vitest environment
    const { createRequire } = await import('module')
    const require = createRequire(import.meta.url)
    const sqlite = require('node:sqlite')
    DatabaseSyncExport = sqlite.DatabaseSync
  } catch (e) {
    // If require fails, try dynamic import
    try {
      const sqlite = await import('node:sqlite')
      DatabaseSyncExport = sqlite.DatabaseSync
    } catch (e2) {
      // Mock it
    }
  }
}

export const DatabaseSync = DatabaseSyncExport


