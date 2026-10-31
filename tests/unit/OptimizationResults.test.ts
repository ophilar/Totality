import { describe, expect, it } from 'vitest'
import { sumKnownResultBytes } from '../../src/renderer/src/components/library/transcoding/optimizationResults'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import { EstimatedSavingsDisplay } from '../../src/renderer/src/components/library/EstimatedSavingsDisplay'

describe('optimization result savings', () => {
  it('sums measured values and leaves incomplete totals unknown', () => {
    expect(sumKnownResultBytes([{ encodedReductionBytes: 12 }, { encodedReductionBytes: 8 }], 'encodedReductionBytes')).toBe(20)
    expect(sumKnownResultBytes([{ physicallyReclaimedBytes: 12 }, {}], 'physicallyReclaimedBytes')).toBeNull()
  })

  it('does not treat an empty result set as a measured zero', () => {
    expect(sumKnownResultBytes([], 'physicallyReclaimedBytes')).toBeNull()
    expect(renderToStaticMarkup(React.createElement(EstimatedSavingsDisplay, { bytes: null }))).toContain('Not measured')
  })

  it('preserves small savings values and rejects invalid measurements', () => {
    expect(renderToStaticMarkup(React.createElement(EstimatedSavingsDisplay, { bytes: 1024 }))).toContain('1.0 KB')
    expect(renderToStaticMarkup(React.createElement(EstimatedSavingsDisplay, { bytes: Number.NaN }))).toContain('Not measured')
    expect(renderToStaticMarkup(React.createElement(EstimatedSavingsDisplay, { bytes: -1 }))).toContain('Not measured')
  })
})
