import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Plex TV scan ownership', () => {
  it('does not write series completeness from provider inventory', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/main/providers/plex/PlexProvider.ts'), 'utf8')

    expect(source).not.toContain('tvShows.upsertCompleteness')
  })
})
