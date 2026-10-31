export function optimizationCandidateReasonLabel(reason: string): string {
  switch (reason) {
    case 'h264_video_transcode': return 'H.264 video transcode'
    case 'hevc_to_av1': return 'H.265 to AV1; local hardware encoder available'
    case 'audio_stream_pruning': return 'Unpreferred audio tracks; protected tracks retained'
    case 'subtitle_stream_pruning': return 'Subtitles outside the preferred languages; forced tracks retained'
    case 'dolby_vision_profile_5_mp4_remux': return 'Dolby Vision Profile 5 needs an MP4 remux'
    default: return reason
  }
}
