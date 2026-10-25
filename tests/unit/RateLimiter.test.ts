/**
 * RateLimiter Unit Tests
 *
 * Tests for SlidingWindowRateLimiter, SimpleDelayRateLimiter,
 * and pre-configured API rate limiters.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { APP_CONFIG } from '@main/config'
import {
  SlidingWindowRateLimiter,
  SimpleDelayRateLimiter,
  RateLimiters,
} from '../../src/main/services/utils/RateLimiter'

// ============================================================================
// SlidingWindowRateLimiter
// ============================================================================

describe('SlidingWindowRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should allow requests under the limit without waiting', async () => {
    const limiter = new SlidingWindowRateLimiter(3, 1000, 0)

    // First 3 requests should be immediate
    await limiter.waitForSlot()
    await limiter.waitForSlot()
    await limiter.waitForSlot()

    const stats = limiter.getStats()
    expect(stats.currentCount).toBe(3)
    expect(stats.maxRequests).toBe(3)
    expect(stats.windowMs).toBe(1000)
  })

  it('should reset all tracked requests', async () => {
    const limiter = new SlidingWindowRateLimiter(3, 1000, 0)

    await limiter.waitForSlot()
    await limiter.waitForSlot()

    limiter.reset()
    const stats = limiter.getStats()
    expect(stats.currentCount).toBe(0)
  })

  it('should report correct stats', () => {
    const limiter = new SlidingWindowRateLimiter(10, 5000)
    const stats = limiter.getStats()
    expect(stats.maxRequests).toBe(10)
    expect(stats.windowMs).toBe(5000)
    expect(stats.currentCount).toBe(0)
  })

  it('should expire old timestamps outside the window', async () => {
    const limiter = new SlidingWindowRateLimiter(2, 1000, 0)

    await limiter.waitForSlot()
    await limiter.waitForSlot()

    // Advance past the window
    vi.advanceTimersByTime(1100)

    // Old timestamps should be expired, allowing new requests
    const stats = limiter.getStats()
    expect(stats.currentCount).toBe(0)
  })
})

// ============================================================================
// SimpleDelayRateLimiter
// ============================================================================

describe('SimpleDelayRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should allow first request immediately', async () => {
    const limiter = new SimpleDelayRateLimiter(1000)
    // First request should not wait (no previous request)
    const promise = limiter.waitForSlot()
    await vi.runAllTimersAsync()
    await promise
    expect(limiter.getTimeSinceLastRequest()).toBeLessThanOrEqual(1)
  })

  it('should reset last request time', () => {
    const limiter = new SimpleDelayRateLimiter(1000)
    limiter.reset()
    expect(limiter.getTimeSinceLastRequest()).toBeGreaterThan(0)
  })

  it('should track time since last request', async () => {
    const limiter = new SimpleDelayRateLimiter(1000)
    await limiter.waitForSlot()

    vi.advanceTimersByTime(500)
    const elapsed = limiter.getTimeSinceLastRequest()
    expect(elapsed).toBeGreaterThanOrEqual(500)
  })

  it('backs off after service errors and recovers after successful requests', () => {
    const limiter = new SimpleDelayRateLimiter(1500)

    limiter.recordError(503)
    expect(limiter.getCurrentDelay()).toBe(3000)

    limiter.setDelay(45_000)
    expect(limiter.getCurrentDelay()).toBe(45_000)

    for (let i = 0; i < 5; i++) limiter.recordSuccess()
    expect(limiter.getCurrentDelay()).toBe(44_500)

    limiter.reset()
    expect(limiter.getCurrentDelay()).toBe(1500)
  })

  it('pauses MusicBrainz requests after repeated availability failures', async () => {
    const limiter = RateLimiters.createMusicBrainzLimiter()
    await limiter.waitForSlot()
    limiter.recordError(503)
    limiter.recordError(503)
    limiter.recordError(503)

    let resolved = false
    const request = limiter.waitForSlot().then(() => { resolved = true })
    await vi.advanceTimersByTimeAsync(APP_CONFIG.musicBrainz.availabilityCooldownMs - 1)
    expect(resolved).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await request
    expect(resolved).toBe(true)
  })
})

// ============================================================================
// Pre-configured Limiters
// ============================================================================

describe('RateLimiters factory', () => {
  it('should create TMDB limiter with correct config', () => {
    const limiter = RateLimiters.createTMDBLimiter()
    expect(limiter).toBeInstanceOf(SlidingWindowRateLimiter)
    const stats = limiter.getStats()
    expect(stats.maxRequests).toBe(40)
    expect(stats.windowMs).toBe(1000)
  })

  it('should create MusicBrainz limiter with correct type', () => {
    const limiter = RateLimiters.createMusicBrainzLimiter()
    expect(limiter).toBeInstanceOf(SimpleDelayRateLimiter)
  })
})
