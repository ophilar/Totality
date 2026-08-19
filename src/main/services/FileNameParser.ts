/**
 * FileNameParser Service
 *
 * Parses media file names to extract metadata like title, year, season, episode,
 * quality indicators, etc. Handles common naming conventions used by media files.
 */

export interface ParsedMovieInfo {
  type: 'movie'
  title: string
  year?: number
  quality?: string
  resolution?: string
  source?: string
  codec?: string
  audioCodec?: string
  group?: string
  edition?: string
}

export interface ParsedEpisodeInfo {
  type: 'episode'
  seriesTitle: string
  seasonNumber: number
  episodeNumber: number
  episodeTitle?: string
  year?: number
  quality?: string
  resolution?: string
  source?: string
  codec?: string
  audioCodec?: string
  group?: string
  // For multi-episode files
  episodeNumberEnd?: number
}

export interface ParsedMusicInfo {
  type: 'music'
  artist?: string
  album?: string
  title: string
  trackNumber?: number
  discNumber?: number
  year?: number
}

export type ParsedMediaInfo = ParsedMovieInfo | ParsedEpisodeInfo | ParsedMusicInfo

// Singleton instance
let parserInstance: FileNameParser | null = null

export function getFileNameParser(): FileNameParser {
  if (!parserInstance) {
    parserInstance = new FileNameParser()
  }
  return parserInstance
}

export class FileNameParser {
  // Common video file extensions
  private readonly videoExtensions = new Set([
    '.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v',
    '.mpg', '.mpeg', '.m2ts', '.ts', '.vob', '.ogv', '.divx', '.xvid'
  ])

  // Common audio file extensions
  private readonly audioExtensions = new Set([
    '.mp3', '.flac', '.m4a', '.aac', '.ogg', '.wav', '.wma', '.alac',
    '.ape', '.opus', '.aiff', '.dsf', '.dff'
  ])

  // Quality indicators
  private readonly resolutionPatterns: [RegExp, string][] = [
    [/\b4k\b/i, '4K'],
    [/\b2160p?\b/i, '4K'],
    [/\buhd\b/i, '4K'],
    [/\b1080p?\b/i, '1080p'],
    [/\b1080i\b/i, '1080p'],
    [/\b720p?\b/i, '720p'],
    [/\b576p?\b/i, '576p'],
    [/\b480p?\b/i, '480p'],
    [/\bsd\b/i, 'SD'],
  ]

  // Source indicators
  private readonly sourcePatterns: [RegExp, string][] = [
    [/\bblu-?ray\b/i, 'BluRay'],
    [/\bbdrip\b/i, 'BluRay'],
    [/\bbrrip\b/i, 'BluRay'],
    [/\bremux\b/i, 'Remux'],
    [/\bweb-?dl\b/i, 'WEB-DL'],
    [/\bwebrip\b/i, 'WEBRip'],
    [/\bweb\b/i, 'WEB'],
    [/\bhdtv\b/i, 'HDTV'],
    [/\bpdtv\b/i, 'PDTV'],
    [/\bdvdrip\b/i, 'DVDRip'],
    [/\bdvd-?r\b/i, 'DVD'],
    [/\bdvd\b/i, 'DVD'],
    [/\bhdcam\b/i, 'HDCAM'],
    [/\bcam\b/i, 'CAM'],
    [/\bts\b/i, 'TS'],
    [/\bscreener\b/i, 'Screener'],
  ]

  // Video codec patterns
  private readonly videoCodecPatterns: [RegExp, string][] = [
    [/\bx\.?265\b/i, 'HEVC'],
    [/\bh\.?265\b/i, 'HEVC'],
    [/\bhevc\b/i, 'HEVC'],
    [/\bx\.?264\b/i, 'H.264'],
    [/\bh\.?264\b/i, 'H.264'],
    [/\bavc\b/i, 'H.264'],
    [/\bav1\b/i, 'AV1'],
    [/\bvp9\b/i, 'VP9'],
    [/\bxvid\b/i, 'XviD'],
    [/\bdivx\b/i, 'DivX'],
    [/\bmpeg-?2\b/i, 'MPEG-2'],
    [/\bvc-?1\b/i, 'VC-1'],
  ]

  // Audio codec patterns
  private readonly audioCodecPatterns: [RegExp, string][] = [
    [/\batmos\b/i, 'Atmos'],
    [/\btruehd\b/i, 'TrueHD'],
    [/\bdts-?hd[\s.-]?ma\b/i, 'DTS-HD MA'],
    [/\bdts-?hd\b/i, 'DTS-HD'],
    [/\bdts-?x\b/i, 'DTS:X'],
    [/\bdts\b/i, 'DTS'],
    [/\bdd\+|ddp|e-?ac-?3\b/i, 'DD+'],
    [/\bdd|ac-?3\b/i, 'DD'],
    [/\baac\b/i, 'AAC'],
    [/\bflac\b/i, 'FLAC'],
    [/\blpcm\b/i, 'LPCM'],
    [/\bmp3\b/i, 'MP3'],
  ]

  // Edition patterns
  private readonly editionPatterns: [RegExp, string][] = [
    [/\bextended\b/i, 'Extended'],
    [/\bdirector'?s?\s*cut\b/i, "Director's Cut"],
    [/\bunrated\b/i, 'Unrated'],
    [/\btheatrical\b/i, 'Theatrical'],
    [/\bimax\b/i, 'IMAX'],
    [/\bremastered\b/i, 'Remastered'],
    [/\bspecial\s*edition\b/i, 'Special Edition'],
    [/\bultimate\s*edition\b/i, 'Ultimate Edition'],
    [/\bcollector'?s?\s*edition\b/i, "Collector's Edition"],
  ]

  // TV Show patterns
  private readonly tvPatterns = [
    // S01E01 format (most common)
    /[Ss](\d{1,2})[Ee](\d{1,3})(?:[Ee-](\d{1,3}))?/,
    // 1x01 format
    /(\d{1,2})[xX](\d{1,3})(?:[-x](\d{1,3}))?/,
    // Season 1 Episode 1 format
    /[Ss]eason\s*(\d{1,2})\s*[Ee]pisode\s*(\d{1,3})/i,
    // S01.E01 format
    /[Ss](\d{1,2})\.?[Ee](\d{1,3})/,
  ]

  // Year pattern
  private readonly yearPattern = /\b(19\d{2}|20\d{2})\b/

  /**
   * Check if a file is a video file based on extension
   */
  isVideoFile(filename: string): boolean {
    const ext = this.getExtension(filename)
    return this.videoExtensions.has(ext)
  }

  /**
   * Check if a file is an audio file based on extension
   */
  isAudioFile(filename: string): boolean {
    const ext = this.getExtension(filename)
    return this.audioExtensions.has(ext)
  }

  /**
   * Check if a file is a media file (video or audio)
   */
  isMediaFile(filename: string): boolean {
    return this.isVideoFile(filename) || this.isAudioFile(filename)
  }

  /**
   * Get file extension (lowercase, with dot)
   */
  getExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.')
    if (lastDot === -1) return ''
    return filename.slice(lastDot).toLowerCase()
  }

  /**
   * Parse a media filename and return extracted metadata
   */
  parse(filename: string, folderContext?: string): ParsedMediaInfo | null {
    if (!filename || filename.length > 500) {
      return null
    }
    // Remove extension for parsing
    const ext = this.getExtension(filename)
    const nameWithoutExt = filename.slice(0, filename.length - ext.length)

    // Determine file type and parse accordingly
    if (this.isAudioFile(filename)) {
      return this.parseMusic(nameWithoutExt, folderContext)
    } else if (this.isVideoFile(filename)) {
      // Check if it's a TV episode
      const episodeInfo = this.parseEpisode(nameWithoutExt, folderContext)
      if (episodeInfo) {
        return episodeInfo
      }

      // Otherwise treat as movie
      return this.parseMovie(nameWithoutExt)
    }

    return null
  }

  /**
   * Parse a movie filename
   */
  parseMovie(name: string): ParsedMovieInfo {
    const result: ParsedMovieInfo = {
      type: 'movie',
      title: '',
    }

    // Clean the name - replace common separators with spaces
    let cleanName = name
      .replace(/\./g, ' ')
      .replace(/_/g, ' ')
      .replace(/-/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    // First, look for year in parentheses or brackets
    const parenYearMatch = cleanName.match(/[([](19\d{2}|20\d{2})[\])]/)
    // Find ALL years in the string
    const allYears = Array.from(cleanName.matchAll(/\b(19\d{2}|20\d{2})\b/g))

    let releaseYear: number | undefined
    let yearIndex: number = -1
    let charBeforeYear: string | undefined

    if (parenYearMatch) {
      releaseYear = parseInt(parenYearMatch[1], 10)
      yearIndex = cleanName.indexOf(parenYearMatch[0])
      charBeforeYear = cleanName[yearIndex]
    } else if (allYears.length > 0) {
      if (allYears.length === 1) {
        const match = allYears[0]
        const potentialYear = parseInt(match[1], 10)
        const idx = match.index!

        const titleBefore = cleanName.slice(0, idx).trim()
        if (titleBefore.length === 0 || titleBefore.match(/^[([\s]*$/)) {
          // Year appears to be the title itself (e.g. 1917)
        } else {
          releaseYear = potentialYear
          yearIndex = idx
          charBeforeYear = cleanName[idx - 1]
        }
      } else {
        const lastMatch = allYears[allYears.length - 1]
        releaseYear = parseInt(lastMatch[1], 10)
        yearIndex = lastMatch.index!
        charBeforeYear = cleanName[yearIndex - 1]
      }
    }

    if (releaseYear !== undefined && yearIndex >= 0) {
      result.year = releaseYear

      let titleEnd = yearIndex
      if (charBeforeYear === '(' || charBeforeYear === '[') {
        titleEnd = yearIndex - 1
      }

      if (titleEnd > 0) {
        result.title = cleanName.slice(0, titleEnd).trim()
        cleanName = cleanName.slice(yearIndex + 4)
        if (cleanName.startsWith(')') || cleanName.startsWith(']')) {
          cleanName = cleanName.slice(1)
        }
      }
    }

    // Extract quality indicators from remaining string
    result.resolution = this.extractPattern(cleanName, this.resolutionPatterns)
    result.source = this.extractPattern(cleanName, this.sourcePatterns)
    result.codec = this.extractPattern(cleanName, this.videoCodecPatterns)
    result.audioCodec = this.extractPattern(cleanName, this.audioCodecPatterns)
    result.edition = this.extractPattern(cleanName, this.editionPatterns)

    // Extract release group (usually at the end after a dash)
    const groupMatch = cleanName.match(/[-\s]([A-Za-z0-9]+)$/)
    if (groupMatch && groupMatch[1].length >= 2 && groupMatch[1].length <= 15) {
      const potentialGroup = groupMatch[1]
      if (!this.isQualityIndicator(potentialGroup)) {
        result.group = potentialGroup
      }
    }

    // If no title extracted yet, use cleaned name up to first quality indicator
    if (!result.title) {
      result.title = this.extractTitleBeforeQuality(cleanName)
    }

    // Clean up title
    result.title = this.cleanTitle(result.title)

    // Build quality string
    result.quality = [result.resolution, result.source, result.codec]
      .filter(Boolean)
      .join(' ')

    return result
  }

  /**
   * Parse a TV episode filename
   */
  parseEpisode(name: string, folderContext?: string): ParsedEpisodeInfo | null {
    for (const pattern of this.tvPatterns) {
      const match = name.match(pattern)
      if (match) {
        const result: ParsedEpisodeInfo = {
          type: 'episode',
          seriesTitle: '',
          seasonNumber: parseInt(match[1], 10),
          episodeNumber: parseInt(match[2], 10),
        }

        if (match[3]) {
          result.episodeNumberEnd = parseInt(match[3], 10)
        }

        const cleanName = name
          .replace(/\./g, ' ')
          .replace(/_/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()

        const matchIndex = cleanName.search(pattern)
        if (matchIndex > 0) {
          result.seriesTitle = cleanName.slice(0, matchIndex).trim()
        }

        if (!result.seriesTitle && folderContext) {
          result.seriesTitle = this.extractSeriesTitleFromPath(folderContext)
        }

        if (result.seriesTitle) {
          const parsedSeries = this.cleanSeriesTitleAndYear(result.seriesTitle)
          result.seriesTitle = parsedSeries.title || result.seriesTitle
          if (parsedSeries.year && !result.year) {
            result.year = parsedSeries.year
          }
        }

        const afterMatch = cleanName.slice(matchIndex)
        result.resolution = this.extractPattern(afterMatch, this.resolutionPatterns)
        result.source = this.extractPattern(afterMatch, this.sourcePatterns)
        result.codec = this.extractPattern(afterMatch, this.videoCodecPatterns)
        result.audioCodec = this.extractPattern(afterMatch, this.audioCodecPatterns)

        result.quality = [result.resolution, result.source, result.codec]
          .filter(Boolean)
          .join(' ')

        const episodeTitle = this.extractEpisodeTitle(afterMatch, pattern)
        if (episodeTitle) {
          result.episodeTitle = episodeTitle
        }

        return result
      }
    }

    return null
  }

  /**
   * Parse a music filename
   */
  parseMusic(name: string, folderContext?: string): ParsedMusicInfo {
    const result: ParsedMusicInfo = {
      type: 'music',
      title: name,
    }

    if (folderContext) {
      const pathParts = folderContext.split(/[/\\]/).filter(Boolean)
      if (pathParts.length >= 2) {
        result.artist = pathParts[pathParts.length - 2]
        result.album = pathParts[pathParts.length - 1]
      } else if (pathParts.length === 1) {
        result.artist = pathParts[0]
      }
    }

    let cleanName = name
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    const trackMatch = cleanName.match(/^(\d{1,3})[\s.-]+(.+)/)
    if (trackMatch) {
      result.trackNumber = parseInt(trackMatch[1], 10)
      cleanName = trackMatch[2].trim()
    }

    const discTrackMatch = cleanName.match(/^(?:CD|Disc\s*)?(\d{1,2})[-.](\d{1,3})[\s.-]+(.+)/i)
    if (discTrackMatch) {
      result.discNumber = parseInt(discTrackMatch[1], 10)
      result.trackNumber = parseInt(discTrackMatch[2], 10)
      cleanName = discTrackMatch[3].trim()
    }

    const artistTitleMatch = cleanName.match(/^(.+?)\s*[-–—]\s*(.+)$/)
    if (artistTitleMatch) {
      if (result.artist) {
        result.title = artistTitleMatch[2].trim()
      } else {
        result.artist = artistTitleMatch[1].trim()
        result.title = artistTitleMatch[2].trim()
      }
    } else {
      result.title = cleanName
    }

    if (result.album) {
      const yearMatch = result.album.match(this.yearPattern)
      if (yearMatch) {
        result.year = parseInt(yearMatch[1], 10)
      }
    }

    return result
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Normalize a title for TMDB search
   */
  normalizeForSearch(title: string): string {
    return title
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[.'":;!?&@#$%^*()[\]{}|\\/<>~`+=]/g, ' ')
      .replace(/[-_]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  private extractPattern(text: string, patterns: [RegExp, string][]): string | undefined {
    for (const [pattern, value] of patterns) {
      if (pattern.test(text)) {
        return value
      }
    }
    return undefined
  }

  private isQualityIndicator(text: string): boolean {
    const lower = text.toLowerCase()
    const indicators = [
      'x264', 'x265', 'h264', 'h265', 'hevc', 'avc', 'av1', 'vp9',
      '1080p', '720p', '480p', '2160p', '4k', 'uhd',
      'bluray', 'webrip', 'webdl', 'hdtv', 'dvdrip',
      'dts', 'atmos', 'truehd', 'aac', 'flac',
      'remux', 'proper', 'repack'
    ]
    return indicators.some(ind => lower.includes(ind))
  }

  private extractTitleBeforeQuality(text: string): string {
    const allPatterns = [
      ...this.resolutionPatterns,
      ...this.sourcePatterns,
      ...this.videoCodecPatterns,
      ...this.audioCodecPatterns,
    ]

    let earliestIndex = text.length
    for (const [pattern] of allPatterns) {
      const match = text.match(pattern)
      if (match && match.index !== undefined && match.index < earliestIndex) {
        earliestIndex = match.index
      }
    }

    return text.slice(0, earliestIndex).trim()
  }

  /**
   * Check if a folder name is a season, specials, or extras folder
   */
  isSeasonOrExtrasFolder(folderName: string): boolean {
    if (!folderName) return false
    const name = folderName.trim()
    const seasonPatterns = [
      /^[Ss]eason\s*\d+$/i,
      /^[Ss]\d{1,2}$/i,
      /^[Ss]eason\s*\d+\s*\(?\d{4}\)?$/i,
      /^[Ss]taffel\s*\d+$/i,
      /^[Ss]eries\s*\d+$/i,
      /^[Ss]aison\s*\d+$/i,
      /^[Tt]emporada\s*\d+$/i,
      /^[Ss]pecials?$/i,
      /^[Ss]pecial$/i,
      /^[Ee]xtras?$/i,
      /^[Ff]eaturettes?$/i,
      /^[Bb]ehind\s*the\s*scenes$/i,
      /^[Dd]eleted\s*scenes$/i,
      /^[Bb]onus$/i,
      /^[Ss]0+$/i,
    ]
    return seasonPatterns.some((pat) => pat.test(name))
  }

  /**
   * Check if a filename or relative path represents extras/bonus content
   */
  isExtrasContent(filenameOrPath: string): boolean {
    if (!filenameOrPath) return false
    const lower = filenameOrPath.toLowerCase()
    if (lower.includes('sample')) return true
    const extrasPatterns = [
      /\b(featurette|featurettes)\b/i,
      /\bbehind[.\-_ ]?the[.\-_ ]?scenes?\b/i,
      /\bdeleted[.\-_ ]?scenes?\b/i,
      /\bgag[.\-_ ]?reel\b/i,
      /\bbloopers?\b/i,
      /\binterview(s|ed)?\b/i,
      /\bmaking[.\-_ ]?of\b/i,
      /\bshort[.\-_ ]?film\b/i,
      /\b(trailer|teaser)\b/i,
      /\bpromo(s)?\b/i,
      /\bcommentary\b/i,
      /\bbonus[.\-_ ]?(content|feature)?\b/i,
      /\bextras?\b/i,
      /\bbts\b/i,
      /\bouttakes?\b/i,
      /\balternate[.\-_ ]?(opening|ending|cut|version|take|scene)?\b/i,
      /\bextended[.\-_ ]?(cut|scene|version)?\b/i,
      /\b(opening|closing)[.\-_ ]?credits?\b/i,
    ]
    return extrasPatterns.some((pattern) => pattern.test(lower))
  }

  /**
   * Strip scene/release tags, resolutions, codecs, and group suffixes from a raw string or folder name
   */
  stripReleaseTags(rawText: string): string {
    if (!rawText) return ''

    let cleaned = rawText
      .replace(/\[(?:[^\]]*\b(?:1080p|720p|2160p|4k|uhd|bluray|remux|web-?dl|webrip|hdtv|dvdrip|x264|x265|h264|hevc|av1|10bit|hdr|dts|atmos|aac|flac|proper|repack)[^\]]*)\]/gi, ' ')
      .replace(/\[[A-Za-z0-9_.-]+\]$/g, '')
      .replace(/\b(?:ddp|dd|e-?ac-?3|ac-?3)\s*\d*(?:\.\d+)?\b/gi, ' ')
      .replace(/\b(?:5\.1|7\.1|2\.0|2\.1)\b/gi, ' ')
      .replace(/\./g, ' ')
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    cleaned = cleaned
      .replace(/\b(?:season\s*\d{1,2}|s\d{1,2})\b/gi, ' ')
      .replace(/\b(2160p|1080p|1080i|720p|576p|480p|4k|uhd|bluray|bdrip|brrip|remux|web-?dl|webrip|web|hdtv|pdtv|dvdrip|dvd-?r|dvd|hdcam|cam|ts|screener)\b/gi, ' ')
      .replace(/\b(x265|h\.?265|hevc|x264|h\.?264|avc|av1|vp9|vp8|xvid|divx|mpeg-?2|vc-?1|10bit|8bit|hdr10\+|hdr10|hdr|dovi|dv|sdr)\b/gi, ' ')
      .replace(/\b(atmos|truehd|dts-?hd[\s.-]?ma|dts-?hd|dts-?x|dts|dd\+|ddp|e-?ac-?3|ac-?3|aac|flac|lpcm|mp3)\b/gi, ' ')
      .replace(/\b(extended|director'?s?\s*cut|unrated|theatrical|imax|remastered|special\s*edition|ultimate\s*edition|collector'?s?\s*edition|proper|repack|multi(-?sub)?|dual(-?audio)?)\b/gi, ' ')
      .replace(/-\s*[A-Za-z0-9_]+$/g, '')

    return this.cleanTitle(cleaned)
  }

  /**
   * Clean and normalize a series title and extract year if present
   */
  cleanSeriesTitleAndYear(raw: string): { title: string; year?: number } {
    if (!raw) return { title: '', year: undefined }
    let working = raw
    let year: number | undefined

    const parenYearMatch = working.match(/[([](19\d{2}|20\d{2})[\])]/)
    if (parenYearMatch) {
      year = parseInt(parenYearMatch[1], 10)
      working = working.replace(/[([](19\d{2}|20\d{2})[\])]/, ' ')
    }

    let title = this.stripReleaseTags(working)

    if (!year) {
      const bareYearMatch = title.match(/\b(19\d{2}|20\d{2})\b/)
      if (bareYearMatch) {
        year = parseInt(bareYearMatch[1], 10)
        title = title.replace(/\b(19\d{2}|20\d{2})\b/, ' ')
      }
    }

    return {
      title: this.cleanTitle(title),
      year,
    }
  }

  /**
   * Generate canonical lowercased normalized series title slug for matching
   */
  normalizeSeriesTitle(raw: string): string {
    const { title } = this.cleanSeriesTitleAndYear(raw)
    return this.normalizeForSearch(title).toLowerCase()
  }

  extractSeriesTitleFromPath(folderPath: string): string {
    const parts = folderPath.split(/[/\\]/).filter(Boolean)
    if (parts.length === 0) return ''

    if (
      this.isVideoFile(parts[parts.length - 1]) ||
      /\.[a-z0-9]{2,4}$/i.test(parts[parts.length - 1]) ||
      /s\d+e\d+/i.test(parts[parts.length - 1])
    ) {
      parts.pop()
    }

    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i]
      if (!this.isSeasonOrExtrasFolder(part)) {
        const { title } = this.cleanSeriesTitleAndYear(part)
        if (title) return title
      }
    }

    return parts[parts.length - 1] || ''
  }

  private extractEpisodeTitle(text: string, tvPattern: RegExp): string | undefined {
    const match = text.match(tvPattern)
    if (!match || match.index === undefined) {
      return undefined
    }

    const afterMatch = text.slice(match.index + match[0].length).trim()
    if (!afterMatch) {
      return undefined
    }

    let remaining = afterMatch.replace(/^[-.\s]+/, '')

    const allQualityPatterns = [
      ...this.resolutionPatterns,
      ...this.sourcePatterns,
      ...this.videoCodecPatterns,
      ...this.audioCodecPatterns,
      ...this.editionPatterns,
    ]

    let earliestIndex = remaining.length
    for (const [pattern] of allQualityPatterns) {
      const match = remaining.match(pattern)
      if (match && match.index !== undefined && match.index < earliestIndex) {
        earliestIndex = match.index
      }
    }

    const title = remaining.slice(0, earliestIndex).trim()

    if (title && title.length > 2 && /[a-zA-Z]/.test(title)) {
      return this.cleanTitle(title)
    }

    return undefined
  }

  cleanTitle(title: string): string {
    let t = title
      .replace(/^[\s.\-_,:;!?/\\+]+/, '')
      .replace(/[\s.\-_,:;!?/\\+]+$/, '')
      .replace(/\s+/g, ' ')
      .trim()

    if (t.startsWith(')') || t.startsWith(']')) t = t.slice(1).trim()
    if (t.endsWith('(') || t.endsWith('[')) t = t.slice(0, -1).trim()
    return t
  }
}
