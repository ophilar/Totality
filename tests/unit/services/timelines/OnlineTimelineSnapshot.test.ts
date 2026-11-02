import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import { setupTestDb, cleanupTestDb } from '@tests/TestUtils'
import { RemoteRegistryRecipeProvider } from '@main/services/timelines/RemoteRegistryRecipeProvider'
import { TimelineRecipeProviderFactory } from '@main/services/timelines/TimelineRecipeProviderFactory'
import type { TimelineDefinition } from '@main/services/timelines/ITimelineRecipeProvider'
import { TimelineParserPluginProvider } from '@main/services/timelines/TimelineParserPluginProvider'

describe('online viewing guide snapshots over HTTP', () => {
  let server: Server
  let factory: TimelineRecipeProviderFactory
  let guide: TimelineDefinition
  let unavailable: boolean
  let fetches: number
  beforeEach(async () => {
    await setupTestDb()
    unavailable = false
    fetches = 0
    guide = { id: 'publisher-order', name: 'Publisher order', franchise: 'Acceptance', description: '', version: 1, granularity: 'release-order', items: [{ order: 1, type: 'movie', title: 'First film', identifiers: { tmdbId: 1 } }] }
    server = createServer((request, response) => {
      response.setHeader('Content-Type', 'application/json')
      if (request.url === '/guide') {
        response.setHeader('Content-Type', 'text/html')
        response.end('<ul><li><a href="/series/andor">Andor</a> (2022)**</li><li><a href="/series/tales-of-the-jedi">Star Wars: Tales of the Jedi</a> (2022)<sup>*</sup></li></ul>')
      } else if (request.url === '/manifest.json') response.end(JSON.stringify([{ id: guide.id, name: guide.name, franchise: guide.franchise, description: '', totalItems: guide.items.length, granularity: guide.granularity }]))
      else {
        fetches++
        response.statusCode = unavailable ? 503 : 200
        response.end(unavailable ? 'Unavailable' : JSON.stringify(guide))
      }
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    factory = new TimelineRecipeProviderFactory([new RemoteRegistryRecipeProvider(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)])
  })
  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    cleanupTestDb()
  })
  it('excludes publisher footnotes and release annotations from series identities', async () => {
    const provider = new TimelineParserPluginProvider()
    await provider.savePlugin({ id: 'publisher-guide', name: 'Publisher guide', franchise: 'Star Wars', description: '', attribution: 'Publisher', sourceUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/guide`, groupings: [], orders: [{ id: 'chronological', name: 'Chronological', description: '', order: { kind: 'list', listSelector: 'ul', itemSelector: ':scope > li', format: 'title-list', minimumItems: 2, linkTypeRules: [{ contains: '/series/', type: 'show' }] } }] })
    const timeline = await provider.fetchTimeline('publisher-guide:chronological', { refresh: true })
    expect(timeline.items.map(item => ({ title: item.title, seriesTitle: item.seriesTitle }))).toEqual([{ title: 'Andor', seriesTitle: 'Andor' }, { title: 'Star Wars: Tales of the Jedi', seriesTitle: 'Star Wars: Tales of the Jedi' }])
  })
  it('fetches once per opening, incorporates publisher additions, and exposes the exact stale snapshot on failure', async () => {
    const first = await factory.fetchTimeline(guide.id, { refresh: true })
    expect(fetches).toBe(1)
    guide.items.push({ order: 2, type: 'movie', title: 'New film', identifiers: { tmdbId: 2 } })
    const updated = await factory.fetchTimeline(guide.id, { refresh: true })
    expect(fetches).toBe(2)
    expect(updated.items).toHaveLength(2)
    expect(updated.contentFingerprint).not.toBe(first.contentFingerprint)
    expect(updated.granularity).toBe('release-order')
    unavailable = true
    const stale = await factory.fetchTimeline(guide.id, { refresh: true })
    expect(fetches).toBe(3)
    expect(stale.contentFingerprint).toBe(updated.contentFingerprint)
    expect(stale.retrievedAt).toBe(updated.retrievedAt)
    expect(stale.refreshError).toContain('503')
  })
})
