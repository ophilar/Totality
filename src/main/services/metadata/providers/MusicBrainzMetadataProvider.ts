import { getMusicBrainzService } from '../../MusicBrainzService'
import { IMetadataProvider, MetadataSearchQuery, MetadataSearchResult, MediaMetadataDetails, MetadataType } from '../IMetadataProvider'

export class MusicBrainzMetadataProvider implements IMetadataProvider {
  readonly providerId = 'musicbrainz'
  readonly providerName = 'MusicBrainz'
  readonly supportedTypes: MetadataType[] = ['music']

  async search(query: MetadataSearchQuery): Promise<MetadataSearchResult[]> {
    const mb = getMusicBrainzService()
    if (query.type !== 'music') return []
    if (query.externalIds?.musicbrainz_id) {
      const details = await this.getDetails(query.externalIds.musicbrainz_id, 'music')
      return details ? [details] : []
    }
    const artistResults = await mb.searchArtist(query.title)
    return artistResults.map((artist: any) => ({
      id: String(artist.id), provider: this.providerId, title: artist.name || query.title,
      type: 'music' as MetadataType, score: artist.score, overview: artist.disambiguation,
      externalIds: { musicBrainzId: String(artist.id) }, alternateTitles: artist.aliases?.map((a: any) => a.name).filter(Boolean) || []
    }))
  }

  async getDetails(externalId: string, _type: MetadataType): Promise<MediaMetadataDetails | null> {
    const artist = await getMusicBrainzService().getArtistDetails(externalId)
    if (!artist) return null
    return { id: externalId, provider: this.providerId, title: artist.name, type: 'music', externalIds: { musicBrainzId: externalId }, raw: artist as any }
  }
}
