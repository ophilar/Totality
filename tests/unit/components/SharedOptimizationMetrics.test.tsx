/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import React from 'react'
import { EvidenceStatusBadge } from '@/components/library/EvidenceStatusBadge'
import { EfficiencyDisplay } from '@/components/library/EfficiencyDisplay'
import { RecoverableWasteDisplay } from '@/components/library/RecoverableWasteDisplay'
import { OptimizationMetrics } from '@/components/library/OptimizationMetrics'
import { MediaMetricsRow } from '@/components/library/MediaMetricsRow'
import { calculateOptimizationSummary } from '@/components/library/optimizationSummary'

describe('Shared Optimization UI Components', () => {
  afterEach(() => {
    cleanup()
  })

  describe('EvidenceStatusBadge', () => {
    it('renders Measured badge when status is measured', () => {
      render(<EvidenceStatusBadge status="measured" />)
      const badge = screen.getByText('Measured')
      expect(badge).toBeDefined()
      expect(badge.getAttribute('title')).toContain('Verified against media file streams')
    })

    it('renders Estimated badge when status is estimated', () => {
      render(<EvidenceStatusBadge status="estimated" />)
      const badge = screen.getByText('Estimated')
      expect(badge).toBeDefined()
      expect(badge.getAttribute('title')).toContain('Heuristic approximation')
    })

    it('renders Unmeasured badge when status is unknown, unmeasured, or missing', () => {
      render(<EvidenceStatusBadge status="unmeasured" />)
      expect(screen.getByText('Unmeasured')).toBeDefined()
    })
  })

  describe('EfficiencyDisplay', () => {
    it('renders explicit -- placeholder when score is null or negative', () => {
      render(<EfficiencyDisplay score={null} status="unknown" />)
      expect(screen.getByText('--')).toBeDefined()
      expect(screen.getByText('unknown')).toBeDefined()
    })

    it('renders formatted percentage when score is known', () => {
      render(<EfficiencyDisplay score={85.4} status="complete" />)
      expect(screen.getByText('85%')).toBeDefined()
    })

    it('renders partial tag when calculation status is partial', () => {
      render(<EfficiencyDisplay score={72} status="partial" />)
      expect(screen.getByText('72%')).toBeDefined()
      expect(screen.getByText('partial')).toBeDefined()
    })
  })

  describe('RecoverableWasteDisplay', () => {
    it('renders -- when recoverable bytes is null or undefined', () => {
      render(<RecoverableWasteDisplay bytes={null} />)
      expect(screen.getByText('--')).toBeDefined()
    })

    it('renders None when recoverable bytes is 0', () => {
      render(<RecoverableWasteDisplay bytes={0} />)
      expect(screen.getByText('None')).toBeDefined()
    })

    it('renders formatted byte size when recoverable bytes > 0', () => {
      render(<RecoverableWasteDisplay bytes={1073741824} />)
      expect(screen.getByText('1 GB')).toBeDefined()
    })
  })

  describe('OptimizationMetrics', () => {
    it('renders unified summary metrics', () => {
      render(
        <OptimizationMetrics
          summary={{
            status: 'partial',
            knownCount: 8,
            totalCount: 10,
            overallEfficiencyScore: 82,
            recoverableWasteBytes: 2147483648,
            confidenceScore: 80
          }}
        />
      )

      expect(screen.getByText('Efficiency:')).toBeDefined()
      expect(screen.getByText('82%')).toBeDefined()
      expect(screen.getByText('partial')).toBeDefined()
      expect(screen.getByText('Recoverable:')).toBeDefined()
      expect(screen.getByText('2 GB')).toBeDefined()
      expect(screen.getByText('8/10 items analyzed')).toBeDefined()
      expect(screen.getByText('(80% coverage)')).toBeDefined()
    })
  })

  describe('MediaMetricsRow', () => {
    it('renders size, waste, efficiency, and evidence status badge in a single canonical row', () => {
      render(
        <MediaMetricsRow
          fileSize={1073741824}
          storageDebtBytes={536870912}
          efficiencyScore={75}
          evidenceStatus="measured"
        />
      )

      expect(screen.getByText('1 GB')).toBeDefined()
      expect(screen.getByText('512 MB')).toBeDefined()
      expect(screen.getByText('75%')).toBeDefined()
      expect(screen.getByText('Measured')).toBeDefined()
    })

    it('handles null values with graceful standard placeholders', () => {
      render(
        <MediaMetricsRow
          fileSize={null}
          storageDebtBytes={null}
          efficiencyScore={null}
          evidenceStatus={null}
        />
      )

      expect(screen.getByText('Size unavailable')).toBeDefined()
      expect(screen.getAllByText('--')).toHaveLength(2)
    })
  })

  describe('calculateOptimizationSummary', () => {
    it('returns null for empty or null items', () => {
      expect(calculateOptimizationSummary(null)).toBeNull()
      expect(calculateOptimizationSummary([])).toBeNull()
    })

    it('calculates weighted efficiency, total debt, and completeness status accurately', () => {
      const items = [
        { file_size: 1000, storage_debt_bytes: 200, efficiency_score: 80 },
        { file_size: 3000, storage_debt_bytes: 600, efficiency_score: 60 },
      ]
      // weighted: (80*1000 + 60*3000) / (1000 + 3000) = (80000 + 180000) / 4000 = 260000 / 4000 = 65
      const summary = calculateOptimizationSummary(items, 2)
      expect(summary).toMatchObject({
        status: 'complete',
        calculationStatus: 'measured',
        knownCount: 2,
        totalCount: 2,
        overallEfficiencyScore: 65,
        recoverableWasteBytes: 800,
        confidenceScore: 100
      })
    })

    it('marks partial calculation when some items are unmeasured', () => {
      const items = [
        { file_size: 1000, storage_debt_bytes: 200, efficiency_score: 80 },
        { file_size: null, storage_debt_bytes: null, efficiency_score: null },
      ]
      const summary = calculateOptimizationSummary(items, 2)
      expect(summary?.status).toBe('partial')
      expect(summary?.calculationStatus).toBe('estimated')
      expect(summary?.knownCount).toBe(1)
      expect(summary?.overallEfficiencyScore).toBe(80)
      expect(summary?.recoverableWasteBytes).toBe(200)
      expect(summary?.confidenceScore).toBe(50)
    })
  })
})
