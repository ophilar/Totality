import path from 'node:path'

// Shared by the renderer, Electron bundles and Vitest.
export const buildAliases = {
  '@': path.resolve(import.meta.dirname, 'src/renderer/src'),
  '@main': path.resolve(import.meta.dirname, 'src/main'),
  '@preload': path.resolve(import.meta.dirname, 'src/preload'),
  '@shared': path.resolve(import.meta.dirname, 'src/shared'),
  '@tests': path.resolve(import.meta.dirname, 'tests')
}
