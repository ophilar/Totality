import { describe, expect, it } from 'vitest'
import { buildOptimizationSavingsBreakdown, calculateBitrateSavingsBytes, calculateBytesAtBitrateKbps, projectMeasuredSavingsBytes, projectSavingsRate, sumMeasuredStreamBytes } from '@main/services/OptimizationSavingsService'

describe('shared savings calculations', () => {
  it('converts bitrate and duration to bytes consistently', () => {
    expect(calculateBytesAtBitrateKbps(1_000, 60)).toBe(7_500_000)
    expect(calculateBitrateSavingsBytes(1_000, 128, 60)).toBe(6_540_000)
  })

  it('projects measured sample output across a representative episode and show', () => {
    const representativeSavings = projectMeasuredSavingsBytes(1_000_000_000, 3_600, 80_000_000, 300)
    expect(representativeSavings).toBe(40_000_000)
    expect(projectSavingsRate(1_000_000_000, representativeSavings, 2_000_000_000)).toBe(80_000_000)
  })

  it('sums only selected removed streams and leaves missing byte evidence unknown', () => {
    expect(sumMeasuredStreamBytes({ 2: 100, 4: 250, 6: 700 }, [2, 6])).toBe(800)
    expect(sumMeasuredStreamBytes({ 2: 100 }, [2, 6])).toBeNull()
    expect(sumMeasuredStreamBytes({ 2: 100 }, [])).toBeNull()
  })
})

describe('buildOptimizationSavingsBreakdown', () => {
  it('sums known non-overlapping components and uses that total for percentage', () => {
    const result = buildOptimizationSavingsBreakdown({
      totalBytes: 1_000,
      videoSavingsBytes: 200,
      audioPruningBytes: 100,
      audioTranscodeBytes: 50,
      subtitlePruningBytes: 25,
      plannedOperations: ['video_transcode', 'audio_pruning', 'audio_transcode', 'subtitle_pruning'],
    })

    expect(result.totalEstimatedSavingsBytes).toBe(375)
    expect(result.subtitlePruningBytes).toBe(25)
    expect(result.percentageSavings).toBe(37.5)
    expect(result.coverage).toBe('complete')
  })

  it('preserves unknown component evidence as partial rather than zero', () => {
    const result = buildOptimizationSavingsBreakdown({
      totalBytes: 1_000,
      videoSavingsBytes: 200,
      audioPruningBytes: null,
      audioTranscodeBytes: null,
      plannedOperations: ['video_transcode', 'audio_pruning', 'audio_transcode'],
    })

    expect(result.videoSavingsBytes).toBe(200)
    expect(result.audioPruningBytes).toBeNull()
    expect(result.audioTranscodeBytes).toBeNull()
    expect(result.totalEstimatedSavingsBytes).toBe(200)
    expect(result.percentageSavings).toBe(20)
    expect(result.coverage).toBe('partial')
  })

  it('reports insufficient coverage when no savings component is evidenced', () => {
    const result = buildOptimizationSavingsBreakdown({
      totalBytes: 1_000,
      videoSavingsBytes: null,
      audioPruningBytes: null,
      audioTranscodeBytes: null,
      plannedOperations: ['video_transcode', 'audio_pruning', 'audio_transcode'],
    })

    expect(result.totalEstimatedSavingsBytes).toBeNull()
    expect(result.percentageSavings).toBeNull()
    expect(result.coverage).toBe('insufficient')
  })

  it('does not invent a percentage when total size is unknown or zero', () => {
    const unknownSize = buildOptimizationSavingsBreakdown({
      totalBytes: null,
      videoSavingsBytes: 100,
      audioPruningBytes: 50,
      audioTranscodeBytes: 0,
      plannedOperations: ['video_transcode', 'audio_pruning', 'audio_transcode'],
    })
    expect(unknownSize.totalEstimatedSavingsBytes).toBe(150)
    expect(unknownSize.percentageSavings).toBeNull()
    expect(unknownSize.coverage).toBe('partial')

    expect(buildOptimizationSavingsBreakdown({
      totalBytes: 0,
      videoSavingsBytes: 100,
      audioPruningBytes: 50,
      audioTranscodeBytes: 0,
      plannedOperations: ['video_transcode', 'audio_pruning', 'audio_transcode'],
    }).percentageSavings).toBeNull()
  })

  it('caps every component at the source file size', () => {
    const result = buildOptimizationSavingsBreakdown({
      totalBytes: 100,
      videoSavingsBytes: 200,
      audioPruningBytes: 150,
      audioTranscodeBytes: null,
      plannedOperations: ['video_transcode', 'audio_pruning'],
    })

    expect(result.videoSavingsBytes).toBe(100)
    expect(result.audioPruningBytes).toBe(100)
    expect(result.totalEstimatedSavingsBytes).toBe(100)
    expect(result.coverage).toBe('complete')
  })

  it('uses only selected operations to calculate plan coverage', () => {
    const result = buildOptimizationSavingsBreakdown({
      totalBytes: 1_000,
      videoSavingsBytes: 500,
      audioPruningBytes: null,
      audioTranscodeBytes: 100,
      subtitlePruningBytes: null,
      plannedOperations: ['audio_transcode', 'subtitle_pruning'],
    })

    expect(result.totalEstimatedSavingsBytes).toBe(100)
    expect(result.coverage).toBe('partial')
  })

  it('reports a known zero for an audio-only plan with measured savings evidence', () => {
    const result = buildOptimizationSavingsBreakdown({
      totalBytes: 1_000,
      videoSavingsBytes: null,
      audioPruningBytes: null,
      audioTranscodeBytes: 0,
      subtitlePruningBytes: null,
      plannedOperations: ['audio_transcode'],
    })

    expect(result.totalEstimatedSavingsBytes).toBe(0)
    expect(result.coverage).toBe('complete')
  })

  it('uses a full-output sample once for the complete plan', () => {
    const result = buildOptimizationSavingsBreakdown({
      totalBytes: 1_000,
      videoSavingsBytes: 500,
      audioPruningBytes: 200,
      audioTranscodeBytes: 100,
      subtitlePruningBytes: 50,
      plannedOperations: ['video_transcode', 'audio_pruning', 'audio_transcode', 'subtitle_pruning'],
      measuredPlanSavingsBytes: 1_200,
    })

    expect(result.totalEstimatedSavingsBytes).toBe(1_000)
    expect(result.coverage).toBe('complete')
  })

  it('replaces the modeled plan total with the whole-output sample projection', () => {
    const result = buildOptimizationSavingsBreakdown({
      totalBytes: 1_000,
      videoSavingsBytes: 400,
      audioPruningBytes: 100,
      audioTranscodeBytes: 50,
      subtitlePruningBytes: 25,
      plannedOperations: ['video_transcode', 'audio_pruning', 'audio_transcode', 'subtitle_pruning'],
      measuredPlanSavingsBytes: 200,
    })
    expect(result.totalEstimatedSavingsBytes).toBe(200)
    expect(result.coverage).toBe('complete')
  })
})
