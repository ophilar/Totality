export interface PacketByteRecord {
  streamIndex: number
  bytes: number | null
  durationSeconds?: number
}

export function parsePacketByteLine(line: string): PacketByteRecord | null {
  const normalizedLine = line.trim()
  if (!normalizedLine) return null
  const fields = normalizedLine.split('|')
  if (fields[0] !== 'packet') throw new Error(`Invalid FFprobe packet section: ${normalizedLine}`)

  const packetFields = new Map<string, string>()
  for (const field of fields.slice(1)) {
    if (!field) continue
    if (field === 'side_data' || field.startsWith('side_data_')) break
    if (!field.includes('=')) throw new Error(`Invalid FFprobe packet field '${field}': ${normalizedLine}`)
    const separator = field.indexOf('=')
    const key = field.slice(0, separator)
    const value = field.slice(separator + 1)
    if (packetFields.has(key)) throw new Error(`Duplicate FFprobe packet field '${key}': ${normalizedLine}`)
    packetFields.set(key, value)
  }

  const rawStreamIndex = packetFields.get('stream_index')
  if (rawStreamIndex === undefined || rawStreamIndex === '') {
    throw new Error(`FFprobe packet is missing stream_index: ${normalizedLine}`)
  }
  const streamIndex = Number(rawStreamIndex)
  const rawBytes = packetFields.get('size')?.trim()
  if (!Number.isSafeInteger(streamIndex) || streamIndex < 0) {
    throw new Error(`Invalid packet byte stream index: ${normalizedLine}`)
  }
  if (rawBytes === undefined || rawBytes === 'N/A' || rawBytes === '') return { streamIndex, bytes: null }
  const bytes = Number(rawBytes)
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error(`Invalid packet byte value: ${normalizedLine}`)
  }
  const rawDuration = packetFields.get('duration_time')?.trim()
  if (rawDuration === undefined || rawDuration === '' || rawDuration === 'N/A') return { streamIndex, bytes }
  const durationSeconds = Number(rawDuration)
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
    throw new Error(`Invalid packet duration: ${normalizedLine}`)
  }
  return { streamIndex, bytes, durationSeconds }
}

export function parsePacketByteOutput(output: string): PacketByteRecord[] {
  return output.split(/\r?\n/)
    .map(parsePacketByteLine)
    .filter((record): record is PacketByteRecord => record !== null)
}

export function sumStreamBytes(records: PacketByteRecord[], streamIndex: number): number | null {
  const streamRecords = records.filter(record => record.streamIndex === streamIndex)
  if (streamRecords.length === 0 || streamRecords.some(record => record.bytes === null)) return null
  return streamRecords.reduce((sum, record) => {
    const total = sum + record.bytes!
    if (!Number.isSafeInteger(total)) throw new Error(`Packet byte total exceeds the safe integer range for stream ${streamIndex}`)
    return total
  }, 0)
}

function addPacketByteRecord(totals: Map<number, { bytes: number; complete: boolean }>, record: PacketByteRecord): void {
  const total = totals.get(record.streamIndex) ?? { bytes: 0, complete: true }
  if (record.bytes === null) {
    total.complete = false
  } else {
    total.bytes += record.bytes
    if (!Number.isSafeInteger(total.bytes)) {
      throw new Error(`Packet byte total exceeds the safe integer range for stream ${record.streamIndex}`)
    }
  }
  totals.set(record.streamIndex, total)
}

export function toStreamByteMap(records: PacketByteRecord[]): Record<number, number> {
  const totals = new Map<number, { bytes: number; complete: boolean }>()
  for (const record of records) addPacketByteRecord(totals, record)

  return Object.fromEntries([...totals].filter(([, total]) => total.complete).map(([index, total]) => [index, total.bytes]))
}

export interface PacketBitrateMetrics {
  peakBitrate: number
  avgBitrate: number
  bitrateVariance: number
  isVariableBitrate: boolean
}

class PacketBitrateAccumulator {
  private readonly windowSize = 1
  private currentWindowBytes = 0
  private currentWindowDuration = 0
  private readonly windowQueue: Array<{ bytes: number; duration: number }> = []
  private totalBytes = 0
  private totalDuration = 0
  private maxBitrate = 0
  private sampleCount = 0
  private sumBitrates = 0
  private sumSquaredBitrates = 0
  private packetCount = 0

  add(record: PacketByteRecord): void {
    this.packetCount++
    if (record.bytes === null || record.durationSeconds === undefined) return

    const { bytes, durationSeconds: duration } = record
    this.totalBytes += bytes
    this.totalDuration += duration
    this.currentWindowBytes += bytes
    this.currentWindowDuration += duration
    this.windowQueue.push({ bytes, duration })

    while (this.currentWindowDuration > this.windowSize && this.windowQueue.length > 0) {
      const first = this.windowQueue.shift()!
      this.currentWindowBytes -= first.bytes
      this.currentWindowDuration -= first.duration
    }

    if (this.currentWindowDuration > 0.5) {
      const bitrate = (this.currentWindowBytes * 8) / this.currentWindowDuration / 1000
      this.maxBitrate = Math.max(this.maxBitrate, bitrate)
      this.sampleCount++
      this.sumBitrates += bitrate
      this.sumSquaredBitrates += bitrate * bitrate
    }
  }

  finish(): PacketBitrateMetrics {
    if (this.packetCount < 10 || this.totalDuration <= 0 || this.sampleCount === 0) {
      throw new Error('Insufficient data for bitrate analysis')
    }

    const average = (this.totalBytes * 8) / this.totalDuration / 1000
    const averageSquaredDifference = this.sumSquaredBitrates / this.sampleCount -
      2 * average * this.sumBitrates / this.sampleCount + average * average
    const standardDeviation = Math.sqrt(Math.max(0, averageSquaredDifference))

    return {
      peakBitrate: Math.round(this.maxBitrate),
      avgBitrate: Math.round(average),
      bitrateVariance: Math.round(standardDeviation),
      isVariableBitrate: standardDeviation > average * 0.1,
    }
  }
}

export class StreamByteAccumulator {
  private pendingLine = ''
  private readonly totals = new Map<number, { bytes: number; complete: boolean }>()
  private targetVideoStreamIndex: number | undefined
  private findFirstPacketStream: boolean
  private bitrate: PacketBitrateAccumulator | null = null

  constructor(videoStreamIndex?: number | 'first') {
    this.findFirstPacketStream = videoStreamIndex === 'first'
    if (typeof videoStreamIndex === 'number') {
      this.targetVideoStreamIndex = videoStreamIndex
      this.bitrate = new PacketBitrateAccumulator()
    }
  }

  write(chunk: string): void {
    const lines = (this.pendingLine + chunk).split(/\r?\n/)
    this.pendingLine = lines.pop() ?? ''
    for (const line of lines) this.addLine(line)
  }

  finish(): Record<number, number> {
    this.addLine(this.pendingLine)
    this.pendingLine = ''
    return Object.fromEntries([...this.totals].filter(([, total]) => total.complete).map(([index, total]) => [index, total.bytes]))
  }

  finishWithBitrate(): { streamBytes: Record<number, number>; bitrate?: PacketBitrateMetrics } {
    const streamBytes = this.finish()
    return { streamBytes, ...(this.bitrate ? { bitrate: this.bitrate.finish() } : {}) }
  }

  private addLine(line: string): void {
    const record = parsePacketByteLine(line)
    if (!record) return
    addPacketByteRecord(this.totals, record)
    if (this.findFirstPacketStream) {
      this.targetVideoStreamIndex = record.streamIndex
      this.findFirstPacketStream = false
      this.bitrate = new PacketBitrateAccumulator()
    }
    if (record.streamIndex === this.targetVideoStreamIndex) this.bitrate?.add(record)
  }
}
