# Build and test performance

## User stories

- A developer can build the renderer and Electron processes without waiting for avoidable serial build work.
- The test suite retains isolation where shared module state makes it necessary.

## Requirements

- Build the main process, FFprobe worker, and preload from the existing entry points and preserve their packaged paths.
- Use the Vite 8 supported Oxc minifier for Electron bundles instead of deprecated esbuild minification.
- Emit one CommonJS bundle per Electron entry; do not let ESM package defaults add a second format to the same `.cjs` path.
- Preserve the current isolated test configuration unless an alternative passes the full suite and shuffled-order checks.

## Success criteria

- `npm test` passes with the existing isolation guarantees.
- `npm run build` produces the installer and all three expected Electron outputs.
- Resolved Electron configurations select one library format and explicitly emit CommonJS.
- Build hook timing shows lower Electron build time without duplicate bundles.
