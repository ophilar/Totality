import { describe, expect, it } from 'vitest'
import { selectAutomaticMatch } from '@main/services/metadata/MetadataMatchingService'

describe('selectAutomaticMatch', () => {
  it('accepts only one exact normalized title and year match', () => {
    const result = selectAutomaticMatch([
      { id: '1', title: 'The Office', type: 'tv', year: 2005 },
      { id: '2', title: 'The Office', type: 'tv', year: 2024 },
    ], { title: 'Office', year: 2005, type: 'tv' })

    expect(result?.id).toBe('1')
  })

  it('leaves ambiguous title-only candidates for review', () => {
    const result = selectAutomaticMatch([
      { id: '1', title: 'Dune', type: 'movie', year: 1984 },
      { id: '2', title: 'Dune', type: 'movie', year: 2021 },
    ], { title: 'Dune', type: 'movie' })

    expect(result).toBeNull()
  })
})
