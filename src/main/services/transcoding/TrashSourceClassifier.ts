export type MediaSourceTier = 'Remux' | 'BluRay' | 'WEB-DL' | 'WEBRip' | 'HDTV' | 'SDTV' | 'Unknown'

const PATTERNS = {
  remux: /\b(remux|bdremux|uhd[-._ ]?remux)\b/i,
  webrip: /\b(webrip|web-rip)\b/i,
  webdl: /\b(web-dl|webdl|web|amzn|nf|dsnp|atvp|hmax|itunes|max|disney)\b/i,
  bluray: /\b(bluray|blu-ray|bdrip|brrip|bdr)\b/i,
  hdtv: /\b(hdtv|pdtv|dsr)\b/i,
  sdtv: /\b(dvd|dvdrip|sdtv)\b/i
}

const LEGACY_HIGH_BITRATE_CODECS = /^(h\.?264|x264|avc1?|vc-?1|mpeg-?2(video)?)$/i

export class TrashSourceClassifier {
  /**
   * Classifies a media file into a standardized TRaSH Guides media source tier.
   * Priority: Filename release tags -> Stream characteristics heuristic fallback -> Unknown
   */
  static classify(filePath: string, videoBitrateKbps?: number, codec?: string): MediaSourceTier {
    if (filePath) {
      // Normalize delimiters (e.g. underscores to spaces) for reliable word-boundary matching
      const normalizedPath = filePath.replace(/[._]/g, ' ')
      const targets = [filePath, normalizedPath]

      for (const target of targets) {
        if (PATTERNS.remux.test(target)) {
          return 'Remux'
        }
      }

      for (const target of targets) {
        if (PATTERNS.webrip.test(target)) {
          return 'WEBRip'
        }
      }

      for (const target of targets) {
        if (PATTERNS.webdl.test(target)) {
          return 'WEB-DL'
        }
      }

      for (const target of targets) {
        if (PATTERNS.bluray.test(target)) {
          return 'BluRay'
        }
      }

      for (const target of targets) {
        if (PATTERNS.hdtv.test(target)) {
          return 'HDTV'
        }
      }

      for (const target of targets) {
        if (PATTERNS.sdtv.test(target)) {
          return 'SDTV'
        }
      }
    }

    // Stream characteristics fallback heuristic
    if (videoBitrateKbps && videoBitrateKbps > 0) {
      const normalizedCodec = codec?.trim() || ''
      if (videoBitrateKbps > 25000 && LEGACY_HIGH_BITRATE_CODECS.test(normalizedCodec)) {
        return 'Remux'
      }

      if (videoBitrateKbps > 14000) {
        return 'BluRay'
      }

      return 'WEB-DL'
    }

    return 'Unknown'
  }
}
