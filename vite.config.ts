import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron, { type ElectronOptions } from 'vite-plugin-electron'
import path from 'node:path'

// https://vitejs.dev/config/
export const electronTargets: ElectronOptions[] = [
      {
        // Main process entry file
        onstart(args) {
          args.startup()
        },
        vite: {
          build: {
            outDir: path.resolve(import.meta.dirname, 'dist-electron/main'),
            minify: 'oxc',
            emptyOutDir: true,
            lib: {
              entry: path.resolve(import.meta.dirname, 'src/main/index.ts'),
              formats: ['cjs'],
              fileName: () => 'index.cjs'
            },
            rollupOptions: {
              external: [
                'electron', 'electron-updater', 'sql.js', 'mysql2', 'jsdom',
                'fsevents',
                'fs', 'path', 'os', 'crypto', 'http', 'https', 'net', 'util', 'url',
                'child_process', 'worker_threads', 'dgram', 'events', 'stream',
                'fs/promises', 'stream/promises', 'node:path', 'node:url', 'node:fs/promises',
                'node:sqlite'
              ],
              output: {
                format: 'cjs',
                entryFileNames: 'index.cjs',
                manualChunks: undefined,
                codeSplitting: false
              }
            }
          }
        }
      },
      {
        // FFprobe worker thread
        vite: {
          build: {
            outDir: path.resolve(import.meta.dirname, 'dist-electron/main'),
            minify: 'oxc',
            emptyOutDir: false, // Don't empty because index.cjs is already there
            lib: {
              entry: path.resolve(import.meta.dirname, 'src/main/workers/ffprobe-worker.ts'),
              formats: ['cjs'],
              fileName: () => 'ffprobe-worker.cjs'
            },
            rollupOptions: {
              external: ['worker_threads', 'child_process', 'fs', 'path'],
              output: {
                format: 'cjs',
                entryFileNames: 'ffprobe-worker.cjs',
                manualChunks: undefined,
                codeSplitting: false
              }
            }
          }
        }
      },
      {
        // Preload scripts
        onstart(args) {
          args.reload()
        },
        vite: {
          build: {
            outDir: path.resolve(import.meta.dirname, 'dist-electron/preload'),
            minify: 'oxc',
            emptyOutDir: true,
            lib: {
              entry: path.resolve(import.meta.dirname, 'src/preload/index.ts'),
              formats: ['cjs'],
              fileName: () => 'index.cjs'
            },
            rollupOptions: {
              external: ['electron'],
              output: {
                format: 'cjs',
                entryFileNames: 'index.cjs',
                manualChunks: undefined,
                codeSplitting: false
              }
            }
          }
        }
      }
]

export default defineConfig({
  plugins: [
    react(),
    electron(electronTargets),
    {
      name: 'configure-rolldown-output',
      configResolved(config) {
        // Rolldown (Vite 8) doesn't support 'freeze'
        const output = config.build.rollupOptions.output
        if (output) {
          if (Array.isArray(output)) {
            for (const o of output) {
              Reflect.deleteProperty(o, 'freeze')
            }
          } else {
            Reflect.deleteProperty(output, 'freeze')
          }
        }

      },
    }
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src/renderer/src'),
      '@main': path.resolve(import.meta.dirname, './src/main'),
      '@preload': path.resolve(import.meta.dirname, './src/preload'),
      '@shared': path.resolve(import.meta.dirname, './src/shared')
    }
  },
  root: './src/renderer',
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      // No explicit output options here, plugin handles cleanup
    }
  }
})
