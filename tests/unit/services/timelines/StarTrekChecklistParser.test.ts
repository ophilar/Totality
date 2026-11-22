import { readFileSync } from 'node:fs'
import { parseDocument } from 'htmlparser2'
import { describe, expect, it } from 'vitest'
import { TimelineParserPluginProvider } from '@main/services/timelines/TimelineParserPluginProvider'
import { TimelineCacheService } from '@main/services/timelines/TimelineCacheService'
import starTrekParser from '@main/services/timelines/parser-plugins/star-trek.json'
import { TimelineParserPluginSchema } from '@main/services/timelines/TimelineParserPlugin'

describe('Star Trek checklist parser', () => {
  const provider = new TimelineParserPluginProvider(new TimelineCacheService())
  const plugin = TimelineParserPluginSchema.parse(starTrekParser)
  const order = plugin.orders[0].order
  if (typeof order === 'string' || !('kind' in order)) throw new Error('Star Trek parser must define a list order')

  it('parses the captured current checklist markup and expands episode ranges', () => {
    const html = readFileSync('tests/fixtures/timelines/star-trek-viewing-guide-checklist.html', 'utf8')
    const items = provider['parseListItems'](parseDocument(html), plugin, order)

    expect(items.length).toBeGreaterThanOrEqual(order.minimumItems)
    expect(items.slice(0, 2)).toEqual([
      expect.objectContaining({ type: 'episode', seriesTitle: 'Star Trek: Enterprise', seasonNumber: 1, episodeNumber: 1, title: 'Broken Bow' }),
      expect.objectContaining({ type: 'episode', seriesTitle: 'Star Trek: Enterprise', seasonNumber: 1, episodeNumber: 2, title: 'Broken Bow' }),
    ])
    expect(items.some(item => item.type === 'movie' && item.title === 'Star Trek: The Motion Picture')).toBe(true)
    expect(items.some(item => item.seriesTitle === 'Star Trek: Starfleet Academy')).toBe(true)
  })

  it('rejects a truncated captured checklist below the configured minimum', () => {
    const html = readFileSync('tests/fixtures/timelines/star-trek-viewing-guide-checklist.html', 'utf8')
    const firstSection = html.match(/<ul class="ck-list">.*?<\/ul>/s)?.[0]
    expect(firstSection).toBeDefined()

    expect(() => provider['parseListItems'](parseDocument(firstSection!), plugin, order))
      .toThrow(new RegExp(`its source must provide at least ${order.minimumItems}`))
  })
})
