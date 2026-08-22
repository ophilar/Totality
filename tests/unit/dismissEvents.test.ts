/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  emitDismissUpgrade,
  emitDismissCollectionMovie,
  onDismissUpgrade,
  onDismissCollectionMovie
} from '@/utils/dismissEvents'

describe('dismissEvents', () => {
  const mockDispatchEvent = vi.fn()
  const mockAddEventListener = vi.fn()
  const mockRemoveEventListener = vi.fn()

  let originalDispatchEvent: typeof window.dispatchEvent
  let originalAddEventListener: typeof window.addEventListener
  let originalRemoveEventListener: typeof window.removeEventListener

  beforeEach(() => {
    vi.clearAllMocks()
    originalDispatchEvent = window.dispatchEvent
    originalAddEventListener = window.addEventListener
    originalRemoveEventListener = window.removeEventListener

    window.dispatchEvent = mockDispatchEvent as any
    window.addEventListener = mockAddEventListener as any
    window.removeEventListener = mockRemoveEventListener as any
  })

  afterEach(() => {
    window.dispatchEvent = originalDispatchEvent
    window.addEventListener = originalAddEventListener
    window.removeEventListener = originalRemoveEventListener
  })

  describe('emitDismissUpgrade', () => {
    it('should dispatch a CustomEvent with DISMISS_UPGRADE and the correct payload', () => {
      const payload = { mediaId: 123 }
      emitDismissUpgrade(payload)

      expect(mockDispatchEvent).toHaveBeenCalledTimes(1)
      const eventArg = mockDispatchEvent.mock.calls[0][0]
      expect(eventArg).toBeInstanceOf(CustomEvent)
      expect(eventArg.type).toBe('totality:dismiss-upgrade')
      expect(eventArg.detail).toEqual(payload)
    })
  })

  describe('emitDismissCollectionMovie', () => {
    it('should dispatch a CustomEvent with DISMISS_COLLECTION_MOVIE and the correct payload', () => {
      const payload = { collectionId: 'col-1', tmdbId: 'tmdb-1' }
      emitDismissCollectionMovie(payload)

      expect(mockDispatchEvent).toHaveBeenCalledTimes(1)
      const eventArg = mockDispatchEvent.mock.calls[0][0]
      expect(eventArg).toBeInstanceOf(CustomEvent)
      expect(eventArg.type).toBe('totality:dismiss-collection-movie')
      expect(eventArg.detail).toEqual(payload)
    })
  })

  describe('onDismissUpgrade', () => {
    it('should add event listener and return a cleanup function', () => {
      const handler = vi.fn()
      const cleanup = onDismissUpgrade(handler)

      expect(mockAddEventListener).toHaveBeenCalledTimes(1)
      expect(mockAddEventListener).toHaveBeenCalledWith('totality:dismiss-upgrade', expect.any(Function))

      // Verify cleanup calls removeEventListener
      expect(mockRemoveEventListener).not.toHaveBeenCalled()
      cleanup()
      expect(mockRemoveEventListener).toHaveBeenCalledTimes(1)
      expect(mockRemoveEventListener).toHaveBeenCalledWith('totality:dismiss-upgrade', expect.any(Function))
    })

    it('should call the handler with the event detail payload', () => {
      const handler = vi.fn()
      onDismissUpgrade(handler)

      const listener = mockAddEventListener.mock.calls[0][1]
      const payload = { mediaId: 456 }

      // Simulate event firing
      const mockEvent = { detail: payload }
      listener(mockEvent as any)

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(payload)
    })
  })

  describe('onDismissCollectionMovie', () => {
    it('should add event listener and return a cleanup function', () => {
      const handler = vi.fn()
      const cleanup = onDismissCollectionMovie(handler)

      expect(mockAddEventListener).toHaveBeenCalledTimes(1)
      expect(mockAddEventListener).toHaveBeenCalledWith('totality:dismiss-collection-movie', expect.any(Function))

      // Verify cleanup calls removeEventListener
      expect(mockRemoveEventListener).not.toHaveBeenCalled()
      cleanup()
      expect(mockRemoveEventListener).toHaveBeenCalledTimes(1)
      expect(mockRemoveEventListener).toHaveBeenCalledWith('totality:dismiss-collection-movie', expect.any(Function))
    })

    it('should call the handler with the event detail payload', () => {
      const handler = vi.fn()
      onDismissCollectionMovie(handler)

      const listener = mockAddEventListener.mock.calls[0][1]
      const payload = { collectionId: 'c2', tmdbId: 't2' }

      // Simulate event firing
      const mockEvent = { detail: payload }
      listener(mockEvent as any)

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(payload)
    })
  })
})
