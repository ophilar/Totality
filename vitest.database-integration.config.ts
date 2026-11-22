import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/database-upgrade-real.test.ts'],
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      '@main': path.resolve(__dirname, 'src/main'),
      '@preload': path.resolve(__dirname, 'src/preload'),
    },
  },
})
