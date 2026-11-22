import type {
  AnalysisDiagnostic,
  AnalysisOutcome,
  AnalysisStatus,
  TaskStatus as DatabaseTaskStatus,
  TaskType as DatabaseTaskType,
} from './database'

export type TaskType = `${DatabaseTaskType}`

export type TaskStatus = `${DatabaseTaskStatus}` | 'interrupted'

export interface TaskProgress {
  current: number
  total: number
  percentage?: number
  phase: string
  currentItem?: string
  fps?: number
  eta?: string
  speed?: string
}

export interface TaskResult {
  itemsScanned?: number
  itemsAdded?: number
  itemsUpdated?: number
  itemsRemoved?: number
  status?: AnalysisStatus
  completedCount?: number
  failedCount?: number
  errors?: string[]
  deferredCount?: number
  skippedCount?: number
  reconciliation?: { merged: number; removed: number; preservedLocked: number; ambiguous: number }
  databaseBackupPath?: string
  deferred?: number
  diagnostics?: AnalysisDiagnostic[]
  outcome?: AnalysisOutcome
  isFirstScan?: boolean
  encodedReductionBytes?: number
  outputBytes?: number
  retainedOriginalBytes?: number
  physicallyReclaimedBytes?: number
  qualityVerification?: { vmafMean: number; vmafP5: number; cambiMean: number; sampleCount: number; frameCount: number }
  [key: string]: unknown
}

export interface QueuedTask {
  id: string
  type: TaskType
  label: string
  sourceId?: string
  libraryId?: string
  artistId?: number
  albumId?: number
  mediaItemId?: number
  collectionId?: number
  batchId?: string
  seriesTitle?: string
  seriesIdentityKey?: string
  inputFingerprint?: string
  options?: unknown
  status: TaskStatus
  progress?: TaskProgress
  createdAt: string
  startedAt?: string
  completedAt?: string
  error?: string
  result?: TaskResult
}

export interface TaskDefinition {
  type: TaskType
  label: string
  sourceId?: string
  libraryId?: string
  artistId?: number
  mediaItemId?: number
  batchId?: string
  options?: unknown
}

export interface MediaAnalysisOptions {
  completedMediaItemIds: number[]
}

export interface QueueState {
  currentTask: QueuedTask | null
  queue: QueuedTask[]
  isPaused: boolean
  completedTasks: QueuedTask[]
}

export type TaskQueueState = QueueState

export interface ActivityLogEntry {
  id: string
  timestamp: string
  type: 'task-complete' | 'task-partial' | 'task-failed' | 'task-cancelled' | 'task-interrupted' | 'monitoring'
  message: string
  taskId?: string
  taskType?: TaskType
}

export interface TaskQueueHistory {
  taskHistory: ActivityLogEntry[]
  monitoringHistory: ActivityLogEntry[]
}
