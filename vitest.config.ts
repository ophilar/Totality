import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      // Force SQL.js in tests since better-sqlite3 native module doesn't work in vitest
      USE_SQLJS: 'true',
    },
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/dist-electron/**'],
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/main/**/*.ts', 'src/renderer/src/**/*.{ts,tsx}'],
      exclude: [
        'src/main/index.ts', // Entry point, mostly setup
        'src/main/ipc/**/*.ts', // IPC handlers, tested via integration
        'src/renderer/src/main.tsx',
        '**/*.d.ts',
      ],
    },
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      '@main': path.resolve(__dirname, 'src/main'),
      '@preload': path.resolve(__dirname, 'src/preload'),
    },
  },
})
