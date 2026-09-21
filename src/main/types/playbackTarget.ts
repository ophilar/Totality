import type { FileAnalysisResult } from '@main/services/MediaFileAnalyzer'

export type PlaybackSource = 'provided-baseline' | 'user-declared' | 'local-analysis' | 'plex-decision'
export type PlaybackFindingStatus = 'compatible' | 'incompatible' | 'not-applicable'

export interface PlaybackTargetProfile {
  id: string
  name: string
  isBuiltin: boolean
  definition: PlaybackTargetDefinition
  createdAt: string
  updatedAt: string
}

export interface PlaybackTargetDefinition {
  containers: string[]
  video: { codecs: string[]; profiles: string[]; levels: number[]; maxWidth: number; maxHeight: number; maxFrameRate: number; bitDepths: number[]; containerRules?: Array<{ containers: string[]; codecs?: string[]; profiles?: string[]; hdrFormats?: string[] }> }
  hdr: { formats: string[]; fallbackRequired: boolean }
  audio: { codecs: string[]; maxChannels: number; objectAudio: boolean; outputPath: 'device' | 'passthrough' | 'receiver' }
  subtitles: { formats: string[]; embedded: boolean; external: boolean; burnIn: boolean }
  network: { sustainableBitrate: number }
  providers?: { plex?: { clientProduct: string; clientPlatform: string; clientVersion: string } }
}

export interface PlaybackFinding { status: PlaybackFindingStatus; rule: string; evidence: string; source: PlaybackSource }
export interface PlaybackTargetEvaluation { profileId: string; overall: 'compatible' | 'incompatible'; findings: Record<'container' | 'video' | 'hdr' | 'audio' | 'subtitle' | 'network', PlaybackFinding> }

export function evaluatePlaybackTarget(profile: PlaybackTargetProfile, analysis: FileAnalysisResult): PlaybackTargetEvaluation {
  if (!analysis.success) throw new Error(analysis.error || 'Media analysis failed')
  const video = analysis.video
  if (!video || !analysis.container || analysis.overallBitrate == null) throw new Error('Complete media analysis is required')
  const finding = (ok: boolean, rule: string, evidence: string): PlaybackFinding => ({ status: ok ? 'compatible' : 'incompatible', rule, evidence, source: 'local-analysis' })
  const matches = (value: string | undefined, expected: string[] | undefined): boolean => !expected || expected.some(candidate => value?.toLowerCase().includes(candidate.toLowerCase()))
  const d = profile.definition
  const matchingContainerRule = d.video.containerRules?.find(rule => matches(video.codec, rule.codecs) && matches(video.profile, rule.profiles) && matches(video.hdrFormat, rule.hdrFormats))
  const allowedContainers = matchingContainerRule?.containers ?? d.containers
  const findings = {
    container: finding(allowedContainers.includes(analysis.container), `container in [${allowedContainers.join(', ')}]`, analysis.container),
    video: finding(d.video.codecs.includes(video.codec) && d.video.profiles.includes(video.profile || '') && d.video.levels.includes(video.level || 0) && (video.width || 0) <= d.video.maxWidth && (video.height || 0) <= d.video.maxHeight && (video.frameRate || 0) <= d.video.maxFrameRate && d.video.bitDepths.includes(video.bitDepth || 0), 'video codec/profile/level/resolution/frame-rate/bit-depth supported', JSON.stringify(video)),
    hdr: finding(!video.hdrFormat || d.hdr.formats.includes(video.hdrFormat) || d.hdr.fallbackRequired, 'HDR format supported or fallback required', video.hdrFormat || 'SDR'),
    audio: finding(analysis.audioTracks.every(t => d.audio.codecs.includes(t.codec) && t.channels <= d.audio.maxChannels && (!t.hasObjectAudio || d.audio.objectAudio)), 'all audio tracks supported by codec/channel/object-audio policy', JSON.stringify(analysis.audioTracks)),
    subtitle: finding(analysis.subtitleTracks.length === 0 || (d.subtitles.embedded || d.subtitles.external), 'subtitle delivery explicitly supported', JSON.stringify(analysis.subtitleTracks)),
    network: finding(analysis.overallBitrate <= d.network.sustainableBitrate, `bitrate <= ${d.network.sustainableBitrate}`, String(analysis.overallBitrate)),
  }
  return { profileId: profile.id, overall: Object.values(findings).every(f => f.status !== 'incompatible') ? 'compatible' : 'incompatible', findings }
}
