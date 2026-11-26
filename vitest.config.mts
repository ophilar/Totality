import { defineConfig } from 'vitest/config'
import { buildAliases } from './buildAliases'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/dist-electron/**', 'tests/database-upgrade-real.test.ts'],
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/main/**/*.ts'],
      exclude: [
        'src/main/index.ts', // Entry point, mostly setup
        'src/main/ipc/**/*.ts', // IPC handlers, tested via integration
        '**/*.d.ts',
      ],
    },
    testTimeout: 10000,
  },
  resolve: {
    alias: buildAliases,
  },
})
