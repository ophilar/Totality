import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
vi.mock('@main/database/getDatabase', () => ({ getDatabase: () => ({ getSetting: () => null }) }))
import { TimelineParserPluginProvider } from '@main/services/timelines/TimelineParserPluginProvider'

describe('TimelineParserPluginProvider', () => {
  afterEach(() => vi.restoreAllMocks())

  it('parses the captured Babylon table in broadcast order', async () => {
    const html = readFileSync('tests/fixtures/timelines/babylon-viewing-order-table.html', 'utf8')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ parse: { text: { '*': html } } })))
    const cache = { getRecipe: vi.fn().mockResolvedValue(null), setRecipe: vi.fn(), invalidate: vi.fn() }
    const provider = new TimelineParserPluginProvider(cache as never)

    const timeline = await provider.fetchTimeline('babylon-project:original-broadcast')

    expect(timeline.items).toHaveLength(131)
    expect(timeline.items.slice(0, 3).map(item => item.title)).toEqual(['The Gathering (Pilot)', 'Midnight on the Firing Line', 'Soul Hunter'])
    expect(timeline.items[1]).toMatchObject({ order: 2, type: 'episode', seasonNumber: 1, episodeNumber: 1 })
  })
})
