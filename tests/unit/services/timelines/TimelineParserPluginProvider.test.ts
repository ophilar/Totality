import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
vi.mock('@main/database/getDatabase', () => ({ getDatabase: () => ({ getSetting: () => null }) }))
import { TimelineParserPluginProvider } from '@main/services/timelines/TimelineParserPluginProvider'

describe('TimelineParserPluginProvider', () => {
  afterEach(() => vi.restoreAllMocks())

  it('reports candidate table headers when none matches the configured source schema', async () => {
    const html = '<table><tr><th>Unrelated heading</th></tr><tr><td>Unrelated row</td></tr></table>'
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ parse: { text: { '*': html } } })))
    const cache = { getRecipe: vi.fn().mockResolvedValue(null), setRecipe: vi.fn(), invalidate: vi.fn() }
    const provider = new TimelineParserPluginProvider(cache as never)

    await expect(provider.fetchTimeline('babylon-project:original-broadcast'))
      .rejects.toThrow(/failed while parsing timeline items: Error: Parser 'babylon-project' found no table matching .*best table=0, headers=\["Unrelated heading"\], requiredMatches=0\/7, rows=2/)
  })

  it('parses Babylon orders when the episode table is nested in a one-row wrapper', async () => {
    const episodeTable = readFileSync('tests/fixtures/timelines/babylon-viewing-order-table.html', 'utf8')
    const wrappedHtml = `<table class="wrapper"><tr><td>${episodeTable}</td></tr></table>`
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ parse: { text: { '*': wrappedHtml } } })))
    const cache = { getRecipe: vi.fn().mockResolvedValue(null), setRecipe: vi.fn(), invalidate: vi.fn() }
    const provider = new TimelineParserPluginProvider(cache as never)

    for (const order of ['original-broadcast', 'lurkers-guide', 'historical-database']) {
      const timeline = await provider.fetchTimeline(`babylon-project:${order}`)
      expect(timeline.items).toHaveLength(131)
      expect(timeline.items[0].order).toBe(1)
    }

    // This captured episode-table fragment has no group-placement table, so the
    // two configured Focused Story orders cannot be parsed from this fixture.
    for (const order of ['focused-story-first', 'focused-story-last']) {
      await expect(provider.fetchTimeline(`babylon-project:${order}`))
        .rejects.toThrow(/found no group table matching its configured headers \(\d+ candidates; best table=\d+, headers=/)
    }
  })
})
