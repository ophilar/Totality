import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@main': path.resolve(root, 'src/main'),
      '@shared': path.resolve(root, 'src/shared'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/database-upgrade-real.test.ts'],
    testTimeout: 30_000,
  },
})
