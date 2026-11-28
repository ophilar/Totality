import { describe, expect, it } from 'vitest'
import { resolveActivationJob, type ActivationJournal } from '@main/services/transcoding/ActivationJournal'
import type { MediaRemuxJob } from '@main/database/repositories/MediaRemuxJobRepository'

const output = { success: true, filePath: '/media/temporary.mkv', audioTracks: [], subtitleTracks: [], sourceFingerprint: { size: 10, mtimeMs: 1, sha256: 'a'.repeat(64) } }
const journal: ActivationJournal = { mediaItemId: 1, jobId: 2, phase: 'prepared', inputPath: '/media/movie.mkv', tempPath: output.filePath, targetPath: '/media/movie.mkv', quarantinePath: '/media/quarantine.mkv', mode: 'quarantine-replace', outputStats: { ...output, filePath: '/media/movie.mkv' } }
const job: MediaRemuxJob = {
  id: 2, mediaItemId: 1, operationKind: 'transcode', status: 'verified', sourcePath: journal.inputPath, sourceSize: 20, sourceMtimeMs: 1,
  sourceSha256: 'b'.repeat(64), decisionSnapshot: '{}', streamSignatures: '{}', quarantinePath: null, error: null, predictedOutputBytes: 10, actualOutputBytes: 10,
  bytesSaved: null, sourceDurationMs: 100, outputDurationMs: 100, encoderProfile: null, sourceAnalysis: null, outputAnalysis: JSON.stringify(output), createdAt: '', updatedAt: '',
}

describe('activation journal identity', () => {
  it('selects the exact job rather than the latest updated job', () => {
    expect(resolveActivationJob(journal, [job, { ...job, id: 3 }]).id).toBe(2)
    expect(() => resolveActivationJob(journal, [{ ...job, id: 3 }])).toThrow('found 0')
  })
  it('requires matching recorded output bytes and quarantine identity', () => {
    expect(() => resolveActivationJob(journal, [{ ...job, actualOutputBytes: 11 }])).toThrow('found 0')
    expect(() => resolveActivationJob(journal, [{ ...job, quarantinePath: '/media/unrelated.mkv' }])).toThrow('found 0')
    expect(() => resolveActivationJob({ ...journal, phase: 'source_quarantined' }, [job])).toThrow('found 0')
    expect(resolveActivationJob({ ...journal, phase: 'source_quarantined' }, [{ ...job, quarantinePath: journal.quarantinePath }]).id).toBe(2)
  })
  it('recovers an existing pre-ID journal only with unambiguous matching evidence', () => {
    const existing = { ...journal, jobId: undefined }
    expect(resolveActivationJob(existing, [job]).id).toBe(2)
    expect(() => resolveActivationJob(existing, [job, { ...job, id: 3 }])).toThrow('found 2')
  })
  it('accepts an already promoted job only with matching published output', () => {
    const promoted = { ...job, status: 'promoted' as const, quarantinePath: journal.quarantinePath, outputAnalysis: JSON.stringify(journal.outputStats) }
    expect(resolveActivationJob({ ...journal, phase: 'output_activated' }, [promoted]).id).toBe(2)
    expect(() => resolveActivationJob({ ...journal, phase: 'output_activated' }, [{ ...promoted, outputAnalysis: JSON.stringify(output) }])).toThrow('found 0')
  })
})
