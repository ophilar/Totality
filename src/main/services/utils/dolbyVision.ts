export function parseDolbyVisionProfile(...metadata: Array<string | null | undefined>): number | undefined {
  const value = metadata.filter((entry): entry is string => Boolean(entry)).join(' ').toLowerCase()
  const tokenProfile = value.match(/\b(?:dvhe|dvh1)[._-]0?(\d{1,2})\b/)
  const namedProfile = value.match(/\bdolby\s+vision\s+(?:profile\s*)?0?(\d{1,2})\b/)
  const profile = Number(tokenProfile?.[1] ?? namedProfile?.[1])
  return Number.isSafeInteger(profile) && profile > 0 ? profile : undefined
}
