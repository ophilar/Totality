import { describe, expect, it } from 'vitest'
import { getSortOptions, nextSortDirection } from '@/components/library/sortDefinitions'
import { dashboardSortOptions } from '@/components/dashboard/sortDefinitions'

describe('library sort definitions', () => {
  it('toggles direction for the active column', () => {
    expect(nextSortDirection('title', 'title', 'asc')).toBe('desc')
    expect(nextSortDirection('title', 'title', 'desc')).toBe('asc')
  })

  it('uses descending defaults for quality/cost columns', () => {
    expect(nextSortDirection('title', 'efficiency', 'asc')).toBe('desc')
    expect(nextSortDirection('title', 'waste', 'asc')).toBe('desc')
    expect(nextSortDirection('title', 'recoverable', 'asc')).toBe('desc')
  })

  it('uses the aggregate weighted efficiency key for TV sorting', () => {
    expect(getSortOptions('tv')).toEqual([
      { key: 'title', label: 'Title' },
      { key: 'recoverable', label: 'Recoverable' },
      { key: 'weighted_efficiency', label: 'Weighted efficiency' },
    ])
  })

  it('defines dashboard options once per dashboard column', () => {
    expect(dashboardSortOptions.collections.map(option => option.key)).toEqual(['completeness', 'name', 'recent'])
    expect(dashboardSortOptions.series.map(option => option.key)).toEqual(['completeness', 'name', 'recent'])
    expect(dashboardSortOptions.artists.map(option => option.key)).toEqual(['completeness', 'name'])
  })
})
