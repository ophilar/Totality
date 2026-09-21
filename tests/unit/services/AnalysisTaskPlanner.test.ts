import { describe, expect, it } from 'vitest'
import { planAnalysisTasks } from '@main/services/AnalysisTaskPlanner'
import { LibraryType, TaskType } from '@main/types/database'

describe('planAnalysisTasks', () => {
  it('selects only stages applicable to each library type', () => {
    const tasks = planAnalysisTasks([
      { sourceId: 'plex', libraryId: 'movies', libraryType: LibraryType.Movie },
      { sourceId: 'plex', libraryId: 'shows', libraryType: LibraryType.Show },
      { sourceId: 'plex', libraryId: 'music', libraryType: LibraryType.Music },
    ])

    expect(tasks).toEqual([
      { type: TaskType.QualityAnalysis, label: 'Analyze quality (plex)', sourceId: 'plex', libraryId: 'movies' },
      { type: TaskType.CollectionCompleteness, label: 'Analyze collections (plex)', sourceId: 'plex', libraryId: 'movies' },
      { type: TaskType.QualityAnalysis, label: 'Analyze quality (plex)', sourceId: 'plex', libraryId: 'shows' },
      { type: TaskType.SeriesCompleteness, label: 'Analyze TV completeness (plex)', sourceId: 'plex', libraryId: 'shows' },
      { type: TaskType.MusicCompleteness, label: 'Analyze music (plex)', sourceId: 'plex' },
    ])
  })

  it('plans every applicable stage for mixed libraries and one music task per source', () => {
    const tasks = planAnalysisTasks([
      { sourceId: 'local', libraryId: 'mixed', libraryType: LibraryType.Mixed },
      { sourceId: 'local', libraryId: 'music', libraryType: LibraryType.Music },
    ])

    expect(tasks.map(task => task.type)).toEqual([
      TaskType.QualityAnalysis,
      TaskType.SeriesCompleteness,
      TaskType.CollectionCompleteness,
      TaskType.MusicCompleteness,
    ])
    expect(tasks.filter(task => task.type === TaskType.MusicCompleteness)).toHaveLength(1)
  })

  it('does not create tasks for an empty scope', () => {
    expect(planAnalysisTasks([])).toEqual([])
  })
})
