
/**
 * Error Handling Utilities
 *
 * Type-safe error handling helpers for use across services and providers.
 */

export { isHttpError, HttpError } from './httpClient'

/**
 * Get a consistent error message from any error type
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

/**
 * Type guard for Node.js system errors (with code property)
 */
export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

/**
 * Get error code for Node.js errors (ENOENT, ECONNREFUSED, etc.)
 */
export function getErrorCode(error: unknown): string | undefined {
  if (isNodeError(error)) {
    return error.code
  }
  return undefined
}
