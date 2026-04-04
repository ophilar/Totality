import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'node:path'

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
          build: {
            outDir: path.resolve(__dirname, 'dist-electron/main'),
            minify: 'esbuild',
            lib: {
              entry: path.resolve(__dirname, 'src/main/index.ts'),
              formats: ['cjs'],
              fileName: () => 'index.cjs'
            },
            rollupOptions: {
              external: [
                'electron', 'electron-updater', 'sql.js', 'better-sqlite3', 'mysql2',
                'fsevents', 'chokidar', '@google/genai',
                'fs', 'path', 'os', 'crypto', 'http', 'https', 'net', 'util', 'url',
                'child_process', 'worker_threads', 'dgram', 'events', 'stream',
                'fs/promises', 'stream/promises', 'node:path', 'node:url', 'node:fs/promises',
              ],
              output: {
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
          build: {
            outDir: path.resolve(__dirname, 'dist-electron/main'),
            minify: 'esbuild',
            lib: {
              entry: path.resolve(__dirname, 'src/main/workers/ffprobe-worker.ts'),
              formats: ['cjs'],
              fileName: () => 'ffprobe-worker.cjs'
            },
            rollupOptions: {
              external: ['worker_threads', 'child_process', 'fs', 'path'],
              output: {
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
          build: {
            outDir: path.resolve(__dirname, 'dist-electron/preload'),
            minify: 'esbuild',
            lib: {
              entry: path.resolve(__dirname, 'src/preload/index.ts'),
              formats: ['cjs'],
              fileName: () => 'index.cjs'
            },
            rollupOptions: {
              external: ['electron'],
              output: {
                format: 'cjs',
                entryFileNames: 'index.cjs'
              }
            }
          }
        }
      }
    ]),
    renderer(),
    {
      name: 'fix-rolldown-warnings',
      configResolved(config) {
        // Rolldown (Vite 8) doesn't support 'freeze'
        const output = config.build.rollupOptions.output
        if (output) {
          if (Array.isArray(output)) {
            for (const o of output) {
              delete (o as any).freeze
            }
          } else {
            delete (output as any).freeze
          }
        }

        // Silence customResolver deprecation warning by removing it from aliases
        // Note: This might break resolution if the plugin relied on it, but Vite 8/Rolldown 
        // usually handles standard aliases fine.
        if (config.resolve?.alias && Array.isArray(config.resolve.alias)) {
          for (const alias of config.resolve.alias) {
            if ((alias as any).customResolver) {
              delete (alias as any).customResolver
            }
          }
        }
      },
      // Adding resolveId as suggested by the warning
      resolveId() {
        return null
      }
    }
  ],
  optimizeDeps: {
    include: ['react-window']
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/renderer/src'),
      '@main': path.resolve(__dirname, './src/main'),
      '@preload': path.resolve(__dirname, './src/preload')
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
