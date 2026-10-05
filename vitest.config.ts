import { defineConfig } from 'vitest/config'
import path from 'path'

const mediaIntegrationSuite = process.env.TOTALITY_TEST_SUITE === 'media-integration'
const acceptanceSuite = process.env.TOTALITY_TEST_SUITE === 'acceptance'

export default defineConfig({
  server: {
    watch: {
      usePolling: true,
      interval: 100,
      ignored: [
        '**/node_modules/**',
        '**/dist/**',
        '**/dist-electron/**',
        '**/tests/tmp/**',
        '**/coverage/**',
        '**/logs/**',
        '**/*.db*',
        '**/*.log*',
        '**/*.tmp',
        '**/*.txt',
        '**/*.ps1',
        '**/.git/**',
        '**/.vitest-attachments/**',
      ],
    },
  },
  test: {
    globals: true,
    environment: 'node',
    env: {
      // Force SQL.js in tests since better-sqlite3 native module doesn't work in vitest
      USE_SQLJS: 'true',
    },
    setupFiles: ['./tests/setup.ts'],
    globalSetup: ['./tests/globalSetup.ts'],
    // Windows worker forks intermittently crash while loading renderer suites.
    fileParallelism: process.platform !== 'win32',
    include: mediaIntegrationSuite
      ? ['tests/integration/**/*.test.{ts,tsx}']
      : acceptanceSuite
        ? ['tests/acceptance/**/*.test.{ts,tsx}']
        : ['tests/**/*.test.{ts,tsx}'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-electron/**',
      ...(mediaIntegrationSuite ? [] : ['tests/integration/**']),
      ...(acceptanceSuite ? [] : ['tests/acceptance/**']),
    ],
    deps: {
      optimizer: {
        client: {
          include: ['vitest-canvas-mock']
        }
      }
    },
    server: {
      deps: {
        external: ['node:sqlite', 'electron', 'node:path', 'node:fs', 'node:os']
      }
    },
    ssr: {
      external: ['node:sqlite', 'electron']
    },
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
    testTimeout: 30000,
    pool: 'forks',
    maxWorkers: 4,
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src/renderer/src'),
      '@main': path.resolve(import.meta.dirname, 'src/main'),
      '@preload': path.resolve(import.meta.dirname, 'src/preload'),
      '@shared': path.resolve(import.meta.dirname, 'src/shared'),
      '@tests': path.resolve(import.meta.dirname, 'tests'),
      'node:sqlite': path.resolve(import.meta.dirname, 'tests/mocks/node-sqlite.ts'),
    },
  },
})
