import { describe, expect, it } from 'vitest'
import { nextSortDirection } from '@/components/library/sortDefinitions'

describe('library sort definitions', () => {
  it('toggles direction for the active column', () => {
    expect(nextSortDirection('title', 'title', 'asc')).toBe('desc')
    expect(nextSortDirection('title', 'title', 'desc')).toBe('asc')
  })

  it('uses descending defaults for quality/cost columns', () => {
    expect(nextSortDirection('title', 'efficiency', 'asc')).toBe('desc')
    expect(nextSortDirection('title', 'waste', 'asc')).toBe('desc')
  })
})
