import type { MediaItemSortField, TVShowSortField } from '../../../../shared/librarySortFields'

export type SortDirection = 'asc' | 'desc'

const sortOptions = {
  title: { key: 'title', label: 'Title' },
  year: { key: 'year', label: 'Year' },
  tmdb_rating: { key: 'tmdb_rating', label: 'Rating' },
  play_count: { key: 'play_count', label: 'Most Watched' },
  last_watched_at: { key: 'last_watched_at', label: 'Recently Watched' },
  estimated_savings_bytes: { key: 'estimated_savings_bytes', label: 'Est. Savings' },
  total_size_bytes: { key: 'total_size_bytes', label: 'Total Size' },
} as const

const movieSortKeys = ['title', 'year', 'tmdb_rating', 'play_count', 'last_watched_at', 'estimated_savings_bytes', 'total_size_bytes'] as const satisfies readonly MediaItemSortField[]
const tvSortKeys = ['title', 'play_count', 'last_watched_at', 'estimated_savings_bytes', 'total_size_bytes'] as const satisfies readonly TVShowSortField[]

export const movieSortOptions = movieSortKeys.map(key => sortOptions[key])
export const tvSortOptions = tvSortKeys.map(key => sortOptions[key])

export type MovieSortBy = typeof movieSortKeys[number]
export type TVShowSortBy = typeof tvSortKeys[number]

const sortDirections: Record<MovieSortBy | TVShowSortBy, SortDirection> = {
  title: 'asc',
  year: 'asc',
  tmdb_rating: 'desc',
  play_count: 'desc',
  last_watched_at: 'desc',
  estimated_savings_bytes: 'desc',
  total_size_bytes: 'desc',
}

export function getSortDirection(sortBy: MovieSortBy | TVShowSortBy): SortDirection {
  return sortDirections[sortBy]
}
