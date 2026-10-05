export function parseFfmpegFilterNames(listing: string): string[] {
  return Array.from(listing.matchAll(/^[ \t]?([TSC. ]{3})[ \t]+([a-z0-9_]+)\b/gim), match => match[2])
}

export function requireFfmpegFilters(listing: string, requiredFilters: readonly string[]): void {
  const available = new Set(parseFfmpegFilterNames(listing))
  const missing = requiredFilters.filter(filter => !available.has(filter))
  if (missing.length) {
    throw new Error(`FFmpeg is missing required filter${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}. Install an FFmpeg build that provides these filters.`)
  }
}
