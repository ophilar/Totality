export type SortDirection = 'asc' | 'desc'
export type LibrarySortType = 'movie' | 'tv' | 'music'
export interface SortOption { key: string; label: string }

export const descendingSortColumns = new Set([
  'size',
  'completeness',
  'play_count',
  'last_watched_at',
  'tmdb_rating',
  'estimated_savings_bytes',
])

export function nextSortDirection(
  currentColumn: string,
  nextColumn: string,
  currentDirection: SortDirection
): SortDirection {
  if (currentColumn === nextColumn) return currentDirection === 'asc' ? 'desc' : 'asc'
  return descendingSortColumns.has(nextColumn) ? 'desc' : 'asc'
}

export const movieSortColumns = ['title', 'year', 'size'] as const
export const tvSortColumns = ['title'] as const
export const mediaSortColumns = ['title', 'size'] as const

export const musicSortColumns = ['title', 'artist', 'album', 'year', 'size', 'quality'] as const

const sortOptions: Record<LibrarySortType, SortOption[]> = {
  movie: [
    { key: 'title', label: 'Title' },
    { key: 'year', label: 'Year' },
    { key: 'size', label: 'Size' },
  ],
  tv: [
    { key: 'title', label: 'Title' },
  ],
  music: [
    { key: 'title', label: 'Title' },
    { key: 'artist', label: 'Artist' },
    { key: 'album', label: 'Album' },
    { key: 'year', label: 'Year' },
    { key: 'size', label: 'Size' },
    { key: 'quality', label: 'Quality' },
  ],
}

export function getSortOptions(type: LibrarySortType): SortOption[] {
  return sortOptions[type]
}

export function normalizeSortForType(
  type: LibrarySortType,
  sortBy: string | undefined,
  sortOrder: SortDirection | undefined
): { sortBy: string; sortOrder: SortDirection } {
  const supported = sortBy != null && getSortOptions(type).some(option => option.key === sortBy)
  if (!supported) return { sortBy: 'title', sortOrder: 'asc' }
  return { sortBy: sortBy!, sortOrder: sortOrder ?? (descendingSortColumns.has(sortBy!) ? 'desc' : 'asc') }
}

export function getSortLabel(type: LibrarySortType, key: string): string {
  if (key === 'track_count' || key === 'trackCount') return 'Track Count'
  return getSortOptions(type).find(option => option.key === key)?.label ?? key
}
