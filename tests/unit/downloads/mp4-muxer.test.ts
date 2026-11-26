import type * as NodeChildProcess from 'node:child_process'
import type * as NodeFs from 'node:fs'
import type * as NodeOs from 'node:os'
import type * as NodePath from 'node:path'

import { describe, expect, it } from 'vite-plus/test'

import { muxMp4, muxMp4Audio } from '../../../src/downloads/mp4-muxer'

const proc = (globalThis as unknown as { process: NodeJS.Process }).process
const childProcess = proc.getBuiltinModule('node:child_process') as typeof NodeChildProcess
const fsMod = proc.getBuiltinModule('node:fs') as typeof NodeFs
const osMod = proc.getBuiltinModule('node:os') as typeof NodeOs
const pathMod = proc.getBuiltinModule('node:path') as typeof NodePath

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

const fourcc = (tag: string): Uint8Array =>
  Uint8Array.from([tag.charCodeAt(0), tag.charCodeAt(1), tag.charCodeAt(2), tag.charCodeAt(3)])

const box = (type: string, ...payloads: Uint8Array[]): Uint8Array => {
  const body = concat(payloads)
  const header = new Uint8Array(8)
  new DataView(header.buffer).setUint32(0, 8 + body.byteLength)
  for (let i = 0; i < 4; i += 1) header[4 + i] = type.charCodeAt(i)
  return concat([header, body])
}

const readUint32 = (bytes: Uint8Array, offset: number) =>
  new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0)

const readInt32 = (bytes: Uint8Array, offset: number) =>
  new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getInt32(0)

const readUint16 = (bytes: Uint8Array, offset: number) =>
  new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0)

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

const makeTkhd = (trackId: number, duration = 2000, volume = 0) => {
  const payload = new Uint8Array(84)
  const view = new DataView(payload.buffer)
  payload[3] = 3
  view.setUint32(12, trackId)
  view.setUint32(20, duration)
  view.setUint16(36, volume)
  return box('tkhd', payload)
}

const makeElst = (entries: { segmentDuration: number, mediaTime: number, rateInt?: number, rateFrac?: number }[]) => {
  const payload = new Uint8Array(8 + entries.length * 12)
  const view = new DataView(payload.buffer)
  view.setUint32(4, entries.length)
  entries.forEach((entry, index) => {
    const base = 8 + index * 12
    view.setUint32(base, entry.segmentDuration)
    view.setInt32(base + 4, entry.mediaTime)
    view.setInt16(base + 8, entry.rateInt ?? 1)
    view.setInt16(base + 10, entry.rateFrac ?? 0)
  })
  return box('edts', box('elst', payload))
}

const makeMdhd = (timescale: number, duration = 0) => {
  const payload = new Uint8Array(24)
  const view = new DataView(payload.buffer)
  view.setUint32(12, timescale)
  view.setUint32(16, duration)
  return box('mdhd', payload)
}

const makeHdlr = (handlerType: 'vide' | 'soun') => {
  const payload = new Uint8Array(24)
  payload.set(fourcc(handlerType), 8)
  return box('hdlr', payload)
}

const makeStsd = (codecFourcc: string) => {
  const entry = new Uint8Array(24)
  const view = new DataView(entry.buffer)
  view.setUint32(0, entry.byteLength)
  entry.set(fourcc(codecFourcc), 4)
  const payload = new Uint8Array(8)
  new DataView(payload.buffer).setUint32(4, 1)
  return box('stsd', payload, entry)
}

const makeMinf = (handlerType: 'vide' | 'soun', codecFourcc: string) =>
  box(
    'minf',
    box(handlerType === 'vide' ? 'vmhd' : 'smhd', new Uint8Array(handlerType === 'vide' ? 12 : 8)),
    box('dinf', box('dref', new Uint8Array(8))),
    box('stbl', makeStsd(codecFourcc)),
  )

const makeTrex = (trackId: number, defaultDuration = 1, defaultFlags = 0) => {
  const payload = new Uint8Array(24)
  const view = new DataView(payload.buffer)
  view.setUint32(4, trackId)
  view.setUint32(8, 1)
  view.setUint32(12, defaultDuration)
  view.setUint32(20, defaultFlags)
  return box('trex', payload)
}

const makeMoov = (opts: {
  trackId: number
  mvhdTimescale?: number
  mvhdDuration?: number
  mdhdTimescale: number
  mdhdDuration?: number
  handlerType?: 'vide' | 'soun'
  codecFourcc?: string
  volume?: number
  elst?: { segmentDuration: number, mediaTime: number }[]
  trex?: { defaultDuration?: number, defaultFlags?: number }
}) => {
  const handler = opts.handlerType ?? 'vide'
  const codec = opts.codecFourcc ?? (handler === 'vide' ? 'avc1' : 'mp4a')
  const trakChildren: Uint8Array[] = [
    makeTkhd(opts.trackId, opts.mdhdDuration ?? 2000, opts.volume ?? (handler === 'soun' ? 0x0100 : 0)),
  ]
  if (opts.elst) trakChildren.push(makeElst(opts.elst))
  trakChildren.push(box('mdia', makeMdhd(opts.mdhdTimescale, opts.mdhdDuration ?? 0), makeHdlr(handler), makeMinf(handler, codec)))

  const children: Uint8Array[] = [
    makeMvhd(opts.mvhdTimescale ?? opts.mdhdTimescale, opts.mvhdDuration ?? opts.mdhdDuration ?? 2000, opts.trackId + 1),
    box('trak', ...trakChildren),
  ]
  if (opts.trex !== undefined) {
    children.push(box('mvex', makeTrex(opts.trackId, opts.trex.defaultDuration ?? 1, opts.trex.defaultFlags ?? 0)))
  }
  return box('moov', ...children)
}

type SampleSpec = {
  payload: Uint8Array
  duration?: number
  flags?: number
  cto?: number
}

const makeDashFragment = (opts: {
  trackId: number
  seq: number
  decodeTime: number
  tfhdDefaultDuration?: number
  tfhdDefaultFlags?: number
  trunVersion?: number
  includeDuration?: boolean
  includeSize?: boolean
  includeFlags?: boolean
  includeCto?: boolean
  samples: readonly SampleSpec[]
}) => {
  const mfhdPayload = new Uint8Array(8)
  new DataView(mfhdPayload.buffer).setUint32(4, opts.seq)

  let tfFlags = 0x020002 // default-base-is-moof | sample-description-index-present
  if (opts.tfhdDefaultDuration !== undefined) tfFlags |= 0x000008
  if (opts.tfhdDefaultFlags !== undefined) tfFlags |= 0x000020
  const tfhdWords = [1 + 1 + (opts.tfhdDefaultDuration !== undefined ? 1 : 0) + (opts.tfhdDefaultFlags !== undefined ? 1 : 0)]
  const tfhdPayload = new Uint8Array(4 * (tfhdWords[0]! + 1))
  const tfhdView = new DataView(tfhdPayload.buffer)
  tfhdView.setUint32(0, tfFlags)
  tfhdView.setUint32(4, opts.trackId)
  tfhdView.setUint32(8, 1)
  let tfPos = 12
  if (opts.tfhdDefaultDuration !== undefined) {
    tfhdView.setUint32(tfPos, opts.tfhdDefaultDuration)
    tfPos += 4
  }
  if (opts.tfhdDefaultFlags !== undefined) {
    tfhdView.setUint32(tfPos, opts.tfhdDefaultFlags)
  }

  const tfdtPayload = new Uint8Array(8)
  new DataView(tfdtPayload.buffer).setUint32(4, opts.decodeTime)

  const includeDur = opts.includeDuration ?? false
  const includeSz = opts.includeSize ?? true
  const includeFlg = opts.includeFlags ?? false
  const includeCto = opts.includeCto ?? false
  let trFlags = 0x000001 // data_offset present
  if (includeDur) trFlags |= 0x000100
  if (includeSz) trFlags |= 0x000200
  if (includeFlg) trFlags |= 0x000400
  if (includeCto) trFlags |= 0x000800

  const fieldsPerSample = (includeDur ? 1 : 0) + (includeSz ? 1 : 0) + (includeFlg ? 1 : 0) + (includeCto ? 1 : 0)
  const trunPayload = new Uint8Array(12 + opts.samples.length * fieldsPerSample * 4)
  const trunView = new DataView(trunPayload.buffer)
  trunView.setUint32(0, ((opts.trunVersion ?? 0) << 24) | trFlags)
  trunView.setUint32(4, opts.samples.length)
  // data_offset written once moof size is known
  let trPos = 12
  for (const sample of opts.samples) {
    if (includeDur) { trunView.setUint32(trPos, sample.duration ?? 0); trPos += 4 }
    if (includeSz) { trunView.setUint32(trPos, sample.payload.byteLength); trPos += 4 }
    if (includeFlg) { trunView.setUint32(trPos, sample.flags ?? 0); trPos += 4 }
    if (includeCto) {
      if ((opts.trunVersion ?? 0) === 1) trunView.setInt32(trPos, sample.cto ?? 0)
      else trunView.setUint32(trPos, sample.cto ?? 0)
      trPos += 4
    }
  }

  const traf = box('traf', box('tfhd', tfhdPayload), box('tfdt', tfdtPayload), box('trun', trunPayload))
  const mfhd = box('mfhd', mfhdPayload)
  const moofSize = 8 + mfhd.byteLength + traf.byteLength
  // data_offset relative to moof start = moofSize + 8 (mdat header)
  const trunInTrafOffset = 8 + (8 + tfhdPayload.byteLength) + (8 + tfdtPayload.byteLength) + 8
  new DataView(traf.buffer).setInt32(trunInTrafOffset + 8, moofSize + 8)

  const moof = box('moof', mfhd, traf)
  const mdat = box('mdat', ...opts.samples.map((s) => s.payload))
  return concat([moof, mdat])
}

const makePattern = (seed: number, len: number): Uint8Array => {
  const out = new Uint8Array(len)
  for (let i = 0; i < len; i += 1) out[i] = (seed + i * 17) & 0xff
  return out
}

const parseStts = (sttsData: Uint8Array) => {
  const count = readUint32(sttsData, 12)
  const entries: { sampleCount: number, sampleDelta: number }[] = []
  for (let i = 0; i < count; i += 1) {
    entries.push({
      sampleCount: readUint32(sttsData, 16 + i * 8),
      sampleDelta: readUint32(sttsData, 20 + i * 8),
    })
  }
  return entries
}

const parseStsc = (stscData: Uint8Array) => {
  const count = readUint32(stscData, 12)
  const entries: { firstChunk: number, samplesPerChunk: number, sdi: number }[] = []
  for (let i = 0; i < count; i += 1) {
    entries.push({
      firstChunk: readUint32(stscData, 16 + i * 12),
      samplesPerChunk: readUint32(stscData, 20 + i * 12),
      sdi: readUint32(stscData, 24 + i * 12),
    })
  }
  return entries
}

const parseStsz = (stszData: Uint8Array) => {
  const sampleSize = readUint32(stszData, 12)
  const sampleCount = readUint32(stszData, 16)
  const sizes: number[] = []
  for (let i = 0; i < sampleCount; i += 1) {
    sizes.push(sampleSize || readUint32(stszData, 20 + i * 4))
  }
  return sizes
}

const parseStco = (stcoData: Uint8Array) => {
  const count = readUint32(stcoData, 12)
  const offsets: number[] = []
  for (let i = 0; i < count; i += 1) offsets.push(readUint32(stcoData, 16 + i * 4))
  return offsets
}

const parseStss = (stssData: Uint8Array) => {
  const count = readUint32(stssData, 12)
  const nums: number[] = []
  for (let i = 0; i < count; i += 1) nums.push(readUint32(stssData, 16 + i * 4))
  return nums
}

const parseCtts = (cttsData: Uint8Array) => {
  const version = cttsData[8]!
  const count = readUint32(cttsData, 12)
  const entries: { sampleCount: number, sampleOffset: number }[] = []
  for (let i = 0; i < count; i += 1) {
    entries.push({
      sampleCount: readUint32(cttsData, 16 + i * 8),
      sampleOffset: version === 1 ? readInt32(cttsData, 20 + i * 8) : readUint32(cttsData, 20 + i * 8),
    })
  }
  return { version, entries }
}

const extractTrackPayloadsFromStbl = (fileBytes: Uint8Array, stblChildren: { type: string, data: Uint8Array }[]) => {
  const stsc = parseStsc(stblChildren.find((b) => b.type === 'stsc')!.data)
  const stsz = parseStsz(stblChildren.find((b) => b.type === 'stsz')!.data)
  const stco = parseStco(stblChildren.find((b) => b.type === 'stco')!.data)
  const out: Uint8Array[] = []
  let sampleIdx = 0
  for (let chunkIndex = 0; chunkIndex < stco.length; chunkIndex += 1) {
    const chunkNumber = chunkIndex + 1
    let spc = 1
    for (const entry of stsc) {
      if (chunkNumber >= entry.firstChunk) spc = entry.samplesPerChunk
    }
    let pos = stco[chunkIndex]!
    for (let s = 0; s < spc; s += 1) {
      const sz = stsz[sampleIdx]!
      out.push(fileBytes.subarray(pos, pos + sz))
      pos += sz
      sampleIdx += 1
    }
  }
  return { samples: out, chunks: stco, stsc, stsz }
}

describe('muxMp4', () => {
  it('remuxes fragmented H.264 and AAC DASH tracks into standard fast-start interleaved MP4', () => {
    const videoSamplesFrag1: SampleSpec[] = Array.from({ length: 30 }, (_, i) => ({
      payload: makePattern(10 + i, 80 + (i % 7)),
      flags: i === 0 || i === 15 ? 0x0 : 0x10000,
      cto: i % 2 === 0 ? 1024 : 2048,
    }))
    const videoSamplesFrag2: SampleSpec[] = Array.from({ length: 15 }, (_, i) => ({
      payload: makePattern(50 + i, 90 + (i % 5)),
      flags: i === 0 ? 0x0 : 0x10000,
      cto: 0,
    }))
    const videoTrack = concat([
      box('ftyp', fourcc('dash'), u32(0), fourcc('iso6'), fourcc('avc1'), fourcc('mp41')),
      makeMoov({
        trackId: 1,
        mvhdTimescale: 15_360,
        mvhdDuration: 46_080,
        mdhdTimescale: 15_360,
        mdhdDuration: 46_080,
        handlerType: 'vide',
        codecFourcc: 'avc1',
        elst: [{ segmentDuration: 46_080, mediaTime: 1024 }],
        trex: { defaultDuration: 1024, defaultFlags: 0x10000 },
      }),
      box('styp', fourcc('msdh')),
      box('sidx', new Uint8Array(16)),
      makeDashFragment({
        trackId: 1,
        seq: 1,
        decodeTime: 0,
        tfhdDefaultDuration: 1024,
        includeFlags: true,
        includeCto: true,
        samples: videoSamplesFrag1,
      }),
      makeDashFragment({
        trackId: 1,
        seq: 2,
        decodeTime: 30_720,
        tfhdDefaultDuration: 1024,
        includeFlags: true,
        includeCto: true,
        samples: videoSamplesFrag2,
      }),
    ])

    const audioSamplesFrag1: SampleSpec[] = Array.from({ length: 86 }, (_, i) => ({
      payload: makePattern(100 + i, 40 + (i % 4)),
    }))
    const audioSamplesFrag2: SampleSpec[] = Array.from({ length: 44 }, (_, i) => ({
      payload: makePattern(200 + i, 44 + (i % 3)),
    }))
    const audioTrack = concat([
      box('ftyp', fourcc('dash'), u32(0), fourcc('iso6'), fourcc('mp41')),
      makeMoov({
        trackId: 1,
        mvhdTimescale: 44_100,
        mvhdDuration: 133_120,
        mdhdTimescale: 44_100,
        mdhdDuration: 133_120,
        handlerType: 'soun',
        codecFourcc: 'mp4a',
        volume: 0x0100,
        trex: { defaultDuration: 1024, defaultFlags: 0x0 },
      }),
      makeDashFragment({
        trackId: 1,
        seq: 1,
        decodeTime: 0,
        tfhdDefaultDuration: 1024,
        tfhdDefaultFlags: 0x0,
        samples: audioSamplesFrag1,
      }),
      makeDashFragment({
        trackId: 1,
        seq: 2,
        decodeTime: 88_064,
        tfhdDefaultDuration: 1024,
        tfhdDefaultFlags: 0x0,
        samples: audioSamplesFrag2,
      }),
    ])

    const split = (buf: Uint8Array) => [buf.subarray(0, 17), buf.subarray(17, 131), buf.subarray(131)]
    const muxed = concat(muxMp4(split(videoTrack), split(audioTrack)))
    const top = listBoxes(muxed)

    expect(top.map((item) => item.type)).toEqual(['ftyp', 'moov', 'mdat'])

    const ftypData = top[0]!.data
    expect(String.fromCharCode(...ftypData.subarray(8, 12))).toBe('isom')
    const compatBrands: string[] = []
    for (let pos = 16; pos < ftypData.byteLength; pos += 4) {
      compatBrands.push(String.fromCharCode(...ftypData.subarray(pos, pos + 4)))
    }
    expect(compatBrands).toEqual(['isom', 'iso2', 'avc1', 'mp41'])

    const moovChildren = listBoxes(top[1]!.data, 8)
    expect(moovChildren.map((child) => child.type)).toEqual(['mvhd', 'trak', 'trak'])

    const mvhd = moovChildren[0]!.data
    expect(readUint32(mvhd, 20)).toBe(1000)
    expect(readUint32(mvhd, 24)).toBe(Math.round((133_120 * 1000) / 44_100))
    expect(readUint32(mvhd, mvhd.byteLength - 4)).toBe(3)

    const videoTrak = listBoxes(moovChildren[1]!.data, 8)
    const videoTkhd = videoTrak.find((b) => b.type === 'tkhd')!.data
    expect(readUint32(videoTkhd, 20)).toBe(1)
    expect(readUint32(videoTkhd, 28)).toBe(3000)
    const videoEdts = videoTrak.find((b) => b.type === 'edts')!
    const elstData = listBoxes(videoEdts.data, 8).find((b) => b.type === 'elst')!.data
    expect(readUint32(elstData, 16)).toBe(3000)
    expect(readInt32(elstData, 20)).toBe(1024)

    const audioTrak = listBoxes(moovChildren[2]!.data, 8)
    const audioTkhd = audioTrak.find((b) => b.type === 'tkhd')!.data
    expect(readUint32(audioTkhd, 20)).toBe(2)
    expect(readUint32(audioTkhd, 28)).toBe(Math.round((133_120 * 1000) / 44_100))
    expect(readUint16(audioTkhd, 44)).toBe(0x0100)

    const videoStbl = listBoxes(
      listBoxes(videoTrak.find((b) => b.type === 'mdia')!.data, 8).find((b) => b.type === 'minf')!.data,
      8,
    ).find((b) => b.type === 'stbl')!
    const videoStblChildren = listBoxes(videoStbl.data, 8)
    expect(videoStblChildren.map((b) => b.type)).toEqual(
      expect.arrayContaining(['stsd', 'stts', 'ctts', 'stss', 'stsc', 'stsz', 'stco']),
    )
    expect(parseStts(videoStblChildren.find((b) => b.type === 'stts')!.data)).toEqual([
      { sampleCount: 45, sampleDelta: 1024 },
    ])
    expect(parseStss(videoStblChildren.find((b) => b.type === 'stss')!.data)).toEqual([1, 16, 31])
    expect(parseCtts(videoStblChildren.find((b) => b.type === 'ctts')!.data)).toMatchObject({
      version: 0,
      entries: expect.arrayContaining([{ sampleCount: 15, sampleOffset: 0 }]),
    })

    const audioStbl = listBoxes(
      listBoxes(audioTrak.find((b) => b.type === 'mdia')!.data, 8).find((b) => b.type === 'minf')!.data,
      8,
    ).find((b) => b.type === 'stbl')!
    const audioStblChildren = listBoxes(audioStbl.data, 8)
    expect(audioStblChildren.some((b) => b.type === 'ctts')).toBe(false)
    expect(audioStblChildren.some((b) => b.type === 'stss')).toBe(false)
    expect(parseStts(audioStblChildren.find((b) => b.type === 'stts')!.data)).toEqual([
      { sampleCount: 130, sampleDelta: 1024 },
    ])

    const extractedVideo = extractTrackPayloadsFromStbl(muxed, videoStblChildren)
    const extractedAudio = extractTrackPayloadsFromStbl(muxed, audioStblChildren)
    expect(extractedVideo.samples.map((s) => [...s])).toEqual(
      [...videoSamplesFrag1, ...videoSamplesFrag2].map((s) => [...s.payload]),
    )
    expect(extractedAudio.samples.map((s) => [...s])).toEqual(
      [...audioSamplesFrag1, ...audioSamplesFrag2].map((s) => [...s.payload]),
    )

    expect(extractedVideo.chunks.length).toBeGreaterThanOrEqual(3)
    expect(extractedAudio.chunks.length).toBeGreaterThanOrEqual(3)
    expect(extractedVideo.chunks[0]!).toBeLessThan(extractedAudio.chunks[0]!)
    expect(extractedAudio.chunks[0]!).toBeLessThan(extractedVideo.chunks[1]!)
  })

  it('handles tracks without mvex, single-sample trun without sample_size, and signed v1 ctts', () => {
    const videoSample = makePattern(7, 25)
    const audioSample = makePattern(9, 19)

    const videoTrack = concat([
      box('ftyp', fourcc('iso6')),
      makeMoov({ trackId: 1, mdhdTimescale: 90_000, handlerType: 'vide', codecFourcc: 'avc1' }),
      makeDashFragment({
        trackId: 1,
        seq: 1,
        decodeTime: 0,
        tfhdDefaultDuration: 3000,
        tfhdDefaultFlags: 0x0,
        trunVersion: 1,
        includeSize: false,
        includeCto: true,
        samples: [{ payload: videoSample, cto: -1500 }],
      }),
    ])
    const audioTrack = concat([
      box('ftyp', fourcc('iso6')),
      makeMoov({ trackId: 1, mdhdTimescale: 48_000, handlerType: 'soun', codecFourcc: 'mp4a' }),
      makeDashFragment({
        trackId: 1,
        seq: 1,
        decodeTime: 0,
        tfhdDefaultDuration: 1600,
        tfhdDefaultFlags: 0x0,
        includeSize: false,
        samples: [{ payload: audioSample }],
      }),
    ])

    const muxed = concat(muxMp4([videoTrack], [audioTrack]))
    const ftypData = listBoxes(muxed)[0]!.data
    const brands: string[] = []
    for (let pos = 16; pos < ftypData.byteLength; pos += 4) {
      brands.push(String.fromCharCode(...ftypData.subarray(pos, pos + 4)))
    }
    expect(brands).toEqual(['isom', 'iso2', 'iso4', 'avc1', 'mp41'])

    const moovChildren = listBoxes(listBoxes(muxed).find((b) => b.type === 'moov')!.data, 8)
    expect(moovChildren.some((b) => b.type === 'mvex')).toBe(false)

    const videoStbl = listBoxes(
      listBoxes(listBoxes(moovChildren[1]!.data, 8).find((b) => b.type === 'mdia')!.data, 8).find((b) => b.type === 'minf')!.data,
      8,
    ).find((b) => b.type === 'stbl')!
    const videoStblChildren = listBoxes(videoStbl.data, 8)
    expect(parseCtts(videoStblChildren.find((b) => b.type === 'ctts')!.data)).toEqual({
      version: 1,
      entries: [{ sampleCount: 1, sampleOffset: -1500 }],
    })
    expect(extractTrackPayloadsFromStbl(muxed, videoStblChildren).samples.map((s) => [...s])).toEqual([
      [...videoSample],
    ])
  })

  it('supports tfhd base_data_offset, 64-bit tfdt, and multiple truns in one traf', () => {
    const s1 = makePattern(11, 14)
    const s2 = makePattern(22, 18)
    const audioSample = makePattern(33, 12)

    const videoHeader = concat([
      box('ftyp', fourcc('iso6')),
      makeMoov({ trackId: 1, mdhdTimescale: 90_000, handlerType: 'vide', codecFourcc: 'avc1' }),
    ])

    const mfhdPayload = new Uint8Array(8)
    new DataView(mfhdPayload.buffer).setUint32(4, 1)
    const tfhdPayload = new Uint8Array(20)
    const tfhdView = new DataView(tfhdPayload.buffer)
    tfhdView.setUint32(0, 0x000009) // base_data_offset + default_sample_duration
    tfhdView.setUint32(4, 1)
    tfhdView.setBigUint64(8, BigInt(videoHeader.byteLength))
    tfhdView.setUint32(16, 3000)

    const tfdtPayload = new Uint8Array(12)
    const tfdtView = new DataView(tfdtPayload.buffer)
    tfdtView.setUint32(0, 1 << 24)
    tfdtView.setBigUint64(4, 0n)

    const makeTrun = (sampleLen: number, dataOff: number) => {
      const payload = new Uint8Array(16)
      const view = new DataView(payload.buffer)
      view.setUint32(0, 0x000201)
      view.setUint32(4, 1)
      view.setInt32(8, dataOff)
      view.setUint32(12, sampleLen)
      return box('trun', payload)
    }

    const tfhdBox = box('tfhd', tfhdPayload)
    const tfdtBox = box('tfdt', tfdtPayload)
    const mfhdBox = box('mfhd', mfhdPayload)
    const dummyTrun1 = makeTrun(s1.byteLength, 0)
    const dummyTrun2 = makeTrun(s2.byteLength, 0)
    const trafSize = 8 + tfhdBox.byteLength + tfdtBox.byteLength + dummyTrun1.byteLength + dummyTrun2.byteLength
    const moofSize = 8 + mfhdBox.byteLength + trafSize
    const mdatPayloadStart = moofSize + 8

    const traf = box(
      'traf',
      tfhdBox,
      tfdtBox,
      makeTrun(s1.byteLength, mdatPayloadStart),
      makeTrun(s2.byteLength, mdatPayloadStart + s1.byteLength),
    )
    const moof = box('moof', mfhdBox, traf)
    const mdat = box('mdat', s1, s2)
    const videoTrack = concat([videoHeader, moof, mdat])

    const audioTrack = concat([
      box('ftyp', fourcc('iso6')),
      makeMoov({ trackId: 1, mdhdTimescale: 48_000, handlerType: 'soun', codecFourcc: 'mp4a' }),
      makeDashFragment({
        trackId: 1,
        seq: 1,
        decodeTime: 0,
        tfhdDefaultDuration: 1600,
        samples: [{ payload: audioSample }],
      }),
    ])

    const muxed = concat(muxMp4([videoTrack], [audioTrack]))
    const moovChildren = listBoxes(listBoxes(muxed).find((b) => b.type === 'moov')!.data, 8)
    const videoStbl = listBoxes(
      listBoxes(listBoxes(moovChildren[1]!.data, 8).find((b) => b.type === 'mdia')!.data, 8).find((b) => b.type === 'minf')!.data,
      8,
    ).find((b) => b.type === 'stbl')!
    const extracted = extractTrackPayloadsFromStbl(muxed, listBoxes(videoStbl.data, 8))
    expect(extracted.samples.map((s) => [...s])).toEqual([[...s1], [...s2]])
  })

  it('throws clear errors on missing moov, empty samples, truncated tfhd, bad data_offset, and zero-size trun', () => {
    const emptyVideo = concat([
      box('ftyp', fourcc('iso6')),
      makeMoov({ trackId: 1, mdhdTimescale: 90_000, handlerType: 'vide', codecFourcc: 'avc1' }),
    ])
    const validVideo = concat([
      box('ftyp', fourcc('iso6')),
      makeMoov({ trackId: 1, mdhdTimescale: 90_000, handlerType: 'vide', codecFourcc: 'avc1' }),
      makeDashFragment({
        trackId: 1,
        seq: 1,
        decodeTime: 0,
        tfhdDefaultDuration: 1024,
        samples: [{ payload: makePattern(1, 8) }],
      }),
    ])
    const audio = concat([
      box('ftyp', fourcc('iso6')),
      makeMoov({ trackId: 1, mdhdTimescale: 48_000, handlerType: 'soun', codecFourcc: 'mp4a' }),
      makeDashFragment({
        trackId: 1,
        seq: 1,
        decodeTime: 0,
        tfhdDefaultDuration: 1024,
        samples: [{ payload: makePattern(1, 8) }],
      }),
    ])
    expect(() => muxMp4([box('ftyp', u32(0))], [audio])).toThrow('missing moov box')
    expect(() => muxMp4([validVideo], [box('ftyp', u32(0))])).toThrow('missing moov box')
    expect(() => muxMp4([emptyVideo], [audio])).toThrow('no media samples')

    const truncTfhd = new Uint8Array(8)
    new DataView(truncTfhd.buffer).setUint32(0, 0x000001)
    new DataView(truncTfhd.buffer).setUint32(4, 1)
    const truncVideo = concat([
      box('ftyp', fourcc('iso6')),
      makeMoov({ trackId: 1, mdhdTimescale: 90_000, handlerType: 'vide', codecFourcc: 'avc1' }),
      box('moof', box('traf', box('tfhd', truncTfhd))),
      box('mdat', makePattern(1, 8)),
    ])
    expect(() => muxMp4([truncVideo], [audio])).toThrow('truncated tfhd')

    const badOffTfhd = new Uint8Array(8)
    new DataView(badOffTfhd.buffer).setUint32(0, 0x020000)
    new DataView(badOffTfhd.buffer).setUint32(4, 1)
    const badOffTrun = new Uint8Array(16)
    const badOffView = new DataView(badOffTrun.buffer)
    badOffView.setUint32(0, 0x000201)
    badOffView.setUint32(4, 1)
    badOffView.setInt32(8, 99_999)
    badOffView.setUint32(12, 4)
    const badOffVideo = concat([
      box('ftyp', fourcc('iso6')),
      makeMoov({ trackId: 1, mdhdTimescale: 90_000, handlerType: 'vide', codecFourcc: 'avc1' }),
      box('moof', box('traf', box('tfhd', badOffTfhd), box('trun', badOffTrun))),
      box('mdat', makePattern(1, 8)),
    ])
    expect(() => muxMp4([badOffVideo], [audio])).toThrow('out of mdat bounds')

    const zeroSzTrun = new Uint8Array(8)
    const zeroSzView = new DataView(zeroSzTrun.buffer)
    zeroSzView.setUint32(0, 0)
    zeroSzView.setUint32(4, 10)
    const zeroSzVideo = concat([
      box('ftyp', fourcc('iso6')),
      makeMoov({ trackId: 1, mdhdTimescale: 90_000, handlerType: 'vide', codecFourcc: 'avc1' }),
      box('moof', box('traf', box('tfhd', badOffTfhd), box('trun', zeroSzTrun))),
      box('mdat', makePattern(1, 8)),
    ])
    expect(() => muxMp4([zeroSzVideo], [audio])).toThrow('zero-size samples')
  })

  it('trims video and audio tracks with keyframe preroll, non-zero tfdt offset, and edit-list start offset', () => {
    // 10 kHz timescale -> 10 ticks/ms; 4 fragments starting at tfdt = 20_000 (2.0s), 1 keyframe every 1.0s (10 samples * 1000 ticks)
    const vidSamples = Array.from({ length: 40 }, (_, i) => ({
      payload: makePattern(100 + i, 24),
      flags: i % 10 === 0 ? 0x0 : 0x10000,
      cto: 0,
    }))
    const videoTrack = concat([
      box('ftyp', fourcc('dash'), u32(0), fourcc('iso6'), fourcc('avc1'), fourcc('mp41')),
      makeMoov({
        trackId: 1,
        mvhdTimescale: 1000,
        mvhdDuration: 6000,
        mdhdTimescale: 10_000,
        mdhdDuration: 60_000,
        handlerType: 'vide',
        codecFourcc: 'avc1',
        trex: { defaultDuration: 1000, defaultFlags: 0x10000 },
      }),
      makeDashFragment({
        trackId: 1,
        seq: 1,
        decodeTime: 20_000,
        includeFlags: true,
        samples: vidSamples,
      }),
    ])

    const audioSamples = Array.from({ length: 40 }, (_, i) => ({
      payload: makePattern(200 + i, 12),
    }))
    const audioTrack = concat([
      box('ftyp', fourcc('dash'), u32(0), fourcc('iso6'), fourcc('mp4a'), fourcc('mp41')),
      makeMoov({
        trackId: 1,
        mvhdTimescale: 1000,
        mvhdDuration: 6000,
        mdhdTimescale: 10_000,
        mdhdDuration: 60_000,
        handlerType: 'soun',
        codecFourcc: 'mp4a',
        trex: { defaultDuration: 1000, defaultFlags: 0 },
      }),
      makeDashFragment({
        trackId: 1,
        seq: 1,
        decodeTime: 20_000,
        samples: audioSamples,
      }),
    ])

    // Trim [3500ms, 5000ms]: keyframe preroll goes back to t=3.0s (sample index 10 -> dts 30_000), elst mediaTime offsets 5_000 ticks (0.5s)
    const muxed = concat(muxMp4([videoTrack], [audioTrack], { startMs: 3_500, endMs: 5_000 }))
    const moov = listBoxes(muxed).find((b) => b.type === 'moov')!
    const moovChildren = listBoxes(moov.data, 8)
    const mvhd = moovChildren.find((b) => b.type === 'mvhd')!
    const mvhdDurationMs = readUint32(mvhd.data, 24)
    expect(mvhdDurationMs).toBe(1500)

    const traks = moovChildren.filter((b) => b.type === 'trak')
    const videoTrak = listBoxes(traks[0]!.data, 8)
    const videoElst = listBoxes(videoTrak.find((b) => b.type === 'edts')!.data, 8).find((b) => b.type === 'elst')!
    expect(readUint32(videoElst.data, 16)).toBe(1500)
    expect(readInt32(videoElst.data, 20)).toBe(5000)

    const videoStbl = listBoxes(
      listBoxes(videoTrak.find((b) => b.type === 'mdia')!.data, 8).find((b) => b.type === 'minf')!.data,
      8,
    ).find((b) => b.type === 'stbl')!
    const extracted = extractTrackPayloadsFromStbl(muxed, listBoxes(videoStbl.data, 8))
    // Kept samples: indices 10..29 (t=3.0s..4.9s, starting cleanly at keyframe index 10)
    expect(extracted.samples).toHaveLength(20)
    expect([...extracted.samples[0]!]).toEqual([...makePattern(110, 24)])
    const stss = parseStss(listBoxes(videoStbl.data, 8).find((b) => b.type === 'stss')!.data)
    expect(stss[0]).toBe(1)

    // Audio-only M4A trim for [3500ms, 5000ms]
    const trimmedAudio = concat(muxMp4Audio([audioTrack], { startMs: 3_500, endMs: 5_000 }))
    const aMoov = listBoxes(trimmedAudio).find((b) => b.type === 'moov')!
    const aMvhd = listBoxes(aMoov.data, 8).find((b) => b.type === 'mvhd')!
    expect(readUint32(aMvhd.data, 24)).toBe(1500)
    const aTrak = listBoxes(aMoov.data, 8).find((b) => b.type === 'trak')!
    const aElst = listBoxes(listBoxes(aTrak.data, 8).find((b) => b.type === 'edts')!.data, 8).find((b) => b.type === 'elst')!
    expect(readUint32(aElst.data, 16)).toBe(1500)
  })

  it('produces ffprobe/ffmpeg-valid full and cropped MP4/M4A outputs with aligned A/V pre-roll', () => {
    const videoFixture = new Uint8Array(fsMod.readFileSync(pathMod.join(__dirname, '../fixtures/sample-av-fmp4-video.mp4')))
    const audioFixture = new Uint8Array(fsMod.readFileSync(pathMod.join(__dirname, '../fixtures/sample-av-fmp4-audio.m4a')))

    const fullMp4 = concat(muxMp4([videoFixture], [audioFixture]))
    const croppedMp4 = concat(muxMp4([videoFixture], [audioFixture], { startMs: 2_500, endMs: 5_000 }))
    const fullM4a = concat(muxMp4Audio([audioFixture]))
    const croppedM4a = concat(muxMp4Audio([audioFixture], { startMs: 2_500, endMs: 5_000 }))

    expect(listBoxes(fullMp4).map((b) => b.type)).toEqual(['ftyp', 'moov', 'mdat'])
    expect(listBoxes(croppedMp4).map((b) => b.type)).toEqual(['ftyp', 'moov', 'mdat'])
    expect(listBoxes(fullM4a).map((b) => b.type)).toEqual(['ftyp', 'moov', 'mdat'])
    expect(listBoxes(croppedM4a).map((b) => b.type)).toEqual(['ftyp', 'moov', 'mdat'])

    // Verify symmetric aligned A/V pre-roll and raw sample durations purely from MP4 boxes (works without ffmpeg too).
    const cMoov = listBoxes(croppedMp4).find((b) => b.type === 'moov')!
    const cTraks = listBoxes(cMoov.data, 8).filter((b) => b.type === 'trak')
    expect(cTraks).toHaveLength(2)

    const trackTiming = (trak: Uint8Array) => {
      const children = listBoxes(trak, 8)
      const mdia = children.find((b) => b.type === 'mdia')!
      const mdiaBoxes = listBoxes(mdia.data, 8)
      const mdhd = mdiaBoxes.find((b) => b.type === 'mdhd')!
      const mdhdVersion = mdhd.data[8]!
      const timescale = readUint32(mdhd.data, mdhdVersion === 1 ? 28 : 20)
      const minf = mdiaBoxes.find((b) => b.type === 'minf')!
      const stbl = listBoxes(minf.data, 8).find((b) => b.type === 'stbl')!
      const stts = parseStts(listBoxes(stbl.data, 8).find((b) => b.type === 'stts')!.data)
      const totalTicks = stts.reduce((sum, entry) => sum + entry.sampleCount * entry.sampleDelta, 0)
      const edts = children.find((b) => b.type === 'edts')
      const elst = edts ? listBoxes(edts.data, 8).find((b) => b.type === 'elst') : undefined
      const mediaTimeTicks = elst && readUint32(elst.data, 12) > 0
        ? (elst.data[8] === 1 ? Number(new DataView(elst.data.buffer, elst.data.byteOffset + 24, 8).getBigInt64(0)) : readInt32(elst.data, 20))
        : 0
      return {
        preRollSec: mediaTimeTicks / timescale,
        rawDurationSec: totalTicks / timescale,
      }
    }
    const [videoTiming, audioTiming] = cTraks.map((trak) => trackTiming(trak.data))
    expect(Math.abs(videoTiming!.preRollSec - audioTiming!.preRollSec)).toBeLessThan(0.15)
    expect(Math.abs(videoTiming!.rawDurationSec - audioTiming!.rawDurationSec)).toBeLessThan(0.15)

    const hasFfmpeg = childProcess.spawnSync('ffprobe', ['-version']).status === 0
      && childProcess.spawnSync('ffmpeg', ['-version']).status === 0
    if (!hasFfmpeg) return

    const dir = fsMod.mkdtempSync(pathMod.join(osMod.tmpdir(), 'ftube-muxer-'))
    try {
      const files = {
        fullMp4: pathMod.join(dir, 'full.mp4'),
        croppedMp4: pathMod.join(dir, 'cropped.mp4'),
        fullM4a: pathMod.join(dir, 'full.m4a'),
        croppedM4a: pathMod.join(dir, 'cropped.m4a'),
      }
      fsMod.writeFileSync(files.fullMp4, fullMp4)
      fsMod.writeFileSync(files.croppedMp4, croppedMp4)
      fsMod.writeFileSync(files.fullM4a, fullM4a)
      fsMod.writeFileSync(files.croppedM4a, croppedM4a)

      const probe = (filePath: string, extraArgs: string[] = []) => {
        const res = childProcess.spawnSync(
          'ffprobe',
          ['-v', 'error', ...extraArgs, '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,duration,start_time', '-of', 'json', filePath],
          { encoding: 'utf8' },
        )
        expect(res.status, res.stderr).toBe(0)
        return JSON.parse(res.stdout) as {
          format: { duration: string }
          streams: { codec_type: string, codec_name: string, width?: number, height?: number, duration: string, start_time: string }[]
        }
      }

      const decodeCheck = (filePath: string, extraArgs: string[] = []) => {
        const res = childProcess.spawnSync('ffmpeg', ['-v', 'error', ...extraArgs, '-i', filePath, '-f', 'null', '-'], { encoding: 'utf8' })
        expect(res.status, res.stderr).toBe(0)
        expect(res.stderr.trim()).toBe('')
      }

      for (const path of Object.values(files)) decodeCheck(path)
      decodeCheck(files.croppedMp4, ['-ignore_editlist', '1'])

      const fullProbe = probe(files.fullMp4)
      expect(fullProbe.streams.map((s) => s.codec_name)).toEqual(['h264', 'aac'])
      expect(Number(fullProbe.format.duration)).toBeGreaterThan(5.8)
      expect(Number(fullProbe.format.duration)).toBeLessThan(6.2)

      const croppedProbe = probe(files.croppedMp4)
      expect(croppedProbe.streams.map((s) => s.codec_name)).toEqual(['h264', 'aac'])
      expect(Number(croppedProbe.format.duration)).toBeGreaterThan(2.3)
      expect(Number(croppedProbe.format.duration)).toBeLessThan(2.7)

      const noEditProbe = probe(files.croppedMp4, ['-ignore_editlist', '1'])
      const vNoEdit = noEditProbe.streams.find((s) => s.codec_type === 'video')!
      const aNoEdit = noEditProbe.streams.find((s) => s.codec_type === 'audio')!
      // Without edit lists, both tracks must still align within <150ms rather than drifting by the GOP interval (500ms+).
      expect(Math.abs(Number(vNoEdit.duration) - Number(aNoEdit.duration))).toBeLessThan(0.15)
      expect(Math.abs(Number(vNoEdit.start_time) - Number(aNoEdit.start_time))).toBeLessThan(0.15)

      const m4aProbe = probe(files.fullM4a)
      expect(m4aProbe.streams.map((s) => s.codec_name)).toEqual(['aac'])
      expect(Number(m4aProbe.format.duration)).toBeGreaterThan(5.8)

      const croppedM4aProbe = probe(files.croppedM4a)
      expect(croppedM4aProbe.streams.map((s) => s.codec_name)).toEqual(['aac'])
      expect(Number(croppedM4aProbe.format.duration)).toBeGreaterThan(2.4)
      expect(Number(croppedM4aProbe.format.duration)).toBeLessThan(2.6)
    } finally {
      fsMod.rmSync(dir, { recursive: true, force: true })
    }
  })
})
