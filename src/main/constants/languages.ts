/**
 * Single Source of Truth (SSOT) for Language Normalization and Mappings
 * 
 * Supports ISO 639-1 (2-letter), ISO 639-2/B (3-letter bibliographic),
 * ISO 639-2/T (3-letter terminology), and ISO 639-3 codes.
 */

// Mapping of 3-letter codes, legacy codes, and aliases to canonical 2-letter ISO 639-1 codes
export const LANGUAGE_ALIASES_TO_2: Record<string, string> = {
  // English
  eng: 'en',
  en: 'en',

  // Hebrew
  heb: 'he',
  he: 'he',
  iw: 'he',

  // German
  deu: 'de',
  ger: 'de',
  de: 'de',

  // French
  fra: 'fr',
  fre: 'fr',
  fr: 'fr',

  // Spanish
  spa: 'es',
  es: 'es',

  // Italian
  ita: 'it',
  it: 'it',

  // Japanese
  jpn: 'ja',
  ja: 'ja',

  // Korean
  kor: 'ko',
  ko: 'ko',

  // Chinese
  zho: 'zh',
  chi: 'zh',
  zh: 'zh',
  cmn: 'zh',
  yue: 'zh',

  // Russian
  rus: 'ru',
  ru: 'ru',

  // Portuguese
  por: 'pt',
  pt: 'pt',

  // Dutch
  nld: 'nl',
  dut: 'nl',
  nl: 'nl',

  // Polish
  pol: 'pl',
  pl: 'pl',

  // Swedish
  swe: 'sv',
  sv: 'sv',

  // Norwegian
  nor: 'no',
  nob: 'no',
  nno: 'no',
  no: 'no',

  // Danish
  dan: 'da',
  da: 'da',

  // Finnish
  fin: 'fi',
  fi: 'fi',

  // Hindi
  hin: 'hi',
  hi: 'hi',

  // Arabic
  ara: 'ar',
  ar: 'ar',

  // Czech
  ces: 'cs',
  cze: 'cs',
  cs: 'cs',

  // Greek
  ell: 'el',
  gre: 'el',
  el: 'el',

  // Turkish
  tur: 'tr',
  tr: 'tr',

  // Vietnamese
  vie: 'vi',
  vi: 'vi',

  // Thai
  tha: 'th',
  th: 'th',

  // Hungarian
  hun: 'hu',
  hu: 'hu',

  // Indonesian
  ind: 'id',
  id: 'id',

  // Ukrainian
  ukr: 'uk',
  uk: 'uk',

  // Romanian
  ron: 'ro',
  rum: 'ro',
  ro: 'ro',

  // Bulgarian
  bul: 'bg',
  bg: 'bg',

  // Croatian
  hrv: 'hr',
  scr: 'hr',
  hr: 'hr',

  // Serbian
  srp: 'sr',
  scc: 'sr',
  sr: 'sr',

  // Slovak
  slk: 'sk',
  slo: 'sk',
  sk: 'sk',

  // Slovenian
  slv: 'sl',
  sl: 'sl',

  // Persian / Farsi
  fas: 'fa',
  per: 'fa',
  fa: 'fa',

  // Filipino / Tagalog
  tgl: 'tl',
  fil: 'tl',
  tl: 'tl',

  // Undetermined
  und: 'und',
  undetermined: 'und',
}

// Canonical 2-letter to ISO 639-2 standard 3-letter code mapping
export const ISO639_1_TO_3: Record<string, string> = {
  en: 'eng',
  he: 'heb',
  de: 'deu',
  fr: 'fra',
  es: 'spa',
  it: 'ita',
  ja: 'jpn',
  ko: 'kor',
  zh: 'zho',
  ru: 'rus',
  pt: 'por',
  nl: 'nld',
  pl: 'pol',
  sv: 'swe',
  no: 'nor',
  da: 'dan',
  fi: 'fin',
  hi: 'hin',
  ar: 'ara',
  cs: 'ces',
  el: 'ell',
  tr: 'tur',
  vi: 'vie',
  th: 'tha',
  hu: 'hun',
  id: 'ind',
  uk: 'ukr',
  ro: 'ron',
  bg: 'bul',
  hr: 'hrv',
  sr: 'srp',
  sk: 'slk',
  sl: 'slv',
  fa: 'fas',
  tl: 'tgl',
  und: 'und',
}

export const CANONICAL_LANGUAGE_CODES = [
  'en', 'he', 'ja', 'es', 'fr', 'de', 'it', 'ko', 'zh', 'ru',
  'pt', 'nl', 'pl', 'sv', 'no', 'da', 'fi', 'hi', 'ar', 'cs',
  'el', 'tr', 'vi', 'th', 'hu', 'id', 'uk', 'ro'
] as const

const languageDisplayNames =
  typeof Intl !== 'undefined' && Intl.DisplayNames
    ? new Intl.DisplayNames(['en'], { type: 'language' })
    : null

/**
 * Format language code (e.g. "en", "eng", "ja", "heb") to friendly human-readable name (e.g. "English", "Hebrew", "Japanese")
 */
export function formatLanguage(code?: string | null): string {
  if (!code) return 'Unknown'
  const normalized = normalizeLanguage(code)
  if (!normalized || normalized === 'und') return 'Undetermined / Untagged'
  try {
    return languageDisplayNames?.of(normalized) || code.toUpperCase()
  } catch {
    return code.toUpperCase()
  }
}

/**
 * Normalizes any language string to its canonical 2-letter ISO 639-1 code (or 3-letter if und/unmapped)
 */
export function normalizeLanguage(language?: string | null): string | null {
  if (!language) return null
  const cleaned = language.trim().toLowerCase().split(/[-_]/)[0]
  if (!cleaned) return null
  return LANGUAGE_ALIASES_TO_2[cleaned] || cleaned
}

/**
 * Converts any language code to standard 3-letter ISO 639-2 code (e.g. 'en' -> 'eng', 'he' -> 'heb')
 */
export function toIso639_2(language?: string | null): string | null {
  const norm2 = normalizeLanguage(language)
  if (!norm2) return null
  return ISO639_1_TO_3[norm2] || norm2
}

/**
 * Compares two language codes to see if they refer to the exact same language
 */
export function isSameLanguage(codeA?: string | null, codeB?: string | null): boolean {
  if (!codeA || !codeB) return false
  const normA = normalizeLanguage(codeA)
  const normB = normalizeLanguage(codeB)
  if (normA && normB && normA === normB) return true
  const nameA = formatLanguage(codeA)
  const nameB = formatLanguage(codeB)
  if (nameA !== 'Unknown' && nameA !== 'Undetermined / Untagged' && nameA === nameB) {
    return true
  }
  return false
}

export const LANGUAGE_OPTIONS = CANONICAL_LANGUAGE_CODES.map((code) => ({
  code,
  code3: ISO639_1_TO_3[code] || code,
  label: `${formatLanguage(code)} (${code})`,
}))
