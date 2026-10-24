export const MEDIA_ITEM_SORT_FIELDS = [
  'title',
  'year',
  'updated_at',
  'created_at',
  'overall_score',
  'play_count',
  'last_watched_at',
  'tmdb_rating',
  'estimated_savings_bytes',
] as const

export type MediaItemSortField = typeof MEDIA_ITEM_SORT_FIELDS[number]

export const TV_SHOW_SORT_FIELDS = [
  'title',
  'episode_count',
  'season_count',
  'play_count',
  'last_watched_at',
  'estimated_savings_bytes',
] as const

export type TVShowSortField = typeof TV_SHOW_SORT_FIELDS[number]
