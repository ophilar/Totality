/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QualityBadges } from '../../src/renderer/src/components/library/QualityBadges'
import React from 'react'

describe('QualityBadges Component', () => {
  it('should render Bloated badge when efficiency is low', () => {
    const item: any = {
      efficiency_score: 20,
      storage_debt_bytes: 0,
      type: 'movie'
    }
    render(React.createElement(QualityBadges, { item }))
    expect(screen.getByText('Bloated')).toBeTruthy()
  })

  it('should render Waste badge when storage debt is high', () => {
    const item: any = {
      efficiency_score: 100,
      storage_debt_bytes: 10 * 1024 * 1024 * 1024, // 10GB
      type: 'movie'
    }
    render(React.createElement(QualityBadges, { item }))
    expect(screen.getByText('10GB Waste')).toBeTruthy()
  })

  it('should render HDR badges', () => {
    const item: any = {
      hdr_format: 'Dolby Vision'
    }
    render(React.createElement(QualityBadges, { item }))
    expect(screen.getByText('Dolby Vision')).toBeTruthy()
  })

  it('should render bit depth badge', () => {
    const item: any = {
      color_bit_depth: 10
    }
    render(React.createElement(QualityBadges, { item }))
    expect(screen.getByText('10-bit')).toBeTruthy()
  })

  it('should render object audio badge', () => {
    const item: any = {
      has_object_audio: 1
    }
    render(React.createElement(QualityBadges, { item }))
    expect(screen.getByText('Immersive Audio')).toBeTruthy()
  })

  it('should return null when no badges', () => {
    const item: any = {}
    const { container } = render(React.createElement(QualityBadges, { item }))
    expect(container.firstChild).toBeNull()
  })
})
