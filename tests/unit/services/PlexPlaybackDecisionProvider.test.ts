import { describe, expect, it } from 'vitest'
import { PlexPlaybackDecisionProvider } from '@main/providers/plex/PlexPlaybackDecisionProvider'

const profile = { id: 'p', name: 'p', isBuiltin: false, createdAt: '', updatedAt: '', definition: { providers: { plex: { clientProduct: 'Plex', clientPlatform: 'webOS', clientVersion: '4' } } } } as never
describe('PlexPlaybackDecisionProvider', () => {
  it('maps a complete Plex response', async () => { const provider = new PlexPlaybackDecisionProvider({ request: async input => ({ overall: 'direct-play', video: 'direct-play', audio: 'direct-play', subtitle: 'direct-play', evidence: input.plexId }) }); await expect(provider.getDecision({ plexId: '42', profile })).resolves.toMatchObject({ overall: 'direct-play', evidence: '42' }) })
  it('rejects malformed responses', async () => { const provider = new PlexPlaybackDecisionProvider({ request: async () => ({ overall: 'unknown', video: 'direct-play', audio: 'direct-play', subtitle: 'direct-play' }) }); await expect(provider.getDecision({ plexId: '42', profile })).rejects.toThrow('invalid overall') })
})
