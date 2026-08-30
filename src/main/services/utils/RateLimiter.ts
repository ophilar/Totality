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

  /**
   * @param maxRequests Maximum number of requests allowed in the window
   * @param windowMs Time window in milliseconds
   * @param bufferMs Extra buffer time to add after waiting (default: 100ms)
   */
  constructor(maxRequests: number, windowMs: number, bufferMs: number = 100) {
    this.maxRequests = maxRequests
    this.windowMs = windowMs
    this.bufferMs = bufferMs
  }

  async waitForSlot(): Promise<void> {
    while (true) {
      const now = Date.now()

      // Remove timestamps outside the window
      this.requestTimestamps = this.requestTimestamps.filter(
        timestamp => now - timestamp < this.windowMs
      )

      // If not at capacity, we can record the slot and proceed
      if (this.requestTimestamps.length < this.maxRequests) {
        break
      }

      // If at capacity, wait until oldest request expires
      const oldestTimestamp = this.requestTimestamps[0]
      const waitTime = this.windowMs - (now - oldestTimestamp) + this.bufferMs

      if (waitTime > 0) {
        await this.delay(waitTime)
      } else {
        // Yield to the event loop briefly to prevent busy loop in edge cases
        await this.delay(1)
      }
    }

    // Record this request
    this.requestTimestamps.push(Date.now())
  }

  reset(): void {
    this.requestTimestamps = []
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
      maxRequests: this.maxRequests,
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
  private lastScheduledTime: number = 0
  private readonly baseDelayMs: number
  private currentDelayMs: number
  private readonly maxDelayMs: number
  private consecutiveSuccesses: number = 0

  /**
   * @param delayMs Minimum milliseconds between requests
   * @param maxDelayMs Maximum milliseconds delay when backing off (default: 6000ms)
   */
  constructor(delayMs: number, maxDelayMs: number = 6000) {
    this.baseDelayMs = delayMs
    this.currentDelayMs = delayMs
    this.maxDelayMs = maxDelayMs
  }

  async waitForSlot(): Promise<void> {
    const now = Date.now()
    // Schedule slots sequentially: whichever is later, current timestamp or previous scheduled + currentDelayMs
    const scheduledTime = Math.max(now, this.lastScheduledTime === 0 ? now : this.lastScheduledTime + this.currentDelayMs)
    this.lastScheduledTime = scheduledTime
    const waitMs = scheduledTime - now

    if (waitMs > 0) {
      await this.delay(waitMs)
    }
  }

  /**
   * Adaptively back off when an upstream rate limit (429) or service overload (503/502/504) occurs
   */
  recordError(status?: number): void {
    if (status === 429 || status === 503 || status === 502 || status === 504) {
      this.currentDelayMs = Math.min(this.maxDelayMs, Math.max(this.currentDelayMs * 1.5, 3000))
      this.consecutiveSuccesses = 0
    }
  }

  /**
   * Gradually recover back toward base delay after sustained success
   */
  recordSuccess(): void {
    this.consecutiveSuccesses++
    if (this.consecutiveSuccesses >= 5 && this.currentDelayMs > this.baseDelayMs) {
      this.currentDelayMs = Math.max(this.baseDelayMs, this.currentDelayMs - 500)
      this.consecutiveSuccesses = 0
    }
  }

  /**
   * Directly set or override current pacing delay (e.g. from Retry-After header)
   */
  setDelay(delayMs: number): void {
    this.currentDelayMs = Math.min(this.maxDelayMs, Math.max(this.baseDelayMs, delayMs))
  }

  getCurrentDelay(): number {
    return this.currentDelayMs
  }

  reset(): void {
    this.lastScheduledTime = 0
    this.currentDelayMs = this.baseDelayMs
    this.consecutiveSuccesses = 0
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
  createTMDBLimiter(maxRequests: number = 40, windowMs: number = 1000): SlidingWindowRateLimiter {
    return new SlidingWindowRateLimiter(maxRequests, windowMs, 25)
  },

  /**
   * MusicBrainz API: 1 request per second (strict enforcement)
   * Using 1.5s to be safe and respectful of the service
   */
  createMusicBrainzLimiter(): SimpleDelayRateLimiter {
    return new SimpleDelayRateLimiter(1500)
  },
}
