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
      start: vi.fn().mockRejectedValue(new Error('encoder start failed')),
      cancel: vi.fn().mockResolvedValue(undefined),
    })
  })

  it('leaves encoding state and exposes failure when starting a transcode rejects', async () => {
    render(
      <ToastProvider>
        <TranscodeModal mediaId={501} onClose={vi.fn()} />
      </ToastProvider>
    )

    const startButton = await screen.findByRole('button', { name: /start transcode optimization/i })
    fireEvent.click(startButton)

    await waitFor(() => {
      expect(screen.getByText('Encoding Failed')).toBeTruthy()
    })
    expect(screen.queryByText('Live Hardware Transcoding Active')).toBeNull()
  })
})
