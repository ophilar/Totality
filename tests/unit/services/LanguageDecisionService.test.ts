import { describe, expect, it } from 'vitest'
import { LanguageDecisionService } from '@main/services/LanguageDecisionService'

describe('LanguageDecisionService', () => {
  const service = new LanguageDecisionService()
  it('removes only non-original dubs when evidence agrees', () => {
    const result = service.decide('en', [
      { index: 1, language: 'eng', reliableTag: true },
      { index: 2, language: 'deu', reliableTag: true },
      { index: 3, language: 'deu', title: 'Commentary', reliableTag: true }
    ])
    expect(result.status).toBe('approved')
    expect(result.retainedTrackIndexes).toEqual([1, 3])
    expect(result.removableTrackIndexes).toEqual([2])
  })
  it('requires review for unknown or conflicting evidence', () => {
    expect(service.decide(undefined, [{ index: 1, language: 'eng', reliableTag: true }]).status).toBe('review-required')
    expect(service.decide('en', [{ index: 1, language: 'deu', reliableTag: true }], false).reviewRequiredTrackIndexes).toEqual([1])
  })
})
