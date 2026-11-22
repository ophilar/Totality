type RendererDiagnosticSource = 'TVOptimizationUI' | 'EncodingCapabilitiesUI'
type RendererDiagnosticLevel = 'info' | 'warn' | 'error'

export function logOptimizationDiagnostic(
  source: RendererDiagnosticSource,
  level: RendererDiagnosticLevel,
  event: string,
  details?: Record<string, unknown>
): void {
  void window.electronAPI.logRendererEvent({ level, source, event, details }).catch(error => {
    console.error(`[${source}] Could not persist diagnostic event "${event}"`, error)
  })
}

export function describeDiagnosticError(error: unknown): { message: string; stack?: string } {
  return error instanceof Error
    ? { message: error.message, stack: error.stack }
    : { message: String(error) }
}
