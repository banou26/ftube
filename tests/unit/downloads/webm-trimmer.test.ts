import { describe, expect, it } from 'vite-plus/test'

import { trimWebmAudio } from '../../../src/downloads/webm-trimmer'

const ebmlId = (bytes: readonly number[]) => Uint8Array.from(bytes)

const encodeVintSize = (value: number): Uint8Array => {
  if (value < 0x7f) return Uint8Array.from([0x80 | value])
  if (value < 0x3fff) return Uint8Array.from([0x40 | (value >>> 8), value & 0xff])
  return Uint8Array.from([0x20 | (value >>> 16), (value >>> 8) & 0xff, value & 0xff])
}

const element = (id: readonly number[], payload: Uint8Array): Uint8Array => {
  const idBytes = ebmlId(id)
  const sizeBytes = encodeVintSize(payload.byteLength)
  const out = new Uint8Array(idBytes.byteLength + sizeBytes.byteLength + payload.byteLength)
  out.set(idBytes, 0)
  out.set(sizeBytes, idBytes.byteLength)
  out.set(payload, idBytes.byteLength + sizeBytes.byteLength)
  return out
}

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const total = parts.reduce((sum, p) => sum + p.byteLength, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const part of parts) {
    out.set(part, off)
    off += part.byteLength
  }
  return out
}

const uintPayload = (value: number): Uint8Array => {
  if (value <= 0xff) return Uint8Array.from([value])
  if (value <= 0xffff) return Uint8Array.from([(value >>> 8) & 0xff, value & 0xff])
  if (value <= 0xffffff) return Uint8Array.from([(value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff])
  return Uint8Array.from([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff])
}

const float64Payload = (value: number): Uint8Array => {
  const buf = new Uint8Array(8)
  new DataView(buf.buffer).setFloat64(0, value)
  return buf
}

const simpleBlock = (trackNum: number, relTime: number, frame: Uint8Array): Uint8Array => {
  const header = new Uint8Array(4)
  header[0] = 0x80 | trackNum
  new DataView(header.buffer).setInt16(1, relTime)
  header[3] = 0x80
  return element([0xa3], concat([header, frame]))
}

const parseTopAndSegment = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let pos = 0
  const readId = () => {
    const first = bytes[pos]!
    const len = first & 0x80 ? 1 : first & 0x40 ? 2 : first & 0x20 ? 3 : 4
    let val = 0
    for (let i = 0; i < len; i += 1) val = val * 256 + bytes[pos + i]!
    pos += len
    return val
  }
  const readSize = () => {
    const first = bytes[pos]!
    let len = 1
    let mask = 0x80
    while ((first & mask) === 0 && len < 8) {
      mask >>= 1
      len += 1
    }
    let val = first & (mask - 1)
    for (let i = 1; i < len; i += 1) val = val * 256 + bytes[pos + i]!
    pos += len
    return val
  }

  expect(readId()).toBe(0x1a45dfa3)
  const ebmlSize = readSize()
  pos += ebmlSize
  expect(readId()).toBe(0x18538067)
  const segSize = readSize()
  const segEnd = pos + segSize

  let durationMs: number | undefined
  let tracksSeen = false
  const blocks: { absMs: number, payload: number[] }[] = []

  while (pos < segEnd) {
    const id = readId()
    const size = readSize()
    const end = pos + size
    if (id === 0x1549a966) {
      while (pos < end) {
        const subId = readId()
        const subSize = readSize()
        if (subId === 0x4489 && subSize === 8) {
          durationMs = view.getFloat64(pos)
        }
        pos += subSize
      }
    } else if (id === 0x1654ae6b) {
      tracksSeen = true
      pos = end
    } else if (id === 0x1f43b675) {
      let clusterTs = 0
      while (pos < end) {
        const subId = readId()
        const subSize = readSize()
        const subEnd = pos + subSize
        if (subId === 0xe7) {
          clusterTs = 0
          for (let i = 0; i < subSize; i += 1) clusterTs = clusterTs * 256 + bytes[pos + i]!
        } else if (subId === 0xa3) {
          const rel = view.getInt16(pos + 1)
          const payload = [...bytes.subarray(pos + 4, subEnd)]
          blocks.push({ absMs: clusterTs + rel, payload })
        }
        pos = subEnd
      }
    } else {
      pos = end
    }
  }

  return { durationMs, tracksSeen, blocks }
}

describe('trimWebmAudio', () => {
  const buildFixture = () => {
    const ebml = element([0x1a, 0x45, 0xdf, 0xa3], element([0x42, 0x86], Uint8Array.from([1])))
    const info = element(
      [0x15, 0x49, 0xa9, 0x66],
      concat([
        element([0x2a, 0xd7, 0xb1], uintPayload(1_000_000)),
        element([0x44, 0x89], float64Payload(5_000)),
      ]),
    )
    const tracks = element([0x16, 0x54, 0xae, 0x6b], element([0xae], element([0xd7], Uint8Array.from([1]))))
    const cluster1 = element(
      [0x1f, 0x43, 0xb6, 0x75],
      concat([
        element([0xe7], uintPayload(0)),
        simpleBlock(1, 0, Uint8Array.from([10])),
        simpleBlock(1, 1000, Uint8Array.from([20])),
      ]),
    )
    const cluster2 = element(
      [0x1f, 0x43, 0xb6, 0x75],
      concat([
        element([0xe7], uintPayload(2000)),
        simpleBlock(1, 0, Uint8Array.from([30])),
        simpleBlock(1, 1000, Uint8Array.from([40])),
        simpleBlock(1, 2000, Uint8Array.from([50])),
      ]),
    )
    return concat([ebml, element([0x18, 0x53, 0x80, 0x67], concat([info, tracks, cluster1, cluster2]))])
  }

  it('slices clusters/SimpleBlocks to the requested window, preserves Tracks, and rebases timestamps to 0', () => {
    const webm = buildFixture()
    const trimmed = concat(trimWebmAudio([webm], { startMs: 1_000, endMs: 3_000 }))
    const parsed = parseTopAndSegment(trimmed)

    expect(parsed.tracksSeen).toBe(true)
    expect(parsed.durationMs).toBe(2_000)
    expect(parsed.blocks).toEqual([
      { absMs: 0, payload: [20] },
      { absMs: 1_000, payload: [30] },
    ])
  })

  it('throws cleanly when no audio frames fall inside the requested trim window', () => {
    const webm = buildFixture()
    expect(() => trimWebmAudio([webm], { startMs: 10_000, endMs: 12_000 })).toThrow('webm-trimmer')
  })
})
