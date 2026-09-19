/** The only user-facing analysis scopes. Backend task types stay internal. */
export type AnalysisScope =
  | { kind: 'all-libraries' }
  | { kind: 'library'; libraryId: string }
  | { kind: 'collection'; collectionId: string }
  | { kind: 'show'; showId: string }
  | { kind: 'album'; albumId: string }
  | { kind: 'item'; mediaId: number }

export type AnalysisStage = 'media' | 'quality' | 'playback' | 'provider' | 'tv-completeness' | 'collection-completeness' | 'music-completeness'

export type AnalysisFinding = {
  stage: AnalysisStage
  code: string
  severity: 'info' | 'warning' | 'error'
  message: string
}

export type AnalysisAction = {
  id: 'optimize' | 'fix-match'
  label: string
}

export type AnalysisStageError = {
  stage: AnalysisStage
  message: string
}

export type AnalysisResult = {
  scope: AnalysisScope
  completedStages: AnalysisStage[]
  findings: AnalysisFinding[]
  actions: AnalysisAction[]
  errors: AnalysisStageError[]
  queuedTaskIds?: string[]
}

export function analysisScopeLabel(scope: AnalysisScope): string {
  switch (scope.kind) {
    case 'all-libraries': return 'Analyze all libraries'
    case 'library': return 'Analyze library'
    case 'collection': return 'Analyze collection'
    case 'show': return 'Analyze show'
    case 'album': return 'Analyze album'
    case 'item': return 'Analyze item'
  }
}
