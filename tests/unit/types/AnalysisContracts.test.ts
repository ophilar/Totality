import { describe, it, expect } from 'vitest'
import type { AnalysisStatus, AnalysisDiagnostic, AnalysisOutcome } from '@main/types/database'

describe('Analysis Contracts', () => {
  it('constructs a valid AnalysisDiagnostic record', () => {
    const diagnostic: AnalysisDiagnostic = {
      itemType: 'artist',
      itemId: 123,
      itemName: 'Radiohead',
      category: 'provider',
      code: 'RATE_LIMITED_503',
      message: 'MusicBrainz returned 503 Service Unavailable',
      cause: 'HTTP 503 from https://musicbrainz.org/ws/2/artist',
      provider: 'musicbrainz',
      identifier: '10ad886a-ca4c-49dc-8a9d-e747d3fc2331',
      retryable: true,
    }

    expect(diagnostic.itemType).toBe('artist')
    expect(diagnostic.category).toBe('provider')
    expect(diagnostic.code).toBe('RATE_LIMITED_503')
    expect(diagnostic.retryable).toBe(true)
  })

  it('constructs a valid AnalysisOutcome record', () => {
    const outcome: AnalysisOutcome = {
      status: 'partial',
      completedCount: 10,
      deferredCount: 5,
      failedCount: 1,
      diagnostics: [
        {
          itemType: 'series',
          itemName: 'Game of Thrones',
          category: 'identity',
          code: 'LOCKED_CONFLICT',
          message: 'Series identity 999999 is locked by user and cannot be cleared',
          provider: 'tmdb',
          identifier: '999999',
          retryable: false,
        },
      ],
    }

    expect(outcome.status).toBe('partial')
    expect(outcome.completedCount).toBe(10)
    expect(outcome.deferredCount).toBe(5)
    expect(outcome.failedCount).toBe(1)
    expect(outcome.diagnostics).toHaveLength(1)
  })
})
