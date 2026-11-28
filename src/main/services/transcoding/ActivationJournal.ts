import type { MediaRemuxJob } from '../../database/repositories/MediaRemuxJobRepository'
import type { FileAnalysisResult } from '../MediaFileAnalyzer'

export interface ActivationJournal {
  mediaItemId: number
  jobId?: number
  phase: 'prepared' | 'source_quarantined' | 'output_activated'
  inputPath: string
  tempPath: string
  targetPath: string
  quarantinePath: string
  mode: 'replace' | 'quarantine-replace'
  outputStats: FileAnalysisResult
}

/** Recover the exact verified job. For pre-ID journals, require a unique
 * matching verified output and quarantine identity before touching any files. */
export function resolveActivationJob(journal: ActivationJournal, candidates: MediaRemuxJob[]): MediaRemuxJob {
  const fingerprint = journal.outputStats.sourceFingerprint
  if (!fingerprint || !journal.outputStats.success || !/^[a-f0-9]{64}$/.test(fingerprint.sha256) || !Number.isFinite(fingerprint.size) || fingerprint.size <= 0) throw new Error('Activation journal has no verified output fingerprint')
  const matching = candidates.filter(job => {
    if (journal.jobId !== undefined && job.id !== journal.jobId || job.mediaItemId !== journal.mediaItemId || job.sourcePath !== journal.inputPath ||
        job.status !== 'verified' && job.status !== 'promoted' || job.actualOutputBytes !== fingerprint.size ||
        !job.outputAnalysis || job.quarantinePath !== journal.quarantinePath && !(journal.phase === 'prepared' && job.quarantinePath === null)) return false
    const output = JSON.parse(job.outputAnalysis) as FileAnalysisResult
    return output.success && output.sourceFingerprint?.sha256 === fingerprint.sha256 && output.sourceFingerprint.size === fingerprint.size &&
      (job.status === 'verified' ? output.filePath === journal.tempPath : output.filePath === journal.targetPath)
  })
  if (matching.length !== 1) throw new Error(`Activation recovery requires exactly one matching verified job for media item ${journal.mediaItemId}; found ${matching.length}`)
  return matching[0]
}
