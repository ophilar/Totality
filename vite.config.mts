import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const productionMinify = {
  compress: {
    dropDebugger: true,
    treeshake: { manualPureFunctions: ['console.log', 'console.debug', 'console.info'] }
  },
  mangle: true
}

const commonAliases = {
  '@': path.resolve(__dirname, './src/renderer/src'),
  '@main': path.resolve(__dirname, './src/main'),
  '@preload': path.resolve(__dirname, './src/preload'),
  '@shared': path.resolve(__dirname, './src/shared'),
  '@tests': path.resolve(__dirname, './tests')
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        // Main process entry file
        entry: path.resolve(__dirname, 'src/main/index.ts'),
        onstart(args) {
          args.startup()
        },
        vite: {
          resolve: {
            alias: commonAliases
          },
          build: {
            outDir: path.resolve(__dirname, 'dist-electron/main'),
            minify: true,
            lib: {
              entry: path.resolve(__dirname, 'src/main/index.ts'),
              formats: ['cjs'],
              fileName: () => 'index.cjs'
            },
            rolldownOptions: {
              external: [
                'electron', 'electron-updater', 'sql.js', 'better-sqlite3', 'mysql2',
                'fsevents', 'chokidar', '@google/genai', 'jsdom', 'ws', 'selfsigned',
                'fs', 'node:path', 'os', 'crypto', 'http', 'https', 'net', 'util', 'url',
                'child_process', 'worker_threads', 'dgram', 'events', 'stream',
                'fs/promises', 'stream/promises', 'node:url', 'node:fs/promises',
              ],
              output: {
                minify: productionMinify,
                format: 'cjs',
                entryFileNames: 'index.cjs'
              }
            }
          }
        }
      },
      {
        // FFprobe worker thread
        entry: path.resolve(__dirname, 'src/main/workers/ffprobe-worker.ts'),
        vite: {
          resolve: {
            alias: commonAliases
          },
          build: {
            outDir: path.resolve(__dirname, 'dist-electron/main'),
            minify: true,
            lib: {
              entry: path.resolve(__dirname, 'src/main/workers/ffprobe-worker.ts'),
              formats: ['cjs'],
              fileName: () => 'ffprobe-worker.cjs'
            },
            rolldownOptions: {
              external: ['worker_threads', 'child_process', 'fs', 'node:path'],
              output: {
                minify: productionMinify,
                format: 'cjs',
                entryFileNames: 'ffprobe-worker.cjs'
              }
            }
          }
        }
      },
      {
        // Preload scripts
        entry: path.resolve(__dirname, 'src/preload/index.ts'),
        onstart(args) {
          args.reload()
        },
        vite: {
          resolve: {
            alias: commonAliases
          },
          build: {
            outDir: path.resolve(__dirname, 'dist-electron/preload'),
            minify: true,
            lib: {
              entry: path.resolve(__dirname, 'src/preload/index.ts'),
              formats: ['cjs'],
              fileName: () => 'index.cjs'
            },
            rolldownOptions: {
              external: ['electron'],
              output: {
                minify: productionMinify,
                format: 'cjs',
                entryFileNames: 'index.cjs'
              }
            }
          }
        }
      }
    ]),
    renderer()
  ],
  optimizeDeps: {
    include: ['react-window']
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/renderer/src'),
      '@main': path.resolve(__dirname, './src/main'),
      '@preload': path.resolve(__dirname, './src/preload'),
      '@shared': path.resolve(__dirname, './src/shared'),
      '@tests': path.resolve(__dirname, './tests')
    }
  },
  root: './src/renderer',
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    minify: true,
    sourcemap: false,
    rolldownOptions: {
      output: {
        minify: productionMinify,
        codeSplitting: {
          groups: [{
            name(id) {
              const sourceId = id.replaceAll('\\', '/')
              if (sourceId.includes('/node_modules/react-window/')) return 'ui'
              if (sourceId.includes('/node_modules/react/') || sourceId.includes('/node_modules/react-dom/')) return 'vendor'
              return null
            }
          }]
        }
      }
    }
  }
})
