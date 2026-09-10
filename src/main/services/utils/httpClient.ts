/**
 * httpClient — lightweight fetch wrapper replacing axios
 *
 * Provides timeout support via AbortController, query param serialization,
 * and a typed HttpError for non-ok responses — covering the full axios
 * surface used in this codebase.
 */

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly data: unknown,
    message: string
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export function isHttpError(e: unknown): e is HttpError {
  return e instanceof HttpError
}

/**
 * Appends a params object as a query string to a URL.
 * Skips null/undefined values.
 */
export function buildUrl(
  base: string,
  params?: Record<string, string | number | boolean | null | undefined>
): string {
  if (!params) return base
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) {
      qs.set(key, String(value))
    }
  }
  const str = qs.toString()
  if (!str) return base
  return base.includes('?') ? `${base}&${str}` : `${base}?${str}`
}

/**
 * fetch() wrapped with an AbortController timeout.
 * Throws DOMException (AbortError) if the timeout fires.
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 30_000
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export interface FetchJSONOptions extends RequestInit {
  /** Query string params — appended to the URL */
  params?: Record<string, string | number | boolean | null | undefined>
  /** Request timeout in ms (default 30 000) */
  timeoutMs?: number
  /**
   * HTTP status codes that should NOT throw HttpError even when !response.ok.
   * Useful for endpoints that legitimately return 404 (e.g. MusicBrainz).
   */
  allowStatuses?: number[]
}

/**
 * Fetch a URL and return the parsed JSON body.
 * Throws HttpError (with status + data) on non-ok responses,
 * unless the status is listed in allowStatuses.
 */
export async function fetchJSON<T>(
  url: string,
  options: FetchJSONOptions = {}
): Promise<T> {
  const { params, timeoutMs = 30_000, allowStatuses, ...init } = options
  const finalUrl = buildUrl(url, params)
  const response = await fetchWithTimeout(finalUrl, init, timeoutMs)

  if (!response.ok && !allowStatuses?.includes(response.status)) {
    let data: unknown = null
    try {
      data = await response.json()
    } catch {
      data = await response.text().catch(() => null)
    }
    throw new HttpError(response.status, data, `HTTP ${response.status}: ${response.statusText}`)
  }

  if (response.status === 204) return null as T
  return response.json() as Promise<T>
}

/**
 * Build a Basic Auth header value from username + password.
 */
export function basicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
}
