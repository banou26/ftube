import { describe, expect, it } from 'vite-plus/test'

import { muxMp4 } from '../../../src/downloads/mp4-muxer'

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}

const u32 = (value: number): Uint8Array => {
  const buf = new Uint8Array(4)
  new DataView(buf.buffer).setUint32(0, value >>> 0)
  return buf
}

const box = (type: string, ...payloads: Uint8Array[]): Uint8Array => {
  const body = concat(payloads)
  const header = new Uint8Array(8)
  new DataView(header.buffer).setUint32(0, 8 + body.byteLength)
  for (let i = 0; i < 4; i += 1) header[4 + i] = type.charCodeAt(i)
  return concat([header, body])
}

const readUint32 = (bytes: Uint8Array, offset: number) =>
  new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0)

const listBoxes = (bytes: Uint8Array, start = 0, end = bytes.byteLength) => {
  const found: { type: string, start: number, size: number, data: Uint8Array }[] = []
  let offset = start
  while (offset + 8 <= end) {
    const size = readUint32(bytes, offset)
    const type = String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!)
    found.push({ type, start: offset, size, data: bytes.subarray(offset, offset + size) })
    offset += size
  }
  return found
}

const makeMvhd = (timescale = 1000, duration = 2000, nextTrackId = 2) => {
  const payload = new Uint8Array(100)
  const view = new DataView(payload.buffer)
  view.setUint32(12, timescale)
  view.setUint32(16, duration)
  view.setUint32(96, nextTrackId)
  return box('mvhd', payload)
}

const makeTkhd = (trackId: number) => {
  const payload = new Uint8Array(84)
  new DataView(payload.buffer).setUint32(12, trackId)
  return box('tkhd', payload)
}

const makeMdhd = (timescale: number) => {
  const payload = new Uint8Array(24)
  new DataView(payload.buffer).setUint32(12, timescale)
  return box('mdhd', payload)
}

const makeTrex = (trackId: number) => {
  const payload = new Uint8Array(24)
  const view = new DataView(payload.buffer)
  view.setUint32(4, trackId)
  view.setUint32(8, 1)
  return box('trex', payload)
}

const makeMoov = (trackId: number, timescale: number) =>
  box(
    'moov',
    makeMvhd(1000, 2000, trackId + 1),
    box('trak', makeTkhd(trackId), box('mdia', makeMdhd(timescale))),
    box('mvex', makeTrex(trackId)),
  )

const makeFragment = (trackId: number, seq: number, decodeTime: number, sampleBytes: number[]) => {
  const mfhdPayload = new Uint8Array(8)
  new DataView(mfhdPayload.buffer).setUint32(4, seq)

  const tfhdPayload = new Uint8Array(8)
  new DataView(tfhdPayload.buffer).setUint32(4, trackId)

  const tfdtPayload = new Uint8Array(8)
  new DataView(tfdtPayload.buffer).setUint32(4, decodeTime)

  const trunPayload = new Uint8Array(12)
  new DataView(trunPayload.buffer).setUint32(0, 0x000001)
  new DataView(trunPayload.buffer).setUint32(4, 1)
  new DataView(trunPayload.buffer).setUint32(8, 88)

  const moof = box(
    'moof',
    box('mfhd', mfhdPayload),
    box('traf', box('tfhd', tfhdPayload), box('tfdt', tfdtPayload), box('trun', trunPayload)),
  )
  const mdat = box('mdat', new Uint8Array(sampleBytes))
  return concat([moof, mdat])
}

describe('muxMp4', () => {
  it('merges video and audio init atoms, interleaves fragments chronologically, and renumbers tracks and sequences', () => {
    const ftyp = box('ftyp', u32(0x69736f36))
    const styp = box('styp', u32(0x6d736468))
    const sidx = box('sidx', new Uint8Array(16))

    const videoTrack = concat([
      ftyp,
      makeMoov(1, 90_000),
      styp,
      sidx,
      makeFragment(1, 1, 0, [1, 2, 3]),
      makeFragment(1, 2, 180_000, [4, 5, 6]),
    ])

    // Both streams start as track 1 in SABR single-track elementary outputs; muxMp4 must rewrite audio to track 2.
    const audioTrack = concat([
      box('ftyp', u32(0x69736f36)),
      makeMoov(1, 48_000),
      makeFragment(1, 1, 48_000, [10, 11]),
      makeFragment(1, 2, 144_000, [12, 13]),
    ])

    const split = (buf: Uint8Array) => [buf.subarray(0, 17), buf.subarray(17, 131), buf.subarray(131)]

    const muxed = concat(muxMp4(split(videoTrack), split(audioTrack)))
    const top = listBoxes(muxed)
    expect(top.map((item) => item.type)).toEqual([
      'ftyp',
      'moov',
      'moof', 'mdat',
      'moof', 'mdat',
      'moof', 'mdat',
      'moof', 'mdat',
    ])

    const moovChildren = listBoxes(top[1]!.data, 8)
    expect(moovChildren.map((child) => child.type)).toEqual(['mvhd', 'trak', 'trak', 'mvex'])

    expect(readUint32(moovChildren[0]!.data, moovChildren[0]!.size - 4)).toBe(3)

    const tkhdIds = [moovChildren[1]!, moovChildren[2]!].map((trak) => {
      const tkhd = listBoxes(trak.data, 8).find((b) => b.type === 'tkhd')!
      return readUint32(tkhd.data, 20)
    })
    expect(tkhdIds).toEqual([1, 2])

    const mvexChildren = listBoxes(moovChildren[3]!.data, 8)
    expect(mvexChildren.map((b) => b.type)).toEqual(['trex', 'trex'])
    expect(mvexChildren.map((trex) => readUint32(trex.data, 12))).toEqual([1, 2])

    const fragmentMeta = [2, 4, 6, 8].map((moofIdx) => {
      const moofChildren = listBoxes(top[moofIdx]!.data, 8)
      const mfhd = moofChildren.find((b) => b.type === 'mfhd')!
      const traf = moofChildren.find((b) => b.type === 'traf')!
      const tfhd = listBoxes(traf.data, 8).find((b) => b.type === 'tfhd')!
      const mdat = top[moofIdx + 1]!.data.subarray(8)
      return {
        seq: readUint32(mfhd.data, 12),
        trackId: readUint32(tfhd.data, 12),
        payload: [...mdat],
      }
    })
    expect(fragmentMeta).toEqual([
      { seq: 1, trackId: 1, payload: [1, 2, 3] },
      { seq: 2, trackId: 2, payload: [10, 11] },
      { seq: 3, trackId: 1, payload: [4, 5, 6] },
      { seq: 4, trackId: 2, payload: [12, 13] },
    ])
  })

  it('synthesizes valid trex atoms when tracks omit mvex', () => {
    const bareMoov = (trackId: number, timescale: number) =>
      box('moov', makeMvhd(1000, 2000, trackId + 1), box('trak', makeTkhd(trackId), box('mdia', makeMdhd(timescale))))

    const videoTrack = concat([box('ftyp', u32(0x69736f36)), bareMoov(1, 90_000), makeFragment(1, 1, 0, [1, 2])])
    const audioTrack = concat([box('ftyp', u32(0x69736f36)), bareMoov(1, 48_000), makeFragment(1, 1, 0, [3, 4])])

    const muxed = concat(muxMp4([videoTrack], [audioTrack]))
    const moov = listBoxes(muxed).find((item) => item.type === 'moov')!
    const mvex = listBoxes(moov.data, 8).find((item) => item.type === 'mvex')!
    const mvexChildren = listBoxes(mvex.data, 8)
    expect(mvexChildren.map((child) => child.type)).toEqual(['trex', 'trex'])
    expect(mvexChildren.map((trex) => readUint32(trex.data, 12))).toEqual([1, 2])
    expect(mvexChildren.map((trex) => readUint32(trex.data, 16))).toEqual([1, 1])
  })

  it('throws a clear error when either stream lacks a moov atom', () => {
    expect(() => muxMp4([box('ftyp', u32(0))], [makeMoov(1, 48_000)])).toThrow('missing moov box')
    expect(() => muxMp4([makeMoov(1, 90_000)], [box('ftyp', u32(0))])).toThrow('missing moov box')
  })
})
