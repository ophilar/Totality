import { stat } from 'node:fs/promises'
import type { FileAnalysisResult } from '../MediaFileAnalyzer'
import { matchesFileIdentity } from './FileIdentity'
import { PathUtils } from './PathUtils'

export async function validatePersistedFileAnalysis(
  analysis: FileAnalysisResult,
  filePath: string,
): Promise<string | null> {
  if (!analysis.success) return 'persisted analysis was unsuccessful'
  if (!PathUtils.arePathsEqual(analysis.filePath, filePath)) return 'source path changed since analysis'
  if (!analysis.fileAnalysisFingerprint) return 'persisted analysis has no source fingerprint'

  let current
  try {
    current = await stat(filePath)
  } catch (error) {
    return `source could not be read: ${error instanceof Error ? error.message : String(error)}`
  }
  if (!matchesFileIdentity(analysis.fileAnalysisFingerprint, current)) return 'source identity changed since analysis'
  return null
}
