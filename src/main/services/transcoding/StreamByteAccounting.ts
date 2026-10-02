export interface PacketByteRecord {
  streamIndex: number
  bytes: number | null
}

function parsePacketByteLine(line: string): PacketByteRecord | null {
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
  return { streamIndex, bytes }
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

export class StreamByteAccumulator {
  private pendingLine = ''
  private readonly totals = new Map<number, { bytes: number; complete: boolean }>()

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

  private addLine(line: string): void {
    const record = parsePacketByteLine(line)
    if (!record) return
    addPacketByteRecord(this.totals, record)
  }
}
