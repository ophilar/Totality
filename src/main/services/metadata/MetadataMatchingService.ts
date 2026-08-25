import { CompositeMetadataProvider } from './CompositeMetadataProvider'
import { MetadataType, MetadataSearchResult, MetadataSearchQuery } from './IMetadataProvider'
import { normalizeTitleForMatching, scoreTitleMatch } from './TitleMatching'

export interface MatchMediaItemParams {
  title: string
  year?: number
  type: MetadataType
  externalIds?: Record<string, string>
  artistName?: string
  includeExpanded?: boolean
  /** @deprecated Compatibility alias for existing IPC callers. */
  includeAdult?: boolean
}

export function selectAutomaticMatch(
  candidates: MetadataSearchResult[],
  query: Pick<MatchMediaItemParams, 'title' | 'year' | 'type' | 'externalIds'>
): MetadataSearchResult | null {
  if (!candidates || candidates.length === 0) return null

  // 1. Direct Authoritative External ID Resolution (100% precision)
  if (query.externalIds) {
    const targetIds = Object.entries(query.externalIds).filter(([, idValue]) => Boolean(idValue))
    if (targetIds.length > 0) {
      const directIdMatch = candidates.find(candidate => {
        const candidateIds = (candidate.externalIds || {}) as Record<string, string | undefined>
        return targetIds.some(([idKey, idValue]) => {
          const normalizedKey = idKey === 'imdb_id' ? 'imdbId' : idKey === 'tmdb_id' ? 'tmdbId' : idKey === 'tvdb_id' ? 'tvdbId' : idKey === 'anilist_id' ? 'anilistId' : idKey
          return candidateIds[normalizedKey] === idValue || candidateIds[idKey] === idValue
        })
      })
      if (directIdMatch) return directIdMatch
    }
  }

  const typeCandidates = candidates.filter(c => c.type === query.type)
  if (typeCandidates.length === 0) return null

  const normalizedQuery = normalizeTitleForMatching(query.title)

  // 2. Exact Title Matches
  const exactTitleMatches = typeCandidates.filter(
    candidate => normalizeTitleForMatching(candidate.title) === normalizedQuery
  )

  if (exactTitleMatches.length > 0) {
    // If year specified, prefer exact year match
    if (query.year != null) {
      const exactYearMatch = exactTitleMatches.find(c => c.year === query.year)
      if (exactYearMatch) return exactYearMatch

      // Fuzzy year match (+/- 1 year difference due to theatrical vs digital/DVD release dates)
      const fuzzyYearMatch = exactTitleMatches.find(c => c.year != null && Math.abs(c.year - query.year!) <= 1)
      if (fuzzyYearMatch) return fuzzyYearMatch
    }

    // Single exact title match only; if multiple matches exist without a year, it's ambiguous
    if (exactTitleMatches.length === 1) {
      return exactTitleMatches[0]
    }
    return null
  }

  // 3. High-Confidence Score Match (Substring/token overlap + year)
  // typeCandidates are already sorted by match score descending.
  const topCandidate = typeCandidates[0]
  const topScore = scoreTitleMatch(topCandidate.title, query.title, topCandidate.year, query.year)

  if (topScore >= 75) {
    if (typeCandidates.length === 1) return topCandidate

    const secondCandidate = typeCandidates[1]
    const secondScore = scoreTitleMatch(secondCandidate.title, query.title, secondCandidate.year, query.year)

    // Clear winner if significantly higher score (>= 15 points difference) or very high score (>= 90)
    if (topScore - secondScore >= 15 || topScore >= 90) {
      return topCandidate
    }
  }

  return null
}

/**
 * Unified single-path orchestrator for matching media metadata.
 * Uses CompositeMetadataProvider's fusion capability to fetch and score metadata.
 */
export class MetadataMatchingService {
  constructor(private compositeProvider: CompositeMetadataProvider) {}

  /**
   * Matches a media item using the composite provider and returns a list of sorted candidates.
   */
  async matchMediaItem(params: MatchMediaItemParams): Promise<MetadataSearchResult[]> {
    const candidates = new Map<string, MetadataSearchResult>()
    const keyByExternalId = new Map<string, string>()

    const registerCandidate = (result: MetadataSearchResult): void => {
      const resultIds = Object.values(result.externalIds || {}).filter(Boolean) as string[]
      let sharedKey: string | undefined
      for (const id of resultIds) {
        if (keyByExternalId.has(id)) {
          sharedKey = keyByExternalId.get(id)
          break
        }
      }

      const key = sharedKey || (result.externalIds?.tmdbId
        ? `tmdb:${result.externalIds.tmdbId}`
        : result.externalIds?.tvdbId
          ? `tvdb:${result.externalIds.tvdbId}`
          : result.externalIds?.imdbId
            ? `imdb:${result.externalIds.imdbId}`
            : result.externalIds?.musicBrainzId
              ? `mb:${result.externalIds.musicBrainzId}`
              : result.externalIds?.anilistId
                ? `anilist:${result.externalIds.anilistId}`
                : `${normalizeTitleForMatching(result.title)}_${result.year || 'unknown'}_${result.type}`)

      for (const id of resultIds) {
        keyByExternalId.set(id, key)
      }

      const existing = candidates.get(key)
      if (!existing || (result.score || 0) > (existing.score || 0)) {
        candidates.set(key, { ...result })
      } else {
        if (!existing.overview && result.overview) existing.overview = result.overview
        if (!existing.posterUrl && result.posterUrl) existing.posterUrl = result.posterUrl
        if (!existing.bannerUrl && result.bannerUrl) existing.bannerUrl = result.bannerUrl
        if (!existing.network && result.network) existing.network = result.network
        if (!existing.status && result.status) existing.status = result.status
        if (!existing.country && result.country) existing.country = result.country
        if (!existing.originalLanguage && result.originalLanguage) existing.originalLanguage = result.originalLanguage
        if (!existing.firstAirDate && result.firstAirDate) existing.firstAirDate = result.firstAirDate
        if (!existing.releaseDate && result.releaseDate) existing.releaseDate = result.releaseDate
        if (result.externalIds || existing.externalIds) {
          existing.externalIds = { ...result.externalIds, ...existing.externalIds }
        }
        const alternateTitles = Array.from(new Set([...(existing.alternateTitles || []), ...(result.alternateTitles || [])]))
        if (alternateTitles.length) existing.alternateTitles = alternateTitles
      }
    }

    // Strategy 1: Direct Authoritative External ID Resolution (100% precision)
    if (params.externalIds) {
      const imdbId = params.externalIds.imdbId || params.externalIds.imdb_id
      const tvdbId = params.externalIds.tvdbId || params.externalIds.tvdb_id
      if (imdbId) {
        const directImdb = await this.compositeProvider.findByExternalId(imdbId, 'imdb_id', params.type)
        if (directImdb) {
          registerCandidate({ ...directImdb, score: 100 })
        }
      }
      if (tvdbId && params.type === 'tv') {
        const directTvdb = await this.compositeProvider.findByExternalId(tvdbId, 'tvdb_id', params.type)
        if (directTvdb) {
          registerCandidate({ ...directTvdb, score: 100 })
        }
      }
    }

    // Strategy 2: Multi-Query Search & Fusion
    const normalizedTitle = normalizeTitleForMatching(params.title)
    
    // Strip studio prefixes (e.g. "[Studio] Title" or "Studio - Title" or scene date tags)
    const strippedPrefix = params.title
      .replace(/^\[.*?\]\s*/, '')
      .replace(/^[A-Za-z0-9\s._]+-\s*/, '')
      .replace(/\b\d{2}[._-]\d{2}[._-]\d{2}\b/, '')
      .replace(/\b\d{4}[._-]\d{2}[._-]\d{2}\b/, '')
      .trim()
    const normalizedStripped = strippedPrefix ? normalizeTitleForMatching(strippedPrefix) : ''

    const rawQueries = [
      { title: params.title, year: params.year },
      { title: normalizedTitle, year: params.year },
      { title: strippedPrefix, year: params.year },
      { title: normalizedStripped, year: params.year },
      { title: params.title },
      { title: normalizedTitle },
      { title: strippedPrefix },
      { title: normalizedStripped }
    ]

    const queries = rawQueries.filter((query, index, all) => 
      query.title && query.title.length > 0 && 
      all.findIndex(c => c.title === query.title && c.year === query.year) === index
    )

    for (const query of queries) {
      const searchQuery: MetadataSearchQuery = {
        title: query.title,
        year: query.year,
        type: params.type,
        externalIds: params.externalIds,
        artistName: params.artistName,
        includeAdult: params.includeAdult
      }
      const expanded = params.includeExpanded ?? params.includeAdult
      if (expanded !== undefined) searchQuery.includeExpanded = expanded
      const results = await this.compositeProvider.searchAndFuse(searchQuery)

      for (const result of results) {
        registerCandidate(result)
      }
    }

    return Array.from(candidates.values()).sort((a, b) => {
      const scoreA = Math.max(
        scoreTitleMatch(a.title, params.title, a.year, params.year),
        ...(a.alternateTitles || []).map(alt => scoreTitleMatch(alt, params.title, a.year, params.year)),
        a.score || 0
      )
      const scoreB = Math.max(
        scoreTitleMatch(b.title, params.title, b.year, params.year),
        ...(b.alternateTitles || []).map(alt => scoreTitleMatch(alt, params.title, b.year, params.year)),
        b.score || 0
      )
      return scoreB - scoreA
    })
  }
}
