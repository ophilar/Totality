
import { APP_CONFIG } from '@main/config'

/**
 * RateLimiter Utilities
 *
 * Shared rate limiting implementations for external API services.
 * Ensures compliance with API terms of service while maximizing throughput.
 */

/**
 * Base interface for rate limiters
 */
export interface RateLimiter {
  /**
   * Wait until a request slot is available
   * Call this before making each API request
   */
  waitForSlot(): Promise<void>

  /**
   * Reset the rate limiter state
   */
  reset(): void
}
/**
 * Sliding Window Rate Limiter
 *
 * Allows up to maxRequests within windowMs, using a sliding window algorithm.
 * Tracks timestamps of recent requests and waits if limit is reached.
 *
 * Best for APIs with "X requests per Y seconds" limits (e.g., TMDB: 40 req/10s)
 *
 * @example
 * const limiter = new SlidingWindowRateLimiter(40, 10000) // 40 requests per 10 seconds
 * await limiter.waitForSlot()
 * await fetch(...)
 */
export class SlidingWindowRateLimiter implements RateLimiter {
  private requestTimestamps: number[] = []
  private readonly maxRequests: number
  private readonly windowMs: number
  private readonly bufferMs: number
  private effectiveMaxRequests: number
  private pauseUntil = 0

  /**
   * @param maxRequests Maximum number of requests allowed in the window
   * @param windowMs Time window in milliseconds
   * @param bufferMs Extra buffer time to add after waiting (default: 100ms)
   */
  constructor(maxRequests: number, windowMs: number, bufferMs: number = 100) {
    this.maxRequests = maxRequests
    this.effectiveMaxRequests = maxRequests
    this.windowMs = windowMs
    this.bufferMs = bufferMs
  }

  async waitForSlot(): Promise<void> {
    while (true) {
      const now = Date.now()
      this.requestTimestamps = this.requestTimestamps.filter(timestamp => now - timestamp < this.windowMs)
      const pauseWait = this.pauseUntil - now
      const windowWait = this.requestTimestamps.length >= this.effectiveMaxRequests
        ? this.windowMs - (now - this.requestTimestamps[0]) + this.bufferMs
        : 0
      if (pauseWait <= 0 && windowWait <= 0) {
        this.requestTimestamps.push(now)
        return
      }
      await this.delay(Math.max(pauseWait, windowWait))
    }
  }

  reset(): void {
    this.requestTimestamps = []
    this.effectiveMaxRequests = this.maxRequests
    this.pauseUntil = 0
  }

  pauseFor(delayMs: number): void {
    this.pauseUntil = Math.max(this.pauseUntil, Date.now() + Math.max(0, delayMs))
  }

  recordError(status: number): void {
    if (status === 429 || status === 503) this.effectiveMaxRequests = Math.max(1, Math.floor(this.effectiveMaxRequests / 2))
  }

  recordSuccess(): void {
    if (this.effectiveMaxRequests < this.maxRequests) this.effectiveMaxRequests++
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Get current usage statistics
   */
  getStats(): { currentCount: number; maxRequests: number; windowMs: number } {
    const now = Date.now()
    const currentCount = this.requestTimestamps.filter(
      ts => now - ts < this.windowMs
    ).length

    return {
      currentCount,
      maxRequests: this.effectiveMaxRequests,
      windowMs: this.windowMs,
    }
  }
}

/**
 * Simple Delay Rate Limiter
 *
 * Ensures minimum time between consecutive requests.
 * Simpler than sliding window, best for APIs with strict per-second limits.
 *
 * Best for APIs with "1 request per X seconds" limits (e.g., MusicBrainz: 1 req/s)
 *
 * @example
 * const limiter = new SimpleDelayRateLimiter(1500) // 1.5 seconds between requests
 * await limiter.waitForSlot()
 * await fetch(...)
 */
export class SimpleDelayRateLimiter implements RateLimiter {
  private lastScheduledTime = 0
  private readonly baseDelayMs: number
  private currentDelayMs: number
  private readonly maxDelayMs: number
  private consecutiveSuccesses = 0
  private consecutiveAvailabilityFailures = 0
  private cooldownUntil = 0

  /**
   * @param delayMs Minimum milliseconds between requests
   * @param maxDelayMs Maximum adaptive delay after service errors
   */
  constructor(
    delayMs: number,
    maxDelayMs = 6000,
    private readonly availabilityCooldown?: { failureThreshold: number; durationMs: number }
  ) {
    this.baseDelayMs = delayMs
    this.currentDelayMs = delayMs
    this.maxDelayMs = maxDelayMs
  }

  async waitForSlot(): Promise<void> {
    const now = Date.now()
    if (this.cooldownUntil > 0 && this.cooldownUntil <= now) {
      this.cooldownUntil = 0
      this.consecutiveAvailabilityFailures = 0
    }
    const scheduledTime = Math.max(now, this.lastScheduledTime === 0 ? now : this.lastScheduledTime + this.currentDelayMs, this.cooldownUntil)
    this.lastScheduledTime = scheduledTime
    const waitMs = scheduledTime - now

    if (waitMs > 0) {
      await this.delay(waitMs)
    }
  }

  recordError(status: number): void {
    if ([429, 502, 503, 504].includes(status)) {
      this.currentDelayMs = Math.min(this.maxDelayMs, Math.max(this.currentDelayMs * 1.5, 3000))
      this.consecutiveSuccesses = 0
    }
    if ([502, 503, 504].includes(status) && this.availabilityCooldown) {
      this.consecutiveAvailabilityFailures++
      if (this.consecutiveAvailabilityFailures >= this.availabilityCooldown.failureThreshold && this.cooldownUntil === 0) {
        this.cooldownUntil = Date.now() + this.availabilityCooldown.durationMs
      }
    }
  }

  recordSuccess(): void {
    this.consecutiveAvailabilityFailures = 0
    this.consecutiveSuccesses++
    if (this.consecutiveSuccesses >= 5 && this.currentDelayMs > this.baseDelayMs) {
      this.currentDelayMs = Math.max(this.baseDelayMs, this.currentDelayMs - 500)
      this.consecutiveSuccesses = 0
    }
  }

  setDelay(delayMs: number): void {
    this.currentDelayMs = Math.max(this.baseDelayMs, delayMs)
  }

  getCurrentDelay(): number {
    return this.currentDelayMs
  }

  reset(): void {
    this.lastScheduledTime = 0
    this.currentDelayMs = this.baseDelayMs
    this.consecutiveSuccesses = 0
    this.consecutiveAvailabilityFailures = 0
    this.cooldownUntil = 0
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Get current state
   */
  getTimeSinceLastRequest(): number {
    if (this.lastScheduledTime === 0) return Infinity
    return Date.now() - this.lastScheduledTime
  }
}

/**
 * Pre-configured rate limiters for known APIs
 */
export const RateLimiters = {
  /**
   * TMDB API: ~40 requests per second per IP
   * Using 40 req/1s to maximize throughput while staying within limits
   */
  createTMDBLimiter(maxRequests = 40, windowMs = 1000): SlidingWindowRateLimiter {
    return new SlidingWindowRateLimiter(maxRequests, windowMs, 25)
  },

  /**
   * MusicBrainz API: 1 request per second (strict enforcement)
   * Using 1.5s to be safe and respectful of the service
   */
  createMusicBrainzLimiter(): SimpleDelayRateLimiter {
    const config = APP_CONFIG.musicBrainz
    return new SimpleDelayRateLimiter(config.requestIntervalMs, config.maxAdaptiveDelayMs, {
      failureThreshold: config.availabilityFailuresBeforeCooldown,
      durationMs: config.availabilityCooldownMs,
    })
  },
}
