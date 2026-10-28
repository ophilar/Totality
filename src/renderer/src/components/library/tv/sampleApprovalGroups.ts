import type { ShowTranscodePreflight } from '../transcoding/types'

export interface SampleApprovalGroup {
  id: string
  representativeMediaItemId: number
  representativeLabel: string
  samplePaths: string[]
  sampleHashes: string[]
  episodes: ShowTranscodePreflight['episodes']
}

export function buildSampleApprovalGroups(preflight: ShowTranscodePreflight | null): SampleApprovalGroup[] {
  const groups = new Map<string, SampleApprovalGroup>()
  for (const item of preflight?.episodes ?? []) {
    if (!item.compatible || item.decisionStatus !== 'sample_required' || !item.samplePaths?.length) continue
    const representativeMediaItemId = item.sampleRepresentativeMediaItemId ?? item.mediaItemId
    const sampleHashes = item.sampleHashes ?? []
    const id = JSON.stringify([representativeMediaItemId, sampleHashes])
    const group = groups.get(id)
    if (group) {
      group.episodes.push(item)
    } else {
      groups.set(id, {
        id,
        representativeMediaItemId,
        representativeLabel: item.sampleRepresentativeLabel ?? item.label,
        samplePaths: item.samplePaths,
        sampleHashes,
        episodes: [item],
      })
    }
  }
  return [...groups.values()]
}
