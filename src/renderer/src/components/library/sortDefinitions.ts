export type SortDirection = 'asc' | 'desc'
export type LibrarySortType = 'movie' | 'tv' | 'music'
export interface SortOption { key: string; label: string }

export const descendingSortColumns = new Set(['efficiency', 'weighted_efficiency', 'waste', 'storage_debt', 'recoverable', 'size'])

export function nextSortDirection(
  currentColumn: string,
  nextColumn: string,
  currentDirection: SortDirection
): SortDirection {
  if (currentColumn === nextColumn) return currentDirection === 'asc' ? 'desc' : 'asc'
  return descendingSortColumns.has(nextColumn) ? 'desc' : 'asc'
}

export const movieSortColumns = ['title', 'year', 'efficiency', 'waste', 'size'] as const
export const tvSortColumns = ['title', 'recoverable', 'weighted_efficiency'] as const
export const mediaSortColumns = ['title', 'efficiency', 'waste', 'size'] as const

const sortOptions: Record<LibrarySortType, SortOption[]> = {
  movie: movieSortColumns.map(key => ({ key, label: key === 'efficiency' ? 'Efficiency' : key[0].toUpperCase() + key.slice(1) })),
  tv: [
    { key: 'title', label: 'Title' },
    { key: 'recoverable', label: 'Recoverable' },
    { key: 'weighted_efficiency', label: 'Weighted efficiency' },
  ],
  music: mediaSortColumns.map(key => ({ key, label: key[0].toUpperCase() + key.slice(1) })),
}

export function getSortOptions(type: LibrarySortType): SortOption[] {
  return sortOptions[type]
}

export function getSortLabel(type: LibrarySortType, key: string): string {
  return getSortOptions(type).find(option => option.key === key)?.label ?? key
}
