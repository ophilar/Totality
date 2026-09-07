import { getErrorMessage, isNodeError } from '@main/services/utils/errorUtils'
import { retryWithBackoff } from '@main/services/utils/retryWithBackoff'
/**
 * MusicBrainzService
 *
 * Service for fetching artist discography and completeness data from the public MusicBrainz API.
 *
 * MusicBrainz API Guidelines (https://wiki.musicbrainz.org/MusicBrainz_API):
 * - Rate limit: Maximum 1 request per second (we use 1.5s to be safe)
 * - User-Agent: Must include application name, version, and contact URL/email
 * - Format: JSON via Accept header or fmt=json parameter
 *
 * Cover Art Archive (https://coverartarchive.org):
 * - Provides album artwork linked to MusicBrainz IDs
 * - No rate limiting but be respectful
 */

import axios, { AxiosInstance } from 'axios'
import { app } from 'electron'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { getLoggingService } from '@main/services/LoggingService'
import { RateLimiters, SimpleDelayRateLimiter } from '@main/services/utils/RateLimiter'
import {
  CancellableOperation,
  wasRecentlyAnalyzed,
  type AnalysisOptions,
} from '@main/services/utils/ProgressTracker'
import {
  ArtistCompleteness,
  AlbumCompleteness,
  MissingAlbum,
  MissingTrack,
  MusicAlbum,
  MusicTrack,
  AlbumType,
  type AnalysisOutcome,
  type AnalysisDiagnostic,
  type AnalysisStatus,
} from '@main/types/database'

interface MBReleaseGroup {
  id: string
  title: string
  'first-release-date'?: string
  'primary-type'?: string
  'secondary-types'?: string[]
}

interface MBRelease {
  id: string
  title: string
  status?: string
  media?: Array<{
    format?: string
  }>
}

const DIGITAL_FORMATS = [
  'CD', 'Digital Media', 'Enhanced CD', 'CD-R', 'HDCD', 'DualDisc',
  'SACD', 'Hybrid SACD', 'SHM-CD', 'Blu-spec CD', 'Blu-spec CD2',
  'USB Flash Drive', 'slotMusic', 'UMD', 'Cassette', '8cm CD'
]

const VINYL_FORMATS = [
  'Vinyl', '7" Vinyl', '10" Vinyl', '12" Vinyl', 'Flexi-disc',
  'Shellac', 'Acetate', 'Lathe Cut'
]

export interface MBArtist {
  id: string
  name: string
  'sort-name': string
  country?: string
  type?: string
  'life-span'?: {
    begin?: string
    end?: string
    ended?: boolean
  }
  'release-groups'?: MBReleaseGroup[]
  score?: number
  disambiguation?: string
  aliases?: Array<{ name: string }>
}

interface MBArtistSearchResult {
  artists: MBArtist[]
}

export type MusicAnalysisPhase = 'artists' | 'albums' | 'complete'

export interface MusicAnalysisProgress {
  current: number
  total: number
  currentItem: string
  phase: MusicAnalysisPhase
  percentage: number
  artistsTotal: number
  albumsTotal: number
  phaseIndex: number
  skipped?: number
}

export interface MusicAnalysisOptions extends AnalysisOptions {
  filterVinylOnly?: boolean
}

export function isPlaceholderMusicTitle(text?: string | null): boolean {
  if (!text) return true
  const trimmed = text.trim()
  if (!trimmed || trimmed.length === 0) return true
  if (!/[a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF\u0400-\u04FF\u0590-\u05FF\u3040-\u30FF\u4E00-\u9FFF]/.test(trimmed)) return true

  const normalized = trimmed
    .toLowerCase()
    .replace(/[[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const placeholders = new Set([
    'unknown album',
    'unknown artist',
    'unknown',
    'various artists',
    'various',
    'va',
    'title',
    'track',
    'untitled',
    'album',
    'disc',
    'disk',
    'cd',
    'unknown title',
    'unknown performer',
    'language instruction',
    'sound effects',
    'sound effects and music',
    'audio',
    'misc',
    'other',
    'bootleg',
    'rarities',
    'unreleased album'
  ])

  if (placeholders.has(normalized)) return true
  if (/^track\s*\d+$/i.test(normalized)) return true
  if (/^cd\s*\d+$/i.test(normalized)) return true
  if (/^disc\s*\d+$/i.test(normalized)) return true
  if (/^disk\s*\d+$/i.test(normalized)) return true
  if (/^side\s*[a-z0-9]+$/i.test(normalized)) return true
  if (/^unknown\s*album\s*\d.*$/i.test(normalized)) return true
  if (normalized.includes('àìáåí ìà éãåò') || normalized.includes('אלבום לא ידוע')) return true
  if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{4}$/i.test(normalized)) return true
  return false
}

export class MusicBrainzService extends CancellableOperation {
  private api: AxiosInstance
  private rateLimiter: SimpleDelayRateLimiter = RateLimiters.createMusicBrainzLimiter()
  private readonly MAX_RETRIES = 3
  private readonly RETRY_DELAY_MS = 5000

  private baseURL: string = 'https://musicbrainz.org/ws/2'
  private missingCoverArtCache = new Map<string, number>()
  private static readonly NEGATIVE_CACHE_TTL_MS = 24 * 60 * 60 * 1000

  private async getBaseUrl(): Promise<string> {
    const db = getDatabase()
    return (await db.config.getSetting('musicbrainz_base_url')) || 'https://musicbrainz.org/ws/2'
  }

  private get userAgent(): string {
    return `Totality/${app.getVersion()} (https://github.com/totality-app/totality)`
  }

  private static readonly COVER_ART_BASE_URL = 'https://coverartarchive.org'

  constructor() {
    super()
    this.api = axios.create({
      headers: {
        'User-Agent': this.userAgent,
        'Accept': 'application/json',
      },
      timeout: 60000,
    })
  }

  async initialize(): Promise<void> {
    this.baseURL = await this.getBaseUrl()
    this.api.defaults.baseURL = this.baseURL
  }

  buildCoverArtUrl(releaseGroupId: string, size: 'front' | '250' | '500' | '1200' = 'front'): string {
    if (size === 'front') {
      return `${MusicBrainzService.COVER_ART_BASE_URL}/release-group/${releaseGroupId}/front`
    }
    return `${MusicBrainzService.COVER_ART_BASE_URL}/release-group/${releaseGroupId}/front-${size}`
  }

  async getCoverArtUrl(releaseGroupId: string): Promise<string | null> {
    const now = Date.now()
    const cachedTime = this.missingCoverArtCache.get(releaseGroupId)
    if (cachedTime && now - cachedTime < MusicBrainzService.NEGATIVE_CACHE_TTL_MS) {
      return null
    }

    try {
      const response = await axios.head(
        `${MusicBrainzService.COVER_ART_BASE_URL}/release-group/${releaseGroupId}/front`,
        {
          timeout: 5000,
          maxRedirects: 5,
          validateStatus: (status) => status < 400 || status === 404,
        }
      )

      if (response.status === 200 || response.status === 307 || response.status === 302) {
        return this.buildCoverArtUrl(releaseGroupId, '500')
      }

      this.missingCoverArtCache.set(releaseGroupId, now)
      return null
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        this.missingCoverArtCache.set(releaseGroupId, now)
      }
      return null
    }
  }

  private async rateLimit(): Promise<void> {
    await this.rateLimiter.waitForSlot()
  }

  private isRetryableConnectionError(error: unknown): boolean {
    const errorCode = isNodeError(error) ? error.code : undefined
    const errorMessage = getErrorMessage(error) || ''

    return (
      errorCode === 'ECONNRESET' ||
      errorCode === 'ETIMEDOUT' ||
      errorCode === 'ECONNREFUSED' ||
      errorCode === 'ENOTFOUND' ||
      errorMessage.includes('socket') ||
      errorMessage.includes('network') ||
      errorMessage.includes('503') ||
      errorMessage.includes('429')
    )
  }

  private isDatabaseError(error: unknown): boolean {
    const message = getErrorMessage(error).toLowerCase()
    return message.includes('sqlite') || message.includes('constraint') || message.includes('database')
  }

  private async requestWithRetry<T>(
    requestFn: () => Promise<T>,
    context: string
  ): Promise<T> {
    try {
      const result = await retryWithBackoff(
        async () => {
          await this.rateLimit()
          try {
            const data = await requestFn()
            this.rateLimiter.recordSuccess()
            return data
          } catch (error: unknown) {
            if (axios.isAxiosError(error)) {
              const status = error.response?.status
              if (status === 429 || status === 503) {
                this.rateLimiter.recordError(status)
                const retryAfter = error.response?.headers?.['retry-after']
                if (retryAfter) {
                  const seconds = parseInt(retryAfter, 10)
                  if (!isNaN(seconds)) {
                    this.rateLimiter.setDelay(seconds * 1000)
                  }
                }
              }
            }

            if (this.isRetryableConnectionError(error)) {
              throw error
            }
            const wrappedError = new Error(getErrorMessage(error)) as Error & { nonRetryable: boolean }
            wrappedError.nonRetryable = true
            throw wrappedError
          }
        },
        {
          maxRetries: this.MAX_RETRIES,
          initialDelay: this.RETRY_DELAY_MS,
          maxDelay: 30000,
          backoffFactor: 2,
          retryableStatuses: [429, 500, 502, 503, 504],
          onRetry: (attempt, error, delay) => {
            getLoggingService().warn('[MusicBrainzService]', `${context} - Retry ${attempt}/${this.MAX_RETRIES} after ${delay}ms: ${error.message}`)
          }
        }
      )
      return result
    } catch (finalError) {
      if (axios.isAxiosError(finalError) && finalError.response?.status) {
        this.rateLimiter.recordError(finalError.response.status)
      }
      throw finalError
    }
  }

  async searchArtist(name: string): Promise<MBArtist[]> {
    if (isPlaceholderMusicTitle(name)) {
      return []
    }

    const cleanName = name.replace(/[&]/g, 'AND').replace(/[+]/g, ' ').trim()

    return this.requestWithRetry(async () => {
      const response = await this.api.get<MBArtistSearchResult>('/artist', {
        params: {
          query: `artist:"${name}" OR artist:"${cleanName}"`,
          fmt: 'json',
          limit: 10,
        },
      })
      return response.data.artists || []
    }, `searchArtist(${name})`)
  }

  private async hasDigitalRelease(releaseGroupId: string): Promise<boolean> {
    try {
      const releases = await this.requestWithRetry(async () => {
        const response = await this.api.get<{ releases: MBRelease[] }>(`/release`, {
          params: {
            'release-group': releaseGroupId,
            fmt: 'json',
            limit: 50,
          },
        })
        return response.data.releases || []
      }, `checkDigitalRelease(${releaseGroupId})`)

      for (const release of releases) {
        if (!release.media || release.media.length === 0) {
          return true
        }

        for (const medium of release.media) {
          const format = medium.format || ''

          if (DIGITAL_FORMATS.some(f => format.toLowerCase().includes(f.toLowerCase()))) {
            return true
          }

          if (!VINYL_FORMATS.some(f => format.toLowerCase().includes(f.toLowerCase()))) {
            if (format && !format.toLowerCase().includes('vinyl')) {
              return true
            }
          }
        }
      }

      getLoggingService().info('[MusicBrainzService]', `Excluding vinyl-only release group: ${releaseGroupId}`)
      return false
    } catch (error) {
      getLoggingService().warn('[MusicBrainzService]', `Failed to check format for ${releaseGroupId}, including by default`)
      return true
    }
  }

  async getArtistDetails(musicbrainzId: string): Promise<MBArtist | null> {
    return this.requestWithRetry(async () => {
      try {
        const response = await this.api.get<MBArtist>(`/artist/${musicbrainzId}`, {
          params: {
            fmt: 'json',
          },
        })
        return response.data
      } catch (error: unknown) {
        if (axios.isAxiosError(error) && error.response?.status === 404) return null
        throw error
      }
    }, `getArtistDetails(${musicbrainzId})`)
  }

  async getArtistDiscography(musicbrainzId: string, filterVinylOnly: boolean = false): Promise<{
    artist: MBArtist
    albums: MBReleaseGroup[]
    eps: MBReleaseGroup[]
    singles: MBReleaseGroup[]
  }> {
    const artist = await this.requestWithRetry(async () => {
      try {
        const response = await this.api.get<MBArtist>(`/artist/${musicbrainzId}`, {
          params: {
            fmt: 'json',
            inc: 'release-groups',
          },
        })
        return response.data
      } catch (error: unknown) {
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          getLoggingService().warn('[MusicBrainzService]', `Artist not found (404): ${musicbrainzId}`)
          return null
        }
        throw error
      }
    }, `getArtist(${musicbrainzId})`)

    if (!artist) {
      return {
        artist: { id: musicbrainzId, name: 'Unknown', 'sort-name': 'Unknown' },
        albums: [],
        eps: [],
        singles: []
      }
    }

    let releaseGroups = artist['release-groups'] || []

    if (releaseGroups.length === 0) {
      releaseGroups = await this.requestWithRetry(async () => {
        const response = await this.api.get<{ 'release-groups': MBReleaseGroup[] }>(
          `/release-group`,
          {
            params: {
              artist: musicbrainzId,
              fmt: 'json',
              limit: 100,
            },
          }
        )
        return response.data['release-groups'] || []
      }, `getReleaseGroups(${musicbrainzId})`)
    }

    const allAlbums = releaseGroups.filter(rg =>
      rg['primary-type'] === 'Album' &&
      !rg['secondary-types']?.includes('Compilation') &&
      !rg['secondary-types']?.includes('Live') &&
      !rg['secondary-types']?.includes('Soundtrack')
    )

    const allEps = releaseGroups.filter(rg => rg['primary-type'] === 'EP')
    const allSingles = releaseGroups.filter(rg => rg['primary-type'] === 'Single')

    if (filterVinylOnly) {
      getLoggingService().info('[MusicBrainzService]', `Filtering ${allAlbums.length} albums for digital availability (sequential to respect rate limit)...`)

      const filterReleases = async (releases: MBReleaseGroup[]) => {
        const results: MBReleaseGroup[] = []
        for (const release of releases) {
          if (this.isCancelled()) break
          const hasDigital = await this.hasDigitalRelease(release.id)
          if (hasDigital) results.push(release)
        }
        return results
      }

      const albums = await filterReleases(allAlbums)
      const eps = await filterReleases(allEps)
      const singles = await filterReleases(allSingles)

      getLoggingService().info('[MusicBrainzService]', `${albums.length}/${allAlbums.length} albums have digital releases`)

      return { artist, albums, eps, singles }
    }

    getLoggingService().verbose('[MusicBrainzService]',
      `Discography for "${artist.name}": ${allAlbums.length} albums, ${allEps.length} EPs, ${allSingles.length} singles`)
    getLoggingService().info('[MusicBrainzService]', `Found ${allAlbums.length} albums, ${allEps.length} EPs, ${allSingles.length} singles`)
    return { artist, albums: allAlbums, eps: allEps, singles: allSingles }
  }

  async getReleaseTracklist(releaseGroupId: string, expectedTrackCount?: number): Promise<{
    releaseId: string
    tracks: Array<{
      musicbrainz_id: string
      title: string
      track_number: number
      disc_number: number
      duration_ms?: number
    }>
  } | null> {
    try {
      let releases = await this.requestWithRetry(async () => {
        try {
          const response = await this.api.get(`/release`, {
            params: {
              'release-group': releaseGroupId,
              fmt: 'json',
              limit: 5,
              status: 'official',
              inc: 'media+recordings',
            },
          })
          interface MBReleasesResponse { releases?: MBRelease[] }
          return (response.data as MBReleasesResponse)?.releases || []
        } catch (error: unknown) {
          if (axios.isAxiosError(error) && error.response?.status === 404) {
            getLoggingService().warn('[MusicBrainzService]', `Release group not found (404): ${releaseGroupId}`)
            return []
          }
          throw error
        }
      }, `getReleases(${releaseGroupId})`)

      if (releases.length === 0) {
        getLoggingService().info('[MusicBrainzService]', `No official releases found, trying all releases...`)
        releases = await this.requestWithRetry(async () => {
          const response = await this.api.get(`/release`, {
            params: {
              'release-group': releaseGroupId,
              fmt: 'json',
              limit: 5,
              inc: 'media+recordings',
            },
          })
          interface MBReleasesResponse { releases?: MBRelease[] }
          return (response.data as MBReleasesResponse)?.releases || []
        }, `getReleasesAll(${releaseGroupId})`)
      }

      if (releases.length === 0) {
        getLoggingService().info('[MusicBrainzService]', `No releases found for release group ${releaseGroupId}`)
        return null
      }

      interface MBReleaseWithMedia {
        id: string
        title: string
        media?: Array<{
          position?: number
          tracks?: Array<{
            id: string
            title: string
            position?: number
            number?: number
            length?: number
          }>
        }>
      }
      const releasesWithMedia = (releases as MBReleaseWithMedia[]).filter(r => r.media && r.media.length > 0)
      let release: MBReleaseWithMedia

      if (expectedTrackCount && releasesWithMedia.length > 1) {
        const ranked = releasesWithMedia.map(r => ({
          release: r,
          trackCount: r.media!.reduce((sum, m) => sum + (m.tracks?.length || 0), 0),
        })).sort((a, b) =>
          Math.abs(a.trackCount - expectedTrackCount) - Math.abs(b.trackCount - expectedTrackCount)
        )
        release = ranked[0].release
        getLoggingService().info('[MusicBrainzService]', `Selected release: ${release.title} (${release.id}) with ${ranked[0].trackCount} tracks (expected ~${expectedTrackCount})`)
      } else {
        release = releasesWithMedia[0] || releases[0] as MBReleaseWithMedia
        getLoggingService().info('[MusicBrainzService]', `Using release: ${release.title} (${release.id})`)
      }
      const releaseId = release.id

      const tracks: Array<{
        musicbrainz_id: string
        title: string
        track_number: number
        disc_number: number
        duration_ms?: number
      }> = []

      const media = release.media || []
      getLoggingService().info('[MusicBrainzService]', `Release has ${media.length} media/discs`)

      for (const disc of media) {
        const discNumber = disc.position || 1
        const discTracks = disc.tracks || []
        getLoggingService().info('[MusicBrainzService]', `Disc ${discNumber} has ${discTracks.length} tracks`)

        for (const track of discTracks) {
          tracks.push({
            musicbrainz_id: track.id,
            title: track.title,
            track_number: track.position ?? track.number ?? 0,
            disc_number: discNumber,
            duration_ms: track.length,
          })
        }
      }

      getLoggingService().info('[MusicBrainzService]', `Total tracks extracted: ${tracks.length}`)
      return { releaseId, tracks }
    } catch (error) {
      if (this.isRetryableConnectionError(error)) throw error
      const is404 = error instanceof Error && error.message.includes('404')
      if (is404) {
        getLoggingService().warn('[MusicBrainzService]', 'Track list not found in MusicBrainz (404)')
      } else {
        getLoggingService().error('[MusicBrainzService]', 'Track list fetch failed:', error)
      }
      return null
    }
  }

  private cleanAlbumTitleForSearch(title: string): string {
    return title
      .replace(/\s*\(\d{4}\)\s*$/, '')
      .replace(/\s*\((Deluxe|Remaster(ed)?|Anniversary|Expanded|Special|Limited)\s*(Edition|Version)?\)\s*$/i, '')
      .replace(/\s*\[?(Disc|CD)\s*\d+\]?\s*$/i, '')
      .trim()
  }

  async searchRelease(artistName: string, albumTitle: string): Promise<Array<{
    id: string
    title: string
    artist_credit: string
    date?: string
    country?: string
    score: number
  }>> {
    if (isPlaceholderMusicTitle(artistName) || isPlaceholderMusicTitle(albumTitle)) {
      return []
    }

    try {
      const cleanedTitle = this.cleanAlbumTitleForSearch(albumTitle)
      if (isPlaceholderMusicTitle(cleanedTitle)) {
        return []
      }
      if (cleanedTitle !== albumTitle) {
        getLoggingService().info('[MusicBrainzService]', `Cleaned title for search: "${albumTitle}" -> "${cleanedTitle}"`)
      }
      const query = `release:"${cleanedTitle}" AND artist:"${artistName}"`
      const releaseGroups = await this.requestWithRetry(async () => {
        const response = await this.api.get('/release-group', {
          params: {
            query,
            fmt: 'json',
            limit: 5,
          },
        })
        interface MBReleaseGroupsResponse { 'release-groups'?: Array<{
          id: string
          title: string
          'first-release-date'?: string
          score?: number
          'artist-credit'?: Array<{ name?: string; artist?: { country?: string } }>
        }> }
        return (response.data as MBReleaseGroupsResponse)?.['release-groups'] || []
      }, `searchRelease(${artistName} - ${albumTitle})`)

      return releaseGroups.map((rg) => ({
        id: rg.id,
        title: rg.title,
        artist_credit: rg['artist-credit']?.[0]?.name || artistName,
        date: rg['first-release-date'] || undefined,
        country: rg['artist-credit']?.[0]?.artist?.country || undefined,
        score: rg.score || 0,
      }))
    } catch (error) {
      getLoggingService().error('[MusicBrainzService]', '[MusicBrainzService] Release search failed:', error)
      if (this.isRetryableConnectionError(error)) throw error
      return []
    }
  }

  async analyzeArtistCompleteness(
    artistName: string,
    musicbrainzId: string | undefined,
    ownedAlbumTitles: string[],
    ownedAlbumMbIds: string[],
    filterVinylOnly: boolean = false
  ): Promise<ArtistCompleteness & { foundMbId?: string }> {
    if (isPlaceholderMusicTitle(artistName)) {
      return {
        artist_name: artistName,
        total_albums: 0,
        owned_albums: ownedAlbumTitles.length,
        total_singles: 0,
        owned_singles: 0,
        total_eps: 0,
        owned_eps: 0,
        missing_albums: '[]',
        missing_singles: '[]',
        missing_eps: '[]',
        completeness_percentage: 100,
        last_sync_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    }

    let mbId = musicbrainzId
    let foundMbId: string | undefined

    if (!mbId) {
      const searchResults = await this.searchArtist(artistName)
      if (searchResults.length > 0) {
        const exactMatch = searchResults.find(a =>
          a.name.toLowerCase() === artistName.toLowerCase()
        )
        mbId = exactMatch?.id || searchResults[0].id
        foundMbId = mbId
      }
    }

    if (!mbId) {
      return {
        artist_name: artistName,
        total_albums: 0,
        owned_albums: ownedAlbumTitles.length,
        total_singles: 0,
        owned_singles: 0,
        total_eps: 0,
        owned_eps: 0,
        missing_albums: '[]',
        missing_singles: '[]',
        missing_eps: '[]',
        completeness_percentage: 100,
        last_sync_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    }

    const discography = await this.getArtistDiscography(mbId, filterVinylOnly)

    const normalizeTitle = (title: string) => {
      return title
        .replace(/\s*\(\d{4}\)\s*/g, ' ')
        .replace(/\s*\((Deluxe|Remaster(ed)?|Anniversary|Expanded|Special|Limited|Explicit)\s*(Edition|Version)?\)\s*/gi, ' ')
        .replace(/\s*\[?(Disc|CD)\s*\d+\]?\s*/gi, ' ')
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    }

    const ownedNormalized = new Set([
      ...ownedAlbumTitles.map(normalizeTitle),
      ...ownedAlbumMbIds,
    ])

    const parseValidYear = (dateStr?: string | number | null): number | undefined => {
      if (dateStr == null) return undefined
      if (typeof dateStr === 'number') {
        return isNaN(dateStr) || dateStr < 1800 || dateStr > 2100 ? undefined : Math.floor(dateStr)
      }
      const match = String(dateStr).match(/\b(\d{4})\b/)
      if (!match) return undefined
      const year = parseInt(match[1], 10)
      return isNaN(year) || year < 1800 || year > 2100 ? undefined : year
    }

    const missingAlbums: MissingAlbum[] = []
    for (const album of discography.albums) {
      const normalizedTitle = normalizeTitle(album.title)
      const isOwned = ownedNormalized.has(normalizedTitle) || ownedNormalized.has(album.id)

      if (!isOwned) {
        missingAlbums.push({
          musicbrainz_id: album.id,
          title: album.title,
          year: parseValidYear(album['first-release-date']),
          album_type: AlbumType.Album,
        })
      }
    }

    const missingEps: MissingAlbum[] = []
    for (const ep of discography.eps) {
      const normalizedTitle = normalizeTitle(ep.title)
      const isOwned = ownedNormalized.has(normalizedTitle) || ownedNormalized.has(ep.id)

      if (!isOwned) {
        missingEps.push({
          musicbrainz_id: ep.id,
          title: ep.title,
          year: parseValidYear(ep['first-release-date']),
          album_type: AlbumType.EP,
        })
      }
    }

    const missingSingles: MissingAlbum[] = []
    for (const single of discography.singles) {
      const normalizedTitle = normalizeTitle(single.title)
      const isOwned = ownedNormalized.has(normalizedTitle) || ownedNormalized.has(single.id)

      if (!isOwned) {
        missingSingles.push({
          musicbrainz_id: single.id,
          title: single.title,
          year: parseValidYear(single['first-release-date']),
          album_type: AlbumType.Single,
        })
      }
    }

    const ownedAlbumsCount = ownedAlbumTitles.length
    const ownedEpsCount = discography.eps.length - missingEps.length
    const ownedSinglesCount = discography.singles.length - missingSingles.length

    const db = getDatabase()
    const includeEps = await db.config.getSetting('completeness_include_eps') !== 'false'
    const includeSingles = await db.config.getSetting('completeness_include_singles') !== 'false'

    const totalItems = discography.albums.length * 3
      + (includeEps ? discography.eps.length * 2 : 0)
      + (includeSingles ? discography.singles.length : 0)
    const ownedItems = ownedAlbumsCount * 3
      + (includeEps ? ownedEpsCount * 2 : 0)
      + (includeSingles ? ownedSinglesCount : 0)

    const completenessPercentage = totalItems > 0
      ? Math.round((ownedItems / totalItems) * 100)
      : 100

    getLoggingService().verbose('[MusicBrainzService]',
      `"${artistName}" — ${ownedAlbumsCount}/${discography.albums.length} albums, ${missingAlbums.length} missing, ${completenessPercentage}% complete`)

    return {
      artist_name: artistName,
      musicbrainz_id: mbId,
      total_albums: discography.albums.length,
      owned_albums: ownedAlbumsCount,
      total_singles: discography.singles.length,
      owned_singles: ownedSinglesCount,
      total_eps: discography.eps.length,
      owned_eps: ownedEpsCount,
      missing_albums: JSON.stringify(missingAlbums),
      missing_singles: JSON.stringify(missingSingles),
      missing_eps: JSON.stringify(missingEps),
      completeness_percentage: completenessPercentage,
      country: discography.artist.country,
      active_years: discography.artist['life-span'] ? JSON.stringify({
        begin: discography.artist['life-span'].begin,
        end: discography.artist['life-span'].end,
      }) : undefined,
      artist_type: discography.artist.type,
      last_sync_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      foundMbId,
    }
  }

  private async validateStoredAlbumIdentity(
    albumId: number,
    artistName: string,
    albumTitle: string
  ): Promise<void> {
    const db = getDatabase()
    const album = await db.music.getAlbumById(albumId)
    if (!album) {
      throw new Error(`Music database integrity error: album_id ${albumId} does not exist`)
    }
    if (album.title !== albumTitle) {
      throw new Error(
        `Music database integrity error: album_id ${albumId} is stored as "${album.title}" but analysis requested "${albumTitle}"`
      )
    }
    if (album.artist_name !== artistName) {
      throw new Error(
        `Music database integrity error: album "${album.title}" is stored as artist "${album.artist_name}" but analysis requested "${artistName}"`
      )
    }
    if (album.artist_id === undefined) return

    const artist = await db.music.getArtistById(album.artist_id)
    if (!artist) {
      throw new Error(
        `Music database integrity error: album "${album.title}" references missing artist_id ${album.artist_id}`
      )
    }
    if (album.source_id !== artist.source_id) {
      throw new Error(
        `Music database integrity error: album "${album.title}" source ${album.source_id} does not match artist "${artist.name}" source ${artist.source_id}`
      )
    }
    if (album.artist_name !== artist.name) {
      throw new Error(
        `Music database integrity error: album "${album.title}" is stored as artist "${album.artist_name}" but artist_id ${album.artist_id} resolves to "${artist.name}"`
      )
    }
  }

  async analyzeAlbumTrackCompleteness(
    albumId: number,
    artistName: string,
    albumTitle: string,
    musicbrainzReleaseGroupId: string | undefined,
    ownedTrackTitles: string[]
  ): Promise<(AlbumCompleteness & { foundMbId?: string }) | null> {
    if (isPlaceholderMusicTitle(artistName) || isPlaceholderMusicTitle(albumTitle)) {
      return null
    }

    await this.validateStoredAlbumIdentity(albumId, artistName, albumTitle)

    getLoggingService().info('[MusicBrainzService]', `analyzeAlbumTrackCompleteness: "${artistName}" - "${albumTitle}" (mbid: ${musicbrainzReleaseGroupId || 'none'})`)

    let tracklist: Awaited<ReturnType<typeof this.getReleaseTracklist>> = null
    let foundMbId: string | undefined
    const originalMbId = musicbrainzReleaseGroupId
    const expectedTrackCount = ownedTrackTitles.length || undefined

    if (musicbrainzReleaseGroupId) {
      getLoggingService().info('[MusicBrainzService]', `Trying stored MBID: ${musicbrainzReleaseGroupId}`)
      tracklist = await this.getReleaseTracklist(musicbrainzReleaseGroupId, expectedTrackCount)
    }

    if (!tracklist || tracklist.tracks.length === 0) {
      getLoggingService().info('[MusicBrainzService]', `Stored MBID didn't work, searching MusicBrainz for "${artistName}" - "${albumTitle}"...`)
      const searchResults = await this.searchRelease(artistName, albumTitle)

      for (const result of searchResults) {
        getLoggingService().info('[MusicBrainzService]', `Trying search result: ${result.id} (${result.title})`)
        tracklist = await this.getReleaseTracklist(result.id, expectedTrackCount)
        if (tracklist && tracklist.tracks.length > 0) {
          musicbrainzReleaseGroupId = result.id
          if (!originalMbId) {
            foundMbId = result.id
          }
          getLoggingService().info('[MusicBrainzService]', `Found tracklist with ${tracklist.tracks.length} tracks`)
          break
        }
      }
    }

    if (!tracklist || tracklist.tracks.length === 0) {
      getLoggingService().info('[MusicBrainzService]', `No tracklist found for "${artistName}" - "${albumTitle}"`)
      return null
    }
    getLoggingService().info('[MusicBrainzService]', `Using tracklist with ${tracklist.tracks.length} tracks`)

    const normalizeTitle = (title: string) =>
      title.toLowerCase().replace(/[^\w\s]/g, '').trim()

    const ownedNormalized = new Set(ownedTrackTitles.map(normalizeTitle))

    const missingTracks: MissingTrack[] = []
    for (const track of tracklist.tracks) {
      const normalizedTitle = normalizeTitle(track.title)
      if (!ownedNormalized.has(normalizedTitle)) {
        missingTracks.push({
          musicbrainz_id: track.musicbrainz_id,
          title: track.title,
          track_number: track.track_number,
          disc_number: track.disc_number,
          duration_ms: track.duration_ms,
        })
      }
    }

    const ownedTracks = tracklist.tracks.length - missingTracks.length
    const completenessPercentage = tracklist.tracks.length > 0
      ? Math.round((ownedTracks / tracklist.tracks.length) * 100)
      : 100

    return {
      album_id: albumId,
      artist_name: artistName,
      album_title: albumTitle,
      musicbrainz_release_id: tracklist.releaseId,
      musicbrainz_release_group_id: musicbrainzReleaseGroupId,
      total_tracks: tracklist.tracks.length,
      owned_tracks: ownedTracks,
      missing_tracks: JSON.stringify(missingTracks),
      completeness_percentage: completenessPercentage,
      last_sync_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      foundMbId,
    }
  }

  async analyzeAllMusic(
    onProgress?: (progress: MusicAnalysisProgress) => void,
    sourceId?: string,
    options: MusicAnalysisOptions = {}
  ): Promise<AnalysisOutcome & { artistsAnalyzed: number; albumsAnalyzed: number; skipped: number; deferred: number }> {
    const {
      skipRecentlyAnalyzed = true,
      reanalyzeAfterDays = 7,
      filterVinylOnly = false,
    } = options

    this.resetCancellation()

    const db = getDatabase()
    const updateArtwork = true
    const artistFilters = sourceId ? { sourceId } : undefined
    const albumFilters = sourceId ? { sourceId } : undefined

    const artists = await db.music.getArtists(artistFilters)
    const allSourceAlbums = (await db.music.getAlbums(albumFilters)) as MusicAlbum[]
    const allSourceTracks = await db.music.getTracks(albumFilters)

    const artistsById = new Map<number, (typeof artists)[number]>()
    for (const artist of artists) {
      if (artist.id === undefined) {
        throw new Error(`Music database integrity error: artist "${artist.name}" is missing its database id`)
      }
      artistsById.set(artist.id, artist)
    }

    const albumsByArtist = new Map<number, MusicAlbum[]>()
    const albumsById = new Map<number, MusicAlbum>()
    for (const album of allSourceAlbums) {
      if (album.id === undefined) {
        throw new Error(`Music database integrity error: album "${album.title}" is missing its database id`)
      }
      albumsById.set(album.id, album)

      if (album.artist_id === undefined) continue

      const artist = artistsById.get(album.artist_id)
      if (!artist) {
        throw new Error(
          `Music database integrity error: album "${album.title}" references missing artist_id ${album.artist_id}`
        )
      }
      if (album.source_id !== artist.source_id) {
        throw new Error(
          `Music database integrity error: album "${album.title}" source ${album.source_id} does not match artist "${artist.name}" source ${artist.source_id}`
        )
      }
      if (album.artist_name !== artist.name) {
        throw new Error(
          `Music database integrity error: album "${album.title}" is stored as artist "${album.artist_name}" but artist_id ${album.artist_id} resolves to "${artist.name}"`
        )
      }

      const artistAlbums = albumsByArtist.get(album.artist_id)
      if (artistAlbums) artistAlbums.push(album)
      else albumsByArtist.set(album.artist_id, [album])
    }

    const tracksByAlbum = new Map<number, MusicTrack[]>()
    for (const track of allSourceTracks) {
      if (track.album_id === undefined) {
        throw new Error(`Music database integrity error: track "${track.title}" has no album_id`)
      }
      const album = albumsById.get(track.album_id)
      if (!album) {
        throw new Error(
          `Music database integrity error: track "${track.title}" references missing album_id ${track.album_id}`
        )
      }
      if (track.source_id !== album.source_id) {
        throw new Error(
          `Music database integrity error: track "${track.title}" source ${track.source_id} does not match album "${album.title}" source ${album.source_id}`
        )
      }
      if (track.album_name !== undefined && track.album_name !== album.title) {
        throw new Error(
          `Music database integrity error: track "${track.title}" is stored under album "${track.album_name}" but album_id ${track.album_id} resolves to "${album.title}"`
        )
      }

      const albumTracks = tracksByAlbum.get(track.album_id)
      if (albumTracks) albumTracks.push(track)
      else tracksByAlbum.set(track.album_id, [track])
    }

    const existingArtistCompleteness = new Map<string, string>()
    const existingAlbumCompleteness = new Map<number, string>()

    if (skipRecentlyAnalyzed) {
      const allArtistCompleteness = await db.music.getAllArtistCompleteness()
      for (const ac of allArtistCompleteness.artists) {
        if (ac.last_sync_at) {
          existingArtistCompleteness.set(ac.artist_name, ac.last_sync_at)
        }
      }
      const allAlbumCompleteness = await db.music.getAllAlbumCompleteness()
      for (const ac of allAlbumCompleteness) {
        if (ac.last_sync_at && ac.album_id) {
          existingAlbumCompleteness.set(ac.album_id, ac.last_sync_at)
        }
      }
      getLoggingService().info('[MusicBrainzService]', `Found ${existingArtistCompleteness.size} artists and ${existingAlbumCompleteness.size} albums with existing completeness data`)
    }

    const totalItems = artists.length + allSourceAlbums.length
    let currentItem = 0
    let artistsAnalyzed = 0
    let albumsAnalyzed = 0
    let skipped = 0
    let deferred = 0
    let deferredArtists = 0
    let deferredAlbums = 0
    const errors: string[] = []
    const diagnostics: AnalysisDiagnostic[] = []

    onProgress?.({
      current: 0,
      total: totalItems,
      currentItem: 'Starting analysis...',
      phase: 'artists',
      percentage: 0,
      artistsTotal: artists.length,
      albumsTotal: allSourceAlbums.length,
      phaseIndex: 0,
      skipped: 0,
    })

    let consecutiveNetworkErrors = 0
    const MAX_CONSECUTIVE_NETWORK_ERRORS = 5

    let circuitBroken = false
    getLoggingService().info('[MusicBrainzService]', `Phase 1: Analyzing ${artists.length} artists (skipRecent=${skipRecentlyAnalyzed}, vinylFilter=${filterVinylOnly})`)

    for (let artistIdx = 0; artistIdx < artists.length; artistIdx++) {
      const artist = artists[artistIdx]
      if (this.isCancelled()) {
        getLoggingService().info('[MusicBrainzService]', `Analysis cancelled at artist ${currentItem + 1}/${totalItems}`)
        deferred = (artists.length - artistIdx) + allSourceAlbums.length
        const completedCount = artistsAnalyzed + albumsAnalyzed
        return {
          status: 'cancelled',
          completedCount,
          deferredCount: deferred,
          failedCount: errors.length,
          diagnostics,
          artistsAnalyzed,
          albumsAnalyzed,
          skipped,
          deferred,
          completed: false,
          errors,
        }
      }

      if (isPlaceholderMusicTitle(artist.name)) {
        skipped++
        currentItem++
        continue
      }

      if (skipRecentlyAnalyzed) {
        const lastSync = existingArtistCompleteness.get(artist.name)
        if (wasRecentlyAnalyzed(lastSync, reanalyzeAfterDays)) {
          skipped++
          currentItem++
          continue
        }
      }

      const artistIndex = currentItem + 1
      onProgress?.({
        current: currentItem,
        total: totalItems,
        currentItem: artist.name,
        phase: 'artists',
        percentage: (currentItem / totalItems) * 100,
        artistsTotal: artists.length,
        albumsTotal: allSourceAlbums.length,
        phaseIndex: artistIndex,
        skipped,
      })

      try {
        const artistAlbums = albumsByArtist.get(artist.id!) || []
        const ownedTitles = artistAlbums.map(a => a.title)
        const ownedMbIds = artistAlbums
          .filter(a => a.musicbrainz_id)
          .map(a => a.musicbrainz_id!)

        const completeness = await this.analyzeArtistCompleteness(
          artist.name,
          artist.musicbrainz_id,
          ownedTitles,
          ownedMbIds,
          filterVinylOnly
        )

        await db.withBatch(async () => {
          await db.music.upsertArtistCompleteness(completeness)
          if (completeness.foundMbId && !artist.musicbrainz_id && artist.id) {
            await db.music.updateMusicArtistMbid(artist.id, completeness.foundMbId)
            getLoggingService().info('[MusicBrainzService]', `Cached MBID for artist "${artist.name}": ${completeness.foundMbId}`)
          }
        })

        artistsAnalyzed++
        consecutiveNetworkErrors = 0
      } catch (error) {
        getLoggingService().error('[MusicBrainzService]', `Failed to analyze artist "${artist.name}":`, error)
        const message = `artist "${artist.name}": ${getErrorMessage(error)}`
        errors.push(message)
        const isDb = this.isDatabaseError(error)
        const isRetry = this.isRetryableConnectionError(error)
        diagnostics.push({
          itemType: 'artist',
          itemId: artist.id,
          itemName: artist.name,
          category: isDb ? 'database' : 'provider',
          code: isDb ? 'DATABASE_ERROR' : (isRetry ? 'PROVIDER_NETWORK_ERROR' : 'PROVIDER_ERROR'),
          message,
          cause: getErrorMessage(error),
          provider: isDb ? undefined : 'musicbrainz',
          identifier: artist.musicbrainz_id || undefined,
          retryable: isRetry,
          item: artist.name,
          kind: isDb ? 'database' : 'provider',
        } as AnalysisDiagnostic & { item?: string; kind?: string })

        if (isRetry) {
          consecutiveNetworkErrors++
          if (consecutiveNetworkErrors >= MAX_CONSECUTIVE_NETWORK_ERRORS) {
            getLoggingService().warn('[MusicBrainzService]', `Circuit breaker tripped after ${MAX_CONSECUTIVE_NETWORK_ERRORS} consecutive network errors. Halting current music analysis run.`)
            circuitBroken = true
            deferredArtists = artists.length - currentItem
            break
          }
        }
      }

      currentItem++
    }

    if (circuitBroken) {
      deferred = deferredArtists + allSourceAlbums.length
      const completedCount = artistsAnalyzed + albumsAnalyzed
      return {
        status: completedCount > 0 ? 'partial' : 'deferred',
        completedCount,
        deferredCount: deferred,
        failedCount: errors.length,
        diagnostics,
        artistsAnalyzed,
        albumsAnalyzed,
        skipped,
        deferred,
        completed: false,
        errors,
      }
    }

    getLoggingService().info('[MusicBrainzService]', `Phase 2: Analyzing ${allSourceAlbums.length} albums`)

    for (let albumIdx = 0; albumIdx < allSourceAlbums.length; albumIdx++) {
      const album = allSourceAlbums[albumIdx]
      if (this.isCancelled()) {
        getLoggingService().info('[MusicBrainzService]', `Analysis cancelled at album ${currentItem + 1}/${totalItems}`)
        deferred = allSourceAlbums.length - albumIdx
        const completedCount = artistsAnalyzed + albumsAnalyzed
        return {
          status: 'cancelled',
          completedCount,
          deferredCount: deferred,
          failedCount: errors.length,
          diagnostics,
          artistsAnalyzed,
          albumsAnalyzed,
          skipped,
          deferred,
          completed: false,
          errors,
        }
      }

      if (isPlaceholderMusicTitle(album.title) || isPlaceholderMusicTitle(album.artist_name)) {
        skipped++
        currentItem++
        continue
      }

      if (skipRecentlyAnalyzed && album.id) {
        const lastSync = existingAlbumCompleteness.get(album.id)
        if (wasRecentlyAnalyzed(lastSync, reanalyzeAfterDays)) {
          skipped++
          currentItem++
          continue
        }
      }

      const albumIndex = currentItem - artists.length + 1
      onProgress?.({
        current: currentItem,
        total: totalItems,
        currentItem: `${album.artist_name} - ${album.title}`,
        phase: 'albums',
        percentage: (currentItem / totalItems) * 100,
        artistsTotal: artists.length,
        albumsTotal: allSourceAlbums.length,
        phaseIndex: albumIndex,
        skipped,
      })

      try {
        const tracks = tracksByAlbum.get(album.id!) || []
        const ownedTrackTitles = tracks.map(t => t.title)

        const completeness = await this.analyzeAlbumTrackCompleteness(
          album.id!,
          album.artist_name,
          album.title,
          album.musicbrainz_id,
          ownedTrackTitles
        )

        if (completeness) {
          await db.withBatch(async () => {
            await db.music.upsertAlbumCompleteness(completeness)
            if (completeness.foundMbId && !album.musicbrainz_id && album.id) {
              await db.music.updateMusicAlbumMbid(album.id, completeness.foundMbId)
              getLoggingService().info('[MusicBrainzService]', `Cached MBID for album "${album.title}": ${completeness.foundMbId}`)
            }
          })

          if (updateArtwork && completeness.musicbrainz_release_group_id) {
            await this.updateAlbumArtworkFromCoverArt(album, completeness.musicbrainz_release_group_id)
          }
        }
        albumsAnalyzed++
        consecutiveNetworkErrors = 0
      } catch (error) {
        getLoggingService().error('[MusicBrainzService]', `Failed to analyze album "${album.title}":`, error)
        const message = `album "${album.title}": ${getErrorMessage(error)}`
        errors.push(message)
        const isDb = this.isDatabaseError(error)
        const isRetry = this.isRetryableConnectionError(error)
        diagnostics.push({
          itemType: 'album',
          itemId: album.id,
          itemName: album.title,
          category: isDb ? 'database' : 'provider',
          code: isDb ? 'DATABASE_ERROR' : (isRetry ? 'PROVIDER_NETWORK_ERROR' : 'PROVIDER_ERROR'),
          message,
          cause: getErrorMessage(error),
          provider: isDb ? undefined : 'musicbrainz',
          identifier: album.musicbrainz_id || undefined,
          retryable: isRetry,
          item: album.title,
          kind: isDb ? 'database' : 'provider',
        } as AnalysisDiagnostic & { item?: string; kind?: string })

        if (isRetry) {
          consecutiveNetworkErrors++
          if (consecutiveNetworkErrors >= MAX_CONSECUTIVE_NETWORK_ERRORS) {
            getLoggingService().warn('[MusicBrainzService]', `Circuit breaker tripped after ${MAX_CONSECUTIVE_NETWORK_ERRORS} consecutive network errors. Halting current music analysis run.`)
            circuitBroken = true
            deferredAlbums = allSourceAlbums.length - (currentItem - artists.length)
            break
          }
        }
      }

      currentItem++
    }

    if (circuitBroken) deferred = deferredArtists + deferredAlbums

    onProgress?.({
      current: totalItems,
      total: totalItems,
      currentItem: '',
      phase: 'complete',
      percentage: 100,
      artistsTotal: artists.length,
      albumsTotal: allSourceAlbums.length,
      phaseIndex: 0,
      skipped,
    })

    getLoggingService().info('[MusicBrainzService]', `Analysis complete: ${artistsAnalyzed} artists, ${albumsAnalyzed} albums analyzed, ${skipped} skipped (recently analyzed)`)
    const completedCount = artistsAnalyzed + albumsAnalyzed
    const deferredCount = deferred
    const failedCount = errors.length
    const status: AnalysisStatus = this.isCancelled()
      ? 'cancelled'
      : circuitBroken
        ? ((deferredArtists > 0 ? artistsAnalyzed === 0 : albumsAnalyzed === 0) ? 'deferred' : 'partial')
        : failedCount > 0
          ? (completedCount > 0 ? 'partial' : 'failed')
          : 'completed'

    return {
      status,
      completedCount,
      deferredCount,
      failedCount,
      diagnostics,
      artistsAnalyzed,
      albumsAnalyzed,
      skipped,
      deferred,
      completed: status === 'completed',
      errors,
    }
  }

  private async updateAlbumArtworkFromCoverArt(album: MusicAlbum, releaseGroupId: string): Promise<void> {
    const db = getDatabase()

    if (album.thumb_url || album.art_url) {
      return
    }

    try {
      const artworkUrl = await this.getCoverArtUrl(releaseGroupId)

      if (artworkUrl) {
        await db.music.updateMusicAlbumArtwork(album.source_id, album.provider_id, {
          thumbUrl: artworkUrl,
          artUrl: this.buildCoverArtUrl(releaseGroupId, '1200'),
        })
        getLoggingService().info('[MusicBrainzService]', `Updated artwork for "${album.artist_name} - ${album.title}"`)
      }
    } catch (error) {
      getLoggingService().warn('[MusicBrainzService]', `Failed to fetch artwork for "${album.title}":`, error)
    }
  }
}

let musicBrainzInstance: MusicBrainzService | null = null

export function getMusicBrainzService(): MusicBrainzService {
  if (!musicBrainzInstance) {
    musicBrainzInstance = new MusicBrainzService()
  }
  return musicBrainzInstance
}

export function resetMusicBrainzServiceForTesting(): void {
  musicBrainzInstance = null
}
