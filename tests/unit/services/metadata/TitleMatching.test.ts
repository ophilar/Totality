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

  it('preserves standalone 4-digit numeric titles like 1984, 2001, and 1917', () => {
    expect(normalizeTitleForMatching('1984')).toBe('1984')
    expect(normalizeTitleForMatching('2001: A Space Odyssey')).toBe('2001 space odyssey')
    expect(normalizeTitleForMatching('1917')).toBe('1917')
    expect(normalizeTitleForMatching('300')).toBe('300')
  })

  it('calculates full exact match score for numeric titles', () => {
    const score = scoreTitleMatch('1984', '1984', 1984, 1984)
    expect(score).toBeGreaterThanOrEqual(90)
  })

  it('strips 4-digit release years when alphabetical title tokens are present', () => {
    expect(normalizeTitleForMatching('Inception 2010')).toBe('inception')
    expect(normalizeTitleForMatching('The Matrix 1999')).toBe('matrix')
  })
})

