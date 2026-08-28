export interface PacketByteRecord {
  streamIndex: number
  bytes: number | null
}

export function parsePacketByteOutput(output: string): PacketByteRecord[] {
  return output
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      const separator = line.indexOf(',')
      if (separator <= 0) throw new Error(`Invalid packet byte row: ${line}`)
      const streamIndex = Number(line.slice(0, separator))
      const rawBytes = line.slice(separator + 1).trim()
      if (!Number.isInteger(streamIndex) || streamIndex < 0) {
        throw new Error(`Invalid packet byte stream index: ${line}`)
      }
      if (rawBytes === 'N/A' || rawBytes === '') return { streamIndex, bytes: null }
      const bytes = Number(rawBytes)
      if (!Number.isSafeInteger(bytes) || bytes < 0) {
        throw new Error(`Invalid packet byte value: ${line}`)
      }
      return { streamIndex, bytes }
    })
}

export function sumStreamBytes(records: PacketByteRecord[], streamIndex: number): number | null {
  const streamRecords = records.filter(record => record.streamIndex === streamIndex)
  if (streamRecords.length === 0 || streamRecords.some(record => record.bytes === null)) return null
  return streamRecords.reduce((sum, record) => sum + record.bytes!, 0)
}

export function toStreamByteMap(records: PacketByteRecord[]): Record<number, number> {
  const map: Record<number, number> = {}
  const indexes = [...new Set(records.map(record => record.streamIndex))]
  for (const index of indexes) {
    const bytes = sumStreamBytes(records, index)
    if (bytes === null) continue
    map[index] = bytes
  }
  return map
}
