export type SortDirection = 'asc' | 'desc'

export const descendingSortColumns = new Set(['efficiency', 'waste', 'storage_debt', 'recoverable', 'size'])

export function nextSortDirection(
  currentColumn: string,
  nextColumn: string,
  currentDirection: SortDirection
): SortDirection {
  if (currentColumn === nextColumn) return currentDirection === 'asc' ? 'desc' : 'asc'
  return descendingSortColumns.has(nextColumn) ? 'desc' : 'asc'
}

export const movieSortColumns = ['title', 'year', 'efficiency', 'waste', 'size'] as const
export const tvSortColumns = ['title', 'recoverable', 'efficiency'] as const
export const mediaSortColumns = ['title', 'efficiency', 'waste', 'size'] as const
