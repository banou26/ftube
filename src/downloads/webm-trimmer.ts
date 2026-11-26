import type { TrimRange } from './trim'

const ID_EBML = 0x1a45dfa3
const ID_SEGMENT = 0x18538067
const ID_SEEK_HEAD = 0x114d9b74
const ID_INFO = 0x1549a966
const ID_TRACKS = 0x1654ae6b
const ID_CUES = 0x1c53bb6b
const ID_CLUSTER = 0x1f43b675
const ID_TIMECODE_SCALE = 0x2ad7b1
const ID_DURATION = 0x4489
const ID_TIMESTAMP = 0xe7
const ID_SIMPLE_BLOCK = 0xa3
const ID_BLOCK_GROUP = 0xa0
const ID_BLOCK = 0xa1
const ID_BLOCK_DURATION = 0x9b

type EbmlElement = {
  id: number
  headerStart: number
  dataStart: number
  dataEnd: number
  raw: Uint8Array
}

type ExtractedBlock = {
  kind: 'simple' | 'group'
  trackNumBytes: Uint8Array
  absMs: number
  restBytes: Uint8Array
  durationMs?: number
  extraElements: Uint8Array[]
}

const concatChunks = (chunks: readonly Uint8Array[]): Uint8Array => {
  if (chunks.length === 1) return chunks[0]!
  let total = 0
  for (const chunk of chunks) total += chunk.byteLength
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

const readVintId = (bytes: Uint8Array, offset: number): { id: number, length: number } | undefined => {
  if (offset >= bytes.byteLength) return undefined
  const first = bytes[offset]!
  if (first === 0) return undefined
  let length = 1
  let mask = 0x80
  while ((first & mask) === 0 && length < 4) {
    mask >>= 1
    length += 1
  }
  if ((first & mask) === 0 || offset + length > bytes.byteLength) return undefined
  let id = 0
  for (let i = 0; i < length; i += 1) {
    id = id * 256 + bytes[offset + i]!
  }
  return { id, length }
}

const readVintValue = (
  bytes: Uint8Array,
  offset: number,
): { value: number | undefined, length: number } | undefined => {
  if (offset >= bytes.byteLength) return undefined
  const first = bytes[offset]!
  if (first === 0) return undefined
  let length = 1
  let mask = 0x80
  while ((first & mask) === 0 && length < 8) {
    mask >>= 1
    length += 1
  }
  if ((first & mask) === 0 || offset + length > bytes.byteLength) return undefined
  let value = first & (mask - 1)
  let allOnes = value === mask - 1
  for (let i = 1; i < length; i += 1) {
    const byte = bytes[offset + i]!
    if (byte !== 0xff) allOnes = false
    value = value * 256 + byte
  }
  return { value: allOnes ? undefined : value, length }
}

const readUnsignedInt = (bytes: Uint8Array, start: number, end: number): number => {
  let value = 0
  for (let i = start; i < end; i += 1) {
    value = value * 256 + bytes[i]!
  }
  return value
}

const encodeId = (id: number): Uint8Array => {
  if (id <= 0xff) return Uint8Array.from([id])
  if (id <= 0xffff) return Uint8Array.from([(id >>> 8) & 0xff, id & 0xff])
  if (id <= 0xffffff) return Uint8Array.from([(id >>> 16) & 0xff, (id >>> 8) & 0xff, id & 0xff])
  return Uint8Array.from([(id >>> 24) & 0xff, (id >>> 16) & 0xff, (id >>> 8) & 0xff, id & 0xff])
}

const encodeVintSize = (size: number): Uint8Array => {
  if (size < 0x7f) return Uint8Array.from([0x80 | size])
  if (size < 0x3fff) return Uint8Array.from([0x40 | (size >>> 8), size & 0xff])
  if (size < 0x1fffff) return Uint8Array.from([0x20 | (size >>> 16), (size >>> 8) & 0xff, size & 0xff])
  if (size < 0x0fffffff) {
    return Uint8Array.from([0x10 | (size >>> 24), (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff])
  }
  const hi = Math.floor(size / 0x1_0000_0000)
  const lo = size >>> 0
  return Uint8Array.from([
    0x01,
    (hi >>> 16) & 0xff,
    (hi >>> 8) & 0xff,
    hi & 0xff,
    (lo >>> 24) & 0xff,
    (lo >>> 16) & 0xff,
    (lo >>> 8) & 0xff,
    lo & 0xff,
  ])
}

const encodeElement = (id: number, payload: Uint8Array): Uint8Array => {
  const idBytes = encodeId(id)
  const sizeBytes = encodeVintSize(payload.byteLength)
  const out = new Uint8Array(idBytes.byteLength + sizeBytes.byteLength + payload.byteLength)
  out.set(idBytes, 0)
  out.set(sizeBytes, idBytes.byteLength)
  out.set(payload, idBytes.byteLength + sizeBytes.byteLength)
  return out
}

const encodeUint = (value: number): Uint8Array => {
  if (value === 0) return Uint8Array.from([0])
  const bytes: number[] = []
  let cur = Math.floor(value)
  while (cur > 0) {
    bytes.unshift(cur & 0xff)
    cur = Math.floor(cur / 256)
  }
  return Uint8Array.from(bytes)
}

const encodeFloat64 = (value: number): Uint8Array => {
  const out = new Uint8Array(8)
  new DataView(out.buffer).setFloat64(0, value)
  return out
}

type IterateOptions = {
  unknownBoundaryIds?: ReadonlySet<number>
  stopOnIds?: ReadonlySet<number>
}

const iterateElements = (
  bytes: Uint8Array,
  start: number,
  end: number,
  options: IterateOptions = {},
): EbmlElement[] => {
  const out: EbmlElement[] = []
  let pos = start
  while (pos < end) {
    const idInfo = readVintId(bytes, pos)
    if (!idInfo) break
    if (options.stopOnIds && out.length > 0 && options.stopOnIds.has(idInfo.id)) break
    const sizeInfo = readVintValue(bytes, pos + idInfo.length)
    if (!sizeInfo) break
    const dataStart = pos + idInfo.length + sizeInfo.length
    let dataEnd: number
    if (sizeInfo.value === undefined) {
      dataEnd = end
      const scanStops = options.unknownBoundaryIds ?? options.stopOnIds
      if (scanStops) {
        let scan = dataStart
        while (scan < end) {
          const nextId = readVintId(bytes, scan)
          if (!nextId) break
          if (scanStops.has(nextId.id)) {
            dataEnd = scan
            break
          }
          const nextSize = readVintValue(bytes, scan + nextId.length)
          if (!nextSize) break
          if (nextSize.value === undefined) {
            // Nested unknown-size element (e.g. an unknown-size SimpleBlock/BlockGroup is invalid; recurse conservatively)
            scan += nextId.length + nextSize.length
            continue
          }
          scan = scan + nextId.length + nextSize.length + nextSize.value
        }
      }
    } else {
      dataEnd = Math.min(end, dataStart + sizeInfo.value)
    }
    out.push({
      id: idInfo.id,
      headerStart: pos,
      dataStart,
      dataEnd,
      raw: bytes.subarray(pos, dataEnd),
    })
    pos = dataEnd
  }
  return out
}

const TOP_LEVEL_SEGMENT_CHILDREN = new Set([
  ID_SEEK_HEAD,
  ID_INFO,
  ID_TRACKS,
  ID_CUES,
  ID_CLUSTER,
])

const parseBlockHeader = (
  bytes: Uint8Array,
  start: number,
  end: number,
  clusterMs: number,
  scaleMs: number,
) => {
  const trackVint = readVintValue(bytes, start)
  if (!trackVint || start + trackVint.length + 3 > end) return undefined
  const relOff = start + trackVint.length
  const relTime = new DataView(bytes.buffer, bytes.byteOffset + relOff, 2).getInt16(0)
  return {
    trackNumBytes: bytes.subarray(start, start + trackVint.length),
    absMs: clusterMs + relTime * scaleMs,
    restBytes: bytes.subarray(relOff + 2, end),
  }
}

const buildBlockPayload = (trackNumBytes: Uint8Array, relTicks: number, restBytes: Uint8Array): Uint8Array => {
  const out = new Uint8Array(trackNumBytes.byteLength + 2 + restBytes.byteLength)
  out.set(trackNumBytes, 0)
  new DataView(out.buffer, trackNumBytes.byteLength, 2).setInt16(0, relTicks)
  out.set(restBytes, trackNumBytes.byteLength + 2)
  return out
}

/** Trims a WebM audio stream (`chunks`) to `[trim.startMs, trim.endMs)` and rebases cluster timestamps to `0`. */
export const trimWebmAudio = (chunks: readonly Uint8Array[], trim: TrimRange): Uint8Array[] => {
  const bytes = concatChunks(chunks)
  const topElements = iterateElements(bytes, 0, bytes.byteLength)
  const ebmlHeader = topElements.find((entry) => entry.id === ID_EBML)
  const segment = topElements.find((entry) => entry.id === ID_SEGMENT)
  if (!ebmlHeader || !segment) {
    throw new Error('webm-trimmer: input is missing EBML or Segment header')
  }

  const segChildren = iterateElements(bytes, segment.dataStart, segment.dataEnd, {
    unknownBoundaryIds: TOP_LEVEL_SEGMENT_CHILDREN,
  })
  const infoEl = segChildren.find((entry) => entry.id === ID_INFO)
  const tracksEl = segChildren.find((entry) => entry.id === ID_TRACKS)
  if (!tracksEl) {
    throw new Error('webm-trimmer: input is missing Tracks element')
  }

  let timecodeScaleNs = 1_000_000
  const preservedInfoChildren: Uint8Array[] = []
  if (infoEl) {
    for (const child of iterateElements(bytes, infoEl.dataStart, infoEl.dataEnd)) {
      if (child.id === ID_TIMECODE_SCALE) {
        const val = readUnsignedInt(bytes, child.dataStart, child.dataEnd)
        if (val > 0) timecodeScaleNs = val
      } else if (child.id !== ID_DURATION) {
        preservedInfoChildren.push(child.raw)
      }
    }
  }
  const scaleMs = timecodeScaleNs / 1_000_000

  const blocks: ExtractedBlock[] = []
  for (const child of segChildren) {
    if (child.id !== ID_CLUSTER) continue
    let clusterTimeMs = 0
    for (const entry of iterateElements(bytes, child.dataStart, child.dataEnd, { stopOnIds: TOP_LEVEL_SEGMENT_CHILDREN })) {
      if (entry.id === ID_TIMESTAMP) {
        clusterTimeMs = readUnsignedInt(bytes, entry.dataStart, entry.dataEnd) * scaleMs
      } else if (entry.id === ID_SIMPLE_BLOCK) {
        const parsed = parseBlockHeader(bytes, entry.dataStart, entry.dataEnd, clusterTimeMs, scaleMs)
        if (parsed) {
          blocks.push({
            kind: 'simple',
            trackNumBytes: parsed.trackNumBytes,
            absMs: parsed.absMs,
            restBytes: parsed.restBytes,
            extraElements: [],
          })
        }
      } else if (entry.id === ID_BLOCK_GROUP) {
        let blockParsed: ReturnType<typeof parseBlockHeader> | undefined
        let durationMs: number | undefined
        const extras: Uint8Array[] = []
        for (const sub of iterateElements(bytes, entry.dataStart, entry.dataEnd)) {
          if (sub.id === ID_BLOCK) {
            blockParsed = parseBlockHeader(bytes, sub.dataStart, sub.dataEnd, clusterTimeMs, scaleMs)
          } else if (sub.id === ID_BLOCK_DURATION) {
            durationMs = readUnsignedInt(bytes, sub.dataStart, sub.dataEnd) * scaleMs
          } else {
            extras.push(sub.raw)
          }
        }
        if (blockParsed) {
          blocks.push({
            kind: 'group',
            trackNumBytes: blockParsed.trackNumBytes,
            absMs: blockParsed.absMs,
            restBytes: blockParsed.restBytes,
            durationMs,
            extraElements: extras,
          })
        }
      }
    }
  }

  for (let i = 0; i < blocks.length; i += 1) {
    const cur = blocks[i]!
    if (cur.durationMs !== undefined) continue
    const next = blocks[i + 1]
    if (next && next.absMs > cur.absMs) cur.durationMs = next.absMs - cur.absMs
    else if (i > 0 && cur.absMs > blocks[i - 1]!.absMs) cur.durationMs = cur.absMs - blocks[i - 1]!.absMs
    else cur.durationMs = 20
  }

  const kept = blocks.filter((block) => block.absMs >= trim.startMs && block.absMs < trim.endMs)
  if (kept.length === 0) {
    throw new Error('webm-trimmer: no audio frames found in selected range')
  }

  const baseMs = kept[0]!.absMs
  const lastBlock = kept[kept.length - 1]!
  const actualSpanMs = Math.max(1, lastBlock.absMs - baseMs + (lastBlock.durationMs ?? 20))
  const requestedSpanMs = Math.max(1, trim.endMs - trim.startMs)
  const outputDurationMs = Math.min(requestedSpanMs, actualSpanMs)

  // Rebuild Info using millisecond scale (1_000_000 ns) so rebased timestamps match Duration units directly.
  const nextInfoChildren = [
    encodeElement(ID_TIMECODE_SCALE, encodeUint(1_000_000)),
    encodeElement(ID_DURATION, encodeFloat64(outputDurationMs)),
    ...preservedInfoChildren,
  ]
  const nextInfo = encodeElement(ID_INFO, concatChunks(nextInfoChildren))

  const clusters: Uint8Array[] = []
  let currentClusterTs = Math.round(kept[0]!.absMs - baseMs)
  let currentClusterChildren: Uint8Array[] = [encodeElement(ID_TIMESTAMP, encodeUint(currentClusterTs))]

  for (const block of kept) {
    const absRebasedMs = Math.round(block.absMs - baseMs)
    let relMs = absRebasedMs - currentClusterTs
    if (relMs > 30_000 || relMs < -30_000) {
      clusters.push(encodeElement(ID_CLUSTER, concatChunks(currentClusterChildren)))
      currentClusterTs = Math.max(0, absRebasedMs)
      currentClusterChildren = [encodeElement(ID_TIMESTAMP, encodeUint(currentClusterTs))]
      relMs = absRebasedMs - currentClusterTs
    }
    const payload = buildBlockPayload(block.trackNumBytes, relMs, block.restBytes)
    if (block.kind === 'simple') {
      currentClusterChildren.push(encodeElement(ID_SIMPLE_BLOCK, payload))
    } else {
      const groupChildren = [encodeElement(ID_BLOCK, payload)]
      if (block.durationMs !== undefined) {
        groupChildren.push(encodeElement(ID_BLOCK_DURATION, encodeUint(Math.max(1, Math.round(block.durationMs)))))
      }
      groupChildren.push(...block.extraElements)
      currentClusterChildren.push(encodeElement(ID_BLOCK_GROUP, concatChunks(groupChildren)))
    }
  }
  if (currentClusterChildren.length > 1) {
    clusters.push(encodeElement(ID_CLUSTER, concatChunks(currentClusterChildren)))
  }

  // Re-emit Tracks verbatim from original Segment
  const nextSegment = encodeElement(ID_SEGMENT, concatChunks([nextInfo, tracksEl.raw, ...clusters]))
  return [ebmlHeader.raw, nextSegment]
}
