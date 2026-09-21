import { LibraryType, TaskType } from '@main/types/database'

export interface AnalysisLibraryScope {
  sourceId: string
  libraryId: string
  libraryType: LibraryType
}

export interface AnalysisTaskDefinition {
  type: TaskType
  label: string
  sourceId: string
  libraryId?: string
}

export function planAnalysisTasks(libraries: AnalysisLibraryScope[]): AnalysisTaskDefinition[] {
  const tasks: AnalysisTaskDefinition[] = []
  const musicSources = new Set<string>()

  for (const library of libraries) {
    const { sourceId, libraryId, libraryType } = library
    if (libraryType !== LibraryType.Music) {
      tasks.push({ type: TaskType.QualityAnalysis, label: `Analyze quality (${sourceId})`, sourceId, libraryId })
    }
    if (libraryType === LibraryType.Show || libraryType === LibraryType.Mixed) {
      tasks.push({ type: TaskType.SeriesCompleteness, label: `Analyze TV completeness (${sourceId})`, sourceId, libraryId })
    }
    if (libraryType === LibraryType.Movie || libraryType === LibraryType.Mixed) {
      tasks.push({ type: TaskType.CollectionCompleteness, label: `Analyze collections (${sourceId})`, sourceId, libraryId })
    }
    if (libraryType === LibraryType.Music || libraryType === LibraryType.Mixed) {
      musicSources.add(sourceId)
    }
  }

  for (const sourceId of musicSources) {
    tasks.push({ type: TaskType.MusicCompleteness, label: `Analyze music (${sourceId})`, sourceId })
  }

  return tasks
}
