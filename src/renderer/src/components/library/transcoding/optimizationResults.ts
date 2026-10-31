export function sumKnownResultBytes(results: ReadonlyArray<Record<string, unknown>>, key: string): number | null {
  if (results.length === 0 || results.some(result => typeof result[key] !== 'number' || !Number.isFinite(result[key]))) return null
  return results.reduce((total, result) => total + (result[key] as number), 0)
}

export function formatOptimizationBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Not measured'
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}
