import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { GeminiService, RateLimitError } from '../../src/main/services/GeminiService'

type GeminiInternals = GeminiService & {
  extractRetrySeconds: (headers: unknown) => number | null
  handleApiError: (error: unknown) => never
  checkRateLimit: () => void
}

vi.mock('@main/database/BetterSQLiteService', () => ({
  getDatabase: vi.fn(() => ({
    config: {
      getSetting: vi.fn(),
    }
  }))
}))

vi.mock('@main/services/LoggingService', () => ({
  getLoggingService: vi.fn(() => ({
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }))
}))

describe('GeminiService', () => {
  let service: GeminiService

  beforeEach(() => {
    service = new GeminiService()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Rate Limit Parsing', () => {
    it('should extract retry-after-ms correctly', () => {
      const headers = { get: (name: string) => name === 'retry-after-ms' ? '2500' : null }
      const result = (service as unknown as GeminiInternals).extractRetrySeconds(headers)
      expect(result).toBe(3) // Math.ceil(2500 / 1000)
    })

    it('should extract retry-after in seconds correctly', () => {
      const headers = { get: (name: string) => name === 'retry-after' ? '30' : null }
      const result = (service as unknown as GeminiInternals).extractRetrySeconds(headers)
      expect(result).toBe(30)
    })

    it('should extract retry-after in HTTP-date format correctly', () => {
      const futureDate = new Date('2024-01-01T12:01:00Z').toUTCString()
      const headers = { get: (name: string) => name === 'retry-after' ? futureDate : null }
      const result = (service as unknown as GeminiInternals).extractRetrySeconds(headers)
      expect(result).toBe(60) // 60 seconds diff
    })

    it('should return null for missing or invalid headers', () => {
      expect((service as unknown as GeminiInternals).extractRetrySeconds(null)).toBeNull()
      expect((service as unknown as GeminiInternals).extractRetrySeconds({})).toBeNull()
      const headersInvalid = { get: (name: string) => name === 'retry-after' ? 'invalid' : null }
      expect((service as unknown as GeminiInternals).extractRetrySeconds(headersInvalid)).toBeNull()
    })
  })

  describe('Rate Limiting State', () => {
    it('should set rate limit state and throw RateLimitError on 429 status', () => {
      const headers = { get: (name: string) => name === 'retry-after' ? '120' : null }
      const error429 = { status: 429, headers }

      expect(() => (service as unknown as GeminiInternals).handleApiError(error429)).toThrow(RateLimitError)

      const limitInfo = service.getRateLimitInfo()
      expect(limitInfo.limited).toBe(true)
      expect(limitInfo.retryAfterSeconds).toBe(120)
    })

    it('should clear rate limit after the specified time passes', () => {
      const headers = { get: (name: string) => name === 'retry-after' ? '10' : null }
      const error429 = { status: 429, headers }

      try { (service as unknown as GeminiInternals).handleApiError(error429) } catch (e) {}

      expect(service.getRateLimitInfo().limited).toBe(true)

      vi.advanceTimersByTime(11000) // Advance by 11 seconds

      expect(service.getRateLimitInfo().limited).toBe(false)
      expect(service.getRateLimitInfo().retryAfterSeconds).toBe(0)
    })

    it('should prevent requests via checkRateLimit when rate limited', () => {
      const headers = { get: (name: string) => name === 'retry-after' ? '30' : null }
      const error429 = { status: 429, headers }

      try { (service as unknown as GeminiInternals).handleApiError(error429) } catch (e) {}

      expect(() => (service as unknown as GeminiInternals).checkRateLimit()).toThrow(RateLimitError)

      vi.advanceTimersByTime(31000)

      expect(() => (service as unknown as GeminiInternals).checkRateLimit()).not.toThrow()
    })

    it('should handle fallback to 15 seconds if retry-after is missing', () => {
       const error429 = { status: 429 }
       try { (service as unknown as GeminiInternals).handleApiError(error429) } catch (e) {}
       const limitInfo = service.getRateLimitInfo()
       expect(limitInfo.retryAfterSeconds).toBe(15)
    })

    it('should throw RateLimitError when error message contains RESOURCE_EXHAUSTED', () => {
       const errorExhausted = new Error('Some RESOURCE_EXHAUSTED error from sdk')
       const errorWithHeaders = Object.assign(errorExhausted, { headers: { get: (name: string) => name === 'retry-after' ? '25' : null } })

       expect(() => (service as unknown as GeminiInternals).handleApiError(errorWithHeaders)).toThrow(RateLimitError)

       const limitInfo = service.getRateLimitInfo()
       expect(limitInfo.retryAfterSeconds).toBe(25)
    })
  })
})
