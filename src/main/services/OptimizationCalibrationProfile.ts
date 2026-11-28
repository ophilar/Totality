import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import { isValidOptimizationCalibrationEntry, OPTIMIZATION_CALIBRATION_VERSION, type OptimizationCalibrationEntry, type PersistedOptimizationCalibration } from './MeasuredOptimizationPolicy'

/** The active profile is replaced atomically; abandoned staging files never become active. */
export async function writeOptimizationCalibrationProfile(profilePath: string, entries: OptimizationCalibrationEntry[]): Promise<void> {
  if (!entries.every(isValidOptimizationCalibrationEntry)) throw new Error('Invalid optimization calibration entry')
  const record: PersistedOptimizationCalibration = { version: OPTIMIZATION_CALIBRATION_VERSION, entries }
  const temporaryPath = `${profilePath}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', flush: true })
    await fs.rename(temporaryPath, profilePath)
  } finally {
    await fs.rm(temporaryPath, { force: true })
  }
}

export async function readOptimizationCalibrationProfile(profilePath: string): Promise<OptimizationCalibrationEntry[]> {
  let raw: string
  try {
    raw = await fs.readFile(profilePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const record = JSON.parse(raw) as PersistedOptimizationCalibration
  if (!record || record.version !== OPTIMIZATION_CALIBRATION_VERSION || !Array.isArray(record.entries) || !record.entries.every(isValidOptimizationCalibrationEntry)) {
    throw new Error('Invalid persisted optimization calibration')
  }
  return record.entries
}
