/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TranscodeModal } from '@/components/library/TranscodeModal'
import { ToastProvider } from '@/contexts/ToastContext'

describe('TranscodeModal failure handling', () => {
  beforeEach(() => {
    Object.assign(window.electronAPI, {
      getMediaItem: vi.fn().mockResolvedValue({
        id: 501,
        title: 'Failure Movie',
        type: 'movie',
        file_path: '/media/failure.mkv',
        source_id: 'test-source',
      }),
      getCapabilities: vi.fn().mockResolvedValue({
        ffmpeg: true,
        engines: ['ffmpeg'],
        gpus: [],
      }),
      getParameters: vi.fn().mockResolvedValue({
        command: 'ffmpeg',
        args: [],
        summary: 'test strategy',
      }),
      onProgress: vi.fn().mockReturnValue(vi.fn()),
      preflightShow: vi.fn().mockRejectedValue(new Error('analysis failed')),
      cancel: vi.fn().mockResolvedValue(undefined),
    })
  })

  it('keeps the modal out of encoding state when optimization preflight fails', async () => {
    render(
      <ToastProvider>
        <TranscodeModal mediaId={501} onClose={vi.fn()} />
      </ToastProvider>
    )

    const startButton = await screen.findByRole('button', { name: /review optimization/i })
    fireEvent.click(startButton)

    await waitFor(() => expect(window.electronAPI.preflightShow).toHaveBeenCalled())
    expect(screen.queryByText('Encoding Failed')).toBeNull()
    expect(screen.queryByText('Live Hardware Transcoding Active')).toBeNull()
  })
})
