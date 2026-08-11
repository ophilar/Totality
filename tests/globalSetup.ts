import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export default function globalSetup() {
  return async function cleanupTestArtifacts() {
    const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

    await Promise.all(
      ['tests/tmp', 'test-output', 'coverage'].map((relativePath) =>
        rm(path.join(projectRoot, relativePath), { recursive: true, force: true }),
      ),
    )
  }
}
