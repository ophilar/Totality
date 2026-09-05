export type SortDirection = 'asc' | 'desc'
export type LibrarySortType = 'movie' | 'tv' | 'music'
export interface SortOption { key: string; label: string }

export const descendingSortColumns = new Set([
  'efficiency',
  'efficiency_score',
  'weighted_efficiency',
  'waste',
  'storage_debt',
  'storage_debt_bytes',
  'recoverable',
  'recoverable_waste_bytes',
  'size',
  'completeness'
])

export function nextSortDirection(
  currentColumn: string,
  nextColumn: string,
  currentDirection: SortDirection
): SortDirection {
  if (currentColumn === nextColumn) return currentDirection === 'asc' ? 'desc' : 'asc'
  return descendingSortColumns.has(nextColumn) ? 'desc' : 'asc'
}

export const movieSortColumns = ['title', 'year', 'efficiency', 'recoverable', 'size'] as const
export const tvSortColumns = ['title', 'recoverable', 'weighted_efficiency'] as const
export const mediaSortColumns = ['title', 'efficiency', 'recoverable', 'size'] as const

export const musicSortColumns = ['title', 'artist', 'album', 'year', 'size', 'quality'] as const

const sortOptions: Record<LibrarySortType, SortOption[]> = {
  movie: [
    { key: 'title', label: 'Title' },
    { key: 'year', label: 'Year' },
    { key: 'efficiency', label: 'Efficiency' },
    { key: 'recoverable', label: 'Recoverable' },
    { key: 'size', label: 'Size' },
  ],
  tv: [
    { key: 'title', label: 'Title' },
    { key: 'recoverable', label: 'Recoverable' },
    { key: 'weighted_efficiency', label: 'Weighted efficiency' },
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
