const NON_TITLE_TOKENS = new Set([
  '2160p', '1080p', '720p', '576p', '480p', '4k', 'uhd', 'sd',
  'bluray', 'brrip', 'webrip', 'webdl', 'web', 'hdtv', 'dvdrip', 'remux',
  'x264', 'x265', 'h264', 'h265', 'hevc', 'av1', 'vp9', 'avc',
  'aac', 'ac3', 'dts', 'truehd', 'atmos', 'flac', 'hdr', 'hdr10', 'dv',
  'proper', 'repack', 'limited', 'internal', 'extended', 'unrated', 'directors',
  'cut', 'remastered', 'criterion', 'multi', 'subbed', 'dubbed', 'complete',
  'edition', 'special', 'theatrical', 'readnfo', 'sample'
])

const ARTICLE_TOKENS = new Set(['a', 'an', 'the'])

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const above = row[j]
      row[j] = a[i - 1] === b[j - 1]
        ? diagonal
        : Math.min(row[j] + 1, row[j - 1] + 1, diagonal + 1)
      diagonal = above
    }
  }
  return row[b.length]
}

export function normalizeTitleForMatching(title: string): string {
  const tokens = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[._:;!?&@#$%^*()[\]{}|\\/<>~`+=-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(token => !/^\d{4}$/.test(token))
    .filter(token => !NON_TITLE_TOKENS.has(token))
    .filter(token => !ARTICLE_TOKENS.has(token))

  return tokens.join(' ').trim()
}

export function scoreTitleMatch(
  candidateTitle: string,
  targetTitle: string,
  candidateYear?: number,
  targetYear?: number
): number {
  const candidate = normalizeTitleForMatching(candidateTitle)
  const target = normalizeTitleForMatching(targetTitle)
  if (!candidate || !target) return 0

  let score = 0
  if (candidate === target) score += 70
  else if (candidate.includes(target) || target.includes(candidate)) score += 35

  const candidateTokens = new Set(candidate.split(' '))
  const targetTokens = new Set(target.split(' '))
  const overlap = [...targetTokens].filter(token => candidateTokens.has(token)).length
  score += targetTokens.size ? Math.round((overlap / targetTokens.size) * 25) : 0

  // Give short, one-character typos a useful signal without making unrelated
  // titles competitive. Apply this only to equal-length tokens.
  const fuzzyOverlap = [...targetTokens].filter(token =>
    token.length >= 4 && [...candidateTokens].some(candidate =>
      candidate.length === token.length && levenshtein(candidate, token) === 1
    )
  ).length
  score += targetTokens.size ? Math.round((fuzzyOverlap / targetTokens.size) * 12) : 0

  if (targetYear && candidateYear) {
    if (targetYear === candidateYear) score += 20
    else if (Math.abs(targetYear - candidateYear) === 1) score += 8
  }

  return score
}
