import { describe, expect, it } from 'vitest'
import { LanguageDecisionService } from '@main/services/LanguageDecisionService'
import { formatLanguage, isSameLanguage, normalizeLanguage } from '@main/constants/languages'

describe('LanguageDecisionService', () => {
  const service = new LanguageDecisionService()

  it('removes only non-original dubs when reliable language tags agree', () => {
    const result = service.decide('ja', [
      { index: 1, language: 'jpn', reliableTag: true },
      { index: 2, language: 'eng', reliableTag: true },
      { index: 3, language: 'eng', title: 'Commentary', reliableTag: true },
    ])
    expect(result.status).toBe('approved')
    expect(result.retainedTrackIndexes).toEqual([1, 3])
    expect(result.removableTrackIndexes).toEqual([2])
  })

  it.each([
    ['עברית', 'heb', 'he'],
    ['日本語', 'jpn', 'ja'],
    ['français', 'fra', 'fr'],
    ['Deutsch', 'deu', 'de'],
    ['العربية', 'ara', 'ar'],
    ['русский', 'rus', 'ru'],
    ['한국어', 'kor', 'ko'],
    ['中文', 'zho', 'zh'],
    ['Español', 'spa', 'es'],
    ['isiZulu', 'zul', 'zu'],
  ])('recognizes native metadata %s as %s', (nativeName, isoCode, expected) => {
    expect(normalizeLanguage(nativeName)).toBe(expected)
    expect(normalizeLanguage(isoCode)).toBe(expected)
    expect(isSameLanguage(nativeName, isoCode)).toBe(true)
    expect(formatLanguage(nativeName)).not.toBe(nativeName)
    const decision = service.decide(nativeName, [
      { index: 1, language: isoCode, reliableTag: true },
      { index: 2, language: 'eng', reliableTag: true },
    ])
    expect(decision.retainedTrackIndexes).toContain(1)
    if (expected !== 'en') expect(decision.removableTrackIndexes).toContain(2)
  })

  it.each([
    ['אנגלית', 'en'],
    ['צרפתית', 'fr'],
    ['Hébreu', 'he'],
    ['ヘブライ語', 'he'],
    ['中文', 'zh'],
  ])('resolves language names translated into another language: %s', (label, expected) => {
    expect(normalizeLanguage(label)).toBe(expected)
    expect(isSameLanguage(label, expected)).toBe(true)
  })

  it('uses existing Intl language equivalence for ISO codes not in the short alias map', () => {
    const decision = service.decide('af', [
      { index: 2, language: 'afr', reliableTag: true },
      { index: 3, language: 'zul', reliableTag: true },
    ])
    expect(decision.status).toBe('approved')
    expect(decision.retainedTrackIndexes).toEqual([2])
    expect(decision.removableTrackIndexes).toEqual([3])
  })

  it('reports known Japanese stream metadata without inventing the original language', () => {
    const result = service.decide(null, [
      { index: 1, language: 'jpn', reliableTag: true },
      { index: 2, language: 'eng', reliableTag: true },
    ])
    expect(result.status).toBe('review-required')
    expect(result.reason).toContain('Japanese (stream 1)')
    expect(result.reason).toContain('English (stream 2)')
    expect(result.evidenceSources).toContain('embedded-audio-tag:1')
    expect(result.removableTrackIndexes).toEqual([])
  })

  it('protects the complete soundtrack if no primary stream matches original-language metadata', () => {
    const result = service.decide('en', [{ index: 1, language: 'jpn', reliableTag: true }])
    expect(result.status).toBe('review-required')
    expect(result.removableTrackIndexes).toEqual([])
    expect(result.reviewRequiredTrackIndexes).toEqual([1])
  })

  it('preserves object-audio as the primary original-language stream', () => {
    const result = service.decide('ja', [
      { index: 1, language: 'jpn', reliableTag: true, hasObjectAudio: true },
      { index: 2, language: 'eng', reliableTag: true },
    ])
    expect(result.retainedTrackIndexes).toEqual([1])
    expect(result.removableTrackIndexes).toEqual([2])
  })

  it('treats undetermined tags and untagged tracks as unknown', () => {
    const result = service.decide('ja', [
      { index: 1, language: 'jpn', reliableTag: true },
      { index: 2, language: 'und', reliableTag: true },
    ])
    expect(result.reviewRequiredTrackIndexes).toEqual([2])
    expect(result.removableTrackIndexes).toEqual([])
  })

  it('does not infer language from an audio track title', () => {
    const result = service.decide('ja', [
      { index: 1, language: 'jpn', reliableTag: true },
      { index: 2, title: 'English DTS 5.1', reliableTag: false },
    ])
    expect(result.reviewRequiredTrackIndexes).toEqual([2])
    expect(result.removableTrackIndexes).toEqual([])
  })

  it('requires review for explicitly conflicting evidence', () => {
    expect(service.decide('ja', [
      { index: 1, language: 'jpn', reliableTag: true },
      { index: 2, language: 'eng', reliableTag: true },
    ], false).reviewRequiredTrackIndexes).toEqual([1, 2])
  })
})
