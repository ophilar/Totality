
export type MediaSourceTier = 'Remux' | 'BluRay' | 'WEB-DL' | 'WEBRip' | 'HDTV' | 'SDTV' | 'Unknown'

const PATTERNS = {
  remux: /\b(remux|bdremux|uhd[-._ ]?remux)\b/i,
  webrip: /\b(webrip|web-rip)\b/i,
  webdl: /\b(web-dl|webdl|web|amzn|nf|dsnp|atvp|hmax|itunes|max|disney)\b/i,
  bluray: /\b(bluray|blu-ray|bdrip|brrip|bdr)\b/i,
  hdtv: /\b(hdtv|pdtv|dsr)\b/i,
  sdtv: /\b(dvd|dvdrip|sdtv)\b/i
}

export class TrashSourceClassifier {
  /**
   * Classifies a media file into a standardized TRaSH Guides media source tier.
   * Classifies explicit release tags in the media filename; stream bitrate cannot establish source provenance.
   */
  static classify(filePath: string | null | undefined): MediaSourceTier {
    if (filePath) {
      const fileName = filePath.split(/[\\/]/).pop() ?? filePath
      const normalizedName = fileName.replace(/[._]/g, ' ')
      const targets = [fileName, normalizedName]

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

    return 'Unknown'
  }
}
