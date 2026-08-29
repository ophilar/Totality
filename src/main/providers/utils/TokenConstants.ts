// Extracted from VersionNaming and TitleMatching to ensure consistency across the app.

// Technical tokens that should NOT be treated as edition names
export const TECHNICAL_TOKENS = new Set([
  // Resolutions
  '480p', '576p', '720p', '1080p', '1080i', '2160p', '4k', 'uhd', 'sd', 'hd',
  // Sources
  'bluray', 'blu-ray', 'bdrip', 'brrip', 'remux', 'web-dl', 'webdl',
  'webrip', 'web', 'hdtv', 'pdtv', 'dvdrip', 'dvd', 'dvd-r',
  // Video codecs
  'x264', 'x265', 'h264', 'h265', 'h.264', 'h.265', 'hevc', 'avc',
  'av1', 'vp9', 'xvid', 'divx', 'mpeg-2', 'mpeg2', 'vc-1', 'vc1',
  // Audio codecs
  'dts', 'dts-hd', 'dts-hdma', 'dtsx', 'dts-x', 'dts:x',
  'truehd', 'atmos', 'dd+', 'ddp', 'dd', 'eac3', 'e-ac-3', 'ac3', 'ac-3',
  'aac', 'flac', 'lpcm', 'mp3', 'pcm', 'opus',
  // HDR
  'hdr', 'hdr10', 'hdr10+', 'hdr10plus', 'dv', 'hlg', 'sdr',
  // Other technical
  'proper', 'repack', 'internal', '10bit', '10-bit', '8bit', '8-bit',
  'hybrid', '5.1', '7.1', '2.0',
])

// Edition-like tokens that should be stripped when normalizing titles for matching
export const EDITION_TOKENS = new Set([
  'edition', 'special', 'theatrical', 'readnfo', 'sample', 'xxx', 'clip',
  'limited', 'extended', 'unrated', 'directors', 'cut', 'remastered',
  'criterion', 'multi', 'subbed', 'dubbed', 'complete'
])

// The union of technical and edition tokens, used for extracting the core title
export const NON_TITLE_TOKENS = new Set([
  ...TECHNICAL_TOKENS,
  ...EDITION_TOKENS
])
