/**
 * Error Handling Utilities
 *
 * Type-safe error handling helpers for use across services and providers.
 */

/**
 * Get a consistent error message from any error type
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (error && typeof error === 'object' && 'message' in error && typeof (error as { message: unknown }).message === 'string') {
    return (error as { message: string }).message
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
 * Type guard for Axios errors (with response property)
 */
export function isAxiosError(error: unknown): error is { response?: { status: number; data?: unknown }; message: string } {
  return error instanceof Error && 'response' in error
}

/**
 * Extract axios error details for error handling
 * Returns response status, data, and message if available
 */
export function getAxiosErrorDetails(error: unknown): { status?: number; data?: unknown; message: string } {
  if (isAxiosError(error)) {
    return {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message
    }
  }
  return { message: getErrorMessage(error) }
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

export interface ParsedDatabaseError {
  isDatabaseError: boolean
  constraint?: string
  code?: string
  cause: string
}

/**
 * Decompose SQLite / LibSQL database errors to extract constraint name, code, and cause.
 */
export function parseDatabaseError(error: unknown): ParsedDatabaseError {
  const message = getErrorMessage(error)
  const causeMsg = error && typeof error === 'object' && 'cause' in error && error.cause
    ? getErrorMessage((error as { cause: unknown }).cause)
    : undefined

  const fullText = causeMsg ? `${message} (cause: ${causeMsg})` : message
  let code: string | undefined
  if (error && typeof error === 'object') {
    if ('code' in error && typeof (error as { code: unknown }).code === 'string') {
      code = (error as { code: string }).code
    } else if (error && typeof error === 'object' && 'cause' in error && typeof (error as { cause: { code?: unknown } }).cause?.code === 'string') {
      code = (error as { cause: { code: string } }).cause.code
    }
  }

  const isDb = /sqlite|constraint|unique|foreign key|busy|locked|database/i.test(fullText) || Boolean(code && /sqlite|constraint/i.test(code))

  let constraint: string | undefined
  const constraintMatch = fullText.match(/(?:UNIQUE|NOT NULL|FOREIGN KEY|CHECK)\s+constraint failed:\s*([^\r\n()]+)/i)
    || fullText.match(/constraint\s+([a-zA-Z0-9_]+)\s+failed/i)
  if (constraintMatch) {
    constraint = constraintMatch[1].trim()
  }

  return {
    isDatabaseError: isDb,
    constraint,
    code,
    cause: fullText,
  }
}
