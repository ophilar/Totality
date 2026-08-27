import { normalizeHdrFormatValue } from '@main/types/mediaContracts'

/** Keep dynamic HDR formats distinct from the base HDR10 label. */
export function formatHdrLabel(value?: string | null): string | undefined {
  const normalized = normalizeHdrFormatValue(value)
  return normalized === 'SDR' ? undefined : normalized
}
