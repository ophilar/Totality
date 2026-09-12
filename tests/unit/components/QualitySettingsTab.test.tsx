/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import React from 'react'
import { QualitySettingsTab } from '@/components/settings/tabs/QualitySettingsTab'
import { setupTestDb, cleanupTestDb, setupRealIntegratedBridge } from '@tests/TestUtils'
import { registerDatabaseHandlers } from '@main/ipc/database'
import { registerTaskQueueHandlers } from '@main/ipc/taskQueue'

describe('QualitySettingsTab Component Tests', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>
  let taskCompleteListener: ((task: { type: string }) => void) | null = null
  let progressListener: ((progress: { current: number; total: number }) => void) | null = null

  beforeEach(async () => {
    if (typeof window === 'undefined') {
      Object.assign(globalThis, { window: globalThis })
    }

    db = await setupTestDb()
    const bridge = setupRealIntegratedBridge()
    registerDatabaseHandlers()
    registerTaskQueueHandlers()

    taskCompleteListener = null
    progressListener = null

    // Extend electronAPI with required listeners and mocks for QualitySettingsTab
    const mockApi = {
      ...bridge.api,
      onTaskQueueTaskComplete: vi.fn().mockImplementation((cb: (task: { type: string }) => void) => {
        taskCompleteListener = cb
        return () => {
          taskCompleteListener = null
        }
      }),
      onQualityAnalysisProgress: vi.fn().mockImplementation((cb: (progress: { current: number; total: number }) => void) => {
        progressListener = cb
        return () => {
          progressListener = null
        }
      }),
      taskQueueAddTask: vi.fn().mockImplementation(bridge.api.taskQueueAddTask || (async () => ({}))),
    }

    Object.assign(window, { electronAPI: mockApi })
    Object.assign(globalThis, { electronAPI: mockApi })
  })

  afterEach(async () => {
    vi.clearAllMocks()
    await cleanupTestDb()
  })

  it('loads settings from backend and renders video/music cards', async () => {
    await db.config.setSetting('quality_video_1080p_medium', '7500')

    await act(async () => {
      render(<QualitySettingsTab />)
    })

    await waitFor(() => {
      expect(screen.getByText('Video Quality')).toBeTruthy()
      expect(screen.getByText('Music Quality')).toBeTruthy()
      expect(screen.getByText('FFmpeg encoding guidance')).toBeTruthy()
    })
  })

  it('expands and collapses settings cards when clicked', async () => {
    await act(async () => {
      render(<QualitySettingsTab />)
    })

    await waitFor(() => {
      expect(screen.getByText('Video Quality')).toBeTruthy()
    })

    // Initially resolution tabs are not visible because card is collapsed
    expect(screen.queryByRole('tablist')).toBeNull()

    // Expand Video Quality card
    const videoCardToggle = screen.getByRole('button', { name: /Video Quality/i })
    await act(async () => {
      fireEvent.click(videoCardToggle)
    })

    expect(screen.getByRole('tablist')).toBeTruthy()

    // Collapse Video Quality card
    await act(async () => {
      fireEvent.click(videoCardToggle)
    })

    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('switches resolution tabs and updates active settings tier', async () => {
    await act(async () => {
      render(<QualitySettingsTab />)
    })

    await waitFor(() => {
      expect(screen.getByText('Video Quality')).toBeTruthy()
    })

    // Expand Video Quality card
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Video Quality/i }))
    })

    // 1080p is selected by default
    const tab1080p = screen.getByRole('tab', { name: '1080p' })
    expect(tab1080p.getAttribute('aria-selected')).toBe('true')

    // Click 4K tab
    const tab4k = screen.getByRole('tab', { name: '4K' })
    await act(async () => {
      fireEvent.click(tab4k)
    })

    expect(tab4k.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('4K Ultra HD (≥2160p)')).toBeTruthy()
  })

  it('updates input settings and enables Save button on changes', async () => {
    await act(async () => {
      render(<QualitySettingsTab />)
    })

    await waitFor(() => {
      expect(screen.getByText('Video Quality')).toBeTruthy()
    })

    // Save Changes button should not exist initially when no changes made
    expect(screen.queryByText('Save Changes')).toBeNull()

    // Expand Video Quality card
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Video Quality/i }))
    })

    // Find Trash Threshold input and update value
    const trashInput = screen.getByLabelText(/Efficiency Score Trash Threshold/i) as HTMLInputElement
    await act(async () => {
      fireEvent.change(trashInput, { target: { value: '75' } })
    })

    // Save button should now be visible
    expect(screen.getByText('Save Changes')).toBeTruthy()
  })

  it('resets settings to defaults when Reset to Defaults is clicked', async () => {
    await act(async () => {
      render(<QualitySettingsTab />)
    })

    await waitFor(() => {
      expect(screen.getByText('Video Quality')).toBeTruthy()
    })

    // Expand Video Quality card
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Video Quality/i }))
    })

    const trashInput = screen.getByLabelText(/Efficiency Score Trash Threshold/i) as HTMLInputElement
    await act(async () => {
      fireEvent.change(trashInput, { target: { value: '85' } })
    })

    expect(trashInput.value).toBe('85')

    // Click Reset to Defaults
    const resetButton = screen.getByRole('button', { name: /Reset to Defaults/i })
    await act(async () => {
      fireEvent.click(resetButton)
    })

    expect(trashInput.value).toBe('60')
  })

  it('saves settings to database and displays re-analyze prompt', async () => {
    await act(async () => {
      render(<QualitySettingsTab />)
    })

    await waitFor(() => {
      expect(screen.getByText('Video Quality')).toBeTruthy()
    })

    // Expand Video Quality card
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Video Quality/i }))
    })

    const trashInput = screen.getByLabelText(/Efficiency Score Trash Threshold/i) as HTMLInputElement
    await act(async () => {
      fireEvent.change(trashInput, { target: { value: '80' } })
    })

    const saveButton = screen.getByRole('button', { name: /Save Changes/i })
    await act(async () => {
      fireEvent.click(saveButton)
    })

    await waitFor(() => {
      expect(screen.getByText('Settings Saved')).toBeTruthy()
      expect(screen.getByText(/Would you like to re-analyze your library/i)).toBeTruthy()
    })

    // Verify DB setting was saved
    const savedTrashSetting = await db.config.getSetting('quality_efficiency_trash_threshold')
    expect(savedTrashSetting).toBe('80')
  })

  it('allows skipping re-analysis after saving settings', async () => {
    await act(async () => {
      render(<QualitySettingsTab />)
    })

    await waitFor(() => {
      expect(screen.getByText('Video Quality')).toBeTruthy()
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Video Quality/i }))
    })

    const trashInput = screen.getByLabelText(/Efficiency Score Trash Threshold/i) as HTMLInputElement
    await act(async () => {
      fireEvent.change(trashInput, { target: { value: '70' } })
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }))
    })

    await waitFor(() => {
      expect(screen.getByText('Settings Saved')).toBeTruthy()
    })

    // Click Skip
    const skipButton = screen.getByRole('button', { name: 'Skip' })
    await act(async () => {
      fireEvent.click(skipButton)
    })

    await waitFor(() => {
      expect(screen.getByText('Video Quality')).toBeTruthy()
    })
  })

  it('handles re-analyze library action and progress updates', async () => {
    await act(async () => {
      render(<QualitySettingsTab />)
    })

    await waitFor(() => {
      expect(screen.getByText('Video Quality')).toBeTruthy()
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Video Quality/i }))
    })

    const trashInput = screen.getByLabelText(/Efficiency Score Trash Threshold/i) as HTMLInputElement
    await act(async () => {
      fireEvent.change(trashInput, { target: { value: '70' } })
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }))
    })

    await waitFor(() => {
      expect(screen.getByText('Settings Saved')).toBeTruthy()
    })

    // Click Re-analyze Library
    const reanalyzeBtn = screen.getByRole('button', { name: 'Re-analyze Library' })
    await act(async () => {
      fireEvent.click(reanalyzeBtn)
    })

    await waitFor(() => {
      expect(screen.getByText('Re-analyzing Library')).toBeTruthy()
    })

    // Simulate progress update event
    if (progressListener) {
      await act(async () => {
        progressListener!({ current: 5, total: 10 })
      })
    }

    expect(screen.getByText('5 of 10 items')).toBeTruthy()

    // Simulate task completion event
    if (taskCompleteListener) {
      await act(async () => {
        taskCompleteListener!({ type: 'quality-analysis' })
      })
    }

    await waitFor(() => {
      expect(screen.getByText('Video Quality')).toBeTruthy()
    })
  })

  it('supports adjusting score weighting range input', async () => {
    await act(async () => {
      render(<QualitySettingsTab />)
    })

    await waitFor(() => {
      expect(screen.getByText('Video Quality')).toBeTruthy()
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Video Quality/i }))
    })

    expect(screen.getByText('Video 70%')).toBeTruthy()
    expect(screen.getByText('Audio 30%')).toBeTruthy()

    // Find range input for score weighting (it is an <input type="range" value={settings.quality_video_weight}>)
    const rangeInput = document.querySelector('input[type="range"]') as HTMLInputElement
    expect(rangeInput).toBeTruthy()
    await act(async () => {
      fireEvent.change(rangeInput, { target: { value: '60' } })
    })

    expect(screen.getByText('Video 60%')).toBeTruthy()
    expect(screen.getByText('Audio 40%')).toBeTruthy()
  })

  it('supports expanding Music Quality card and modifying inputs', async () => {
    await act(async () => {
      render(<QualitySettingsTab />)
    })

    await waitFor(() => {
      expect(screen.getByText('Music Quality')).toBeTruthy()
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Music Quality/i }))
    })

    const sampleRateInput = screen.getByLabelText(/Hi-Res Sample Rate Threshold/i) as HTMLInputElement
    expect(sampleRateInput.value).toBe('44100')

    await act(async () => {
      fireEvent.change(sampleRateInput, { target: { value: '96000' } })
    })

    expect(sampleRateInput.value).toBe('96000')
    expect(screen.getByText('Save Changes')).toBeTruthy()
  })
})
