import { describe, expect, it } from 'vitest'
import { normalizeTitleForMatching, scoreTitleMatch } from '../../../../src/main/services/metadata/TitleMatching'

describe('TitleMatching', () => {
  it('normalizes release metadata without changing meaningful title tokens', () => {
    expect(normalizeTitleForMatching('The.Matrix.1999.2160p.UHD.BluRay.x265')).toBe('matrix')
    expect(normalizeTitleForMatching('Pokémon: Detective Pikachu')).toBe('pokemon detective pikachu')
  })

  it('scores a normalized title match above a merely containing title', () => {
    const exact = scoreTitleMatch('The.Matrix.1999', 'The Matrix', 1999)
    const containing = scoreTitleMatch('Matrix Reloaded', 'The Matrix', 1999)

    expect(exact).toBeGreaterThan(containing)
    expect(exact).toBeGreaterThanOrEqual(80)
  })

  it('gives a close year match credit without treating it as exact', () => {
    const exactYear = scoreTitleMatch('The Matrix', 'The Matrix', 1999, 1999)
    const closeYear = scoreTitleMatch('The Matrix', 'The Matrix', 2000, 1999)

    expect(exactYear).toBeGreaterThan(closeYear)
    expect(closeYear).toBeGreaterThan(0)
  })

  it('gives a small typo a positive fuzzy score without equating unrelated titles', () => {
    expect(scoreTitleMatch('Spidre-Man', 'Spider-Man')).toBeGreaterThan(scoreTitleMatch('Batman', 'Spider-Man'))
  })
})
