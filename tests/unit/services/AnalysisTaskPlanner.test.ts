import { describe, expect, it } from 'vitest'
import { planAnalysisStages } from '@main/services/AnalysisTaskPlanner'
import type { AnalysisScope } from '@shared/analysisScope'
import { LibraryType } from '@main/types/database'

describe('planAnalysisStages', () => {
  it('selects ordered stages for each scoped request', () => {
    const cases: Array<[AnalysisScope, string[]]> = [
      [{ kind: 'item', mediaId: 3 }, ['quality']],
      [{ kind: 'show', sourceId: 's', libraryId: 'tv', title: 'Show', seriesIdentityKey: 'id:1' }, ['quality', 'series-completeness']],
      [{ kind: 'collection', collectionId: 5 }, ['quality', 'collection-completeness']],
      [{ kind: 'album', albumId: 7 }, ['music-quality', 'music-completeness']],
      [{ kind: 'artist', artistId: 9 }, ['music-quality', 'artist-completeness', 'owned-album-completeness']],
    ]
    for (const [scope, expected] of cases) expect(planAnalysisStages(scope).map(stage => stage.name)).toEqual(expected)
  })

  it('selects source and library scoped quality and completeness stages for mixed and all-library work', () => {
    const stages = planAnalysisStages({ kind: 'all-libraries' }, [
      { sourceId: 'one', libraryId: 'mixed', libraryType: LibraryType.Mixed },
      { sourceId: 'two', libraryId: 'music', libraryType: LibraryType.Music },
    ])
    expect(stages.map(stage => [stage.name, stage.sourceId, stage.libraryId])).toEqual([
      ['quality', 'one', 'mixed'], ['series-completeness', 'one', 'mixed'], ['collection-completeness', 'one', 'mixed'], ['music-quality', 'one', 'mixed'], ['music-completeness', 'one', 'mixed'],
      ['music-quality', 'two', 'music'], ['music-completeness', 'two', 'music'],
    ])
  })
})
