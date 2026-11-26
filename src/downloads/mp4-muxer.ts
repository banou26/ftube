import type { TrimRange } from './trim'

import { concatChunks } from './bytes'

type Mp4Box = {
  type: string
  start: number
  headerSize: number
  size: number
  data: Uint8Array
}

type ElstEntry = {
  segmentDuration: number
  mediaTime: number
  rateInt: number
  rateFrac: number
}

type SampleRecord = {
  duration: number
  size: number
  ctsOffset: number
  isSync: boolean
  dts: number
  byteOffset: number
}

type ChunkRecord = {
  trackId: 1 | 2
  decodeTimeSec: number
  order: number
  sampleCount: number
  payload: Uint8Array
}

type ParsedTrack = {
  trackId: 1 | 2
  mvhdTimescale: number
  tkhdData: Uint8Array
  mdhdData: Uint8Array
  mdhdTimescale: number
  hdlrData: Uint8Array
  vmhdOrSmhdData?: Uint8Array
  dinfData?: Uint8Array
  stsdData: Uint8Array
  codecBrand: string
  elstEntries: ElstEntry[]
  samples: SampleRecord[]
  chunks: ChunkRecord[]
  totalDurationTicks: number
  sourceBytes: Uint8Array
  overrideDurationMs?: number
}

const MOVIE_TIMESCALE = 1000
const TARGET_CHUNK_SEC = 1
const NON_SYNC_SAMPLE_FLAG = 0x00010000

const readUint16 = (bytes: Uint8Array, offset: number): number =>
  ((bytes[offset]! << 8) | bytes[offset + 1]!) >>> 0

const readInt16 = (bytes: Uint8Array, offset: number): number => {
  const val = readUint16(bytes, offset)
  return val >= 0x8000 ? val - 0x1_0000 : val
}

const readUint32 = (bytes: Uint8Array, offset: number): number =>
  ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0

const readInt32 = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!

const readUint64 = (bytes: Uint8Array, offset: number): number =>
  readUint32(bytes, offset) * 0x1_0000_0000 + readUint32(bytes, offset + 4)

const readInt64 = (bytes: Uint8Array, offset: number): number => {
  const hi = readInt32(bytes, offset)
  const lo = readUint32(bytes, offset + 4)
  return hi * 0x1_0000_0000 + lo
}

const writeUint16 = (bytes: Uint8Array, offset: number, value: number) => {
  bytes[offset] = (value >>> 8) & 0xff
  bytes[offset + 1] = value & 0xff
}

const writeUint32 = (bytes: Uint8Array, offset: number, value: number) => {
  bytes[offset] = (value >>> 24) & 0xff
  bytes[offset + 1] = (value >>> 16) & 0xff
  bytes[offset + 2] = (value >>> 8) & 0xff
  bytes[offset + 3] = value & 0xff
}

const writeInt32 = (bytes: Uint8Array, offset: number, value: number) => {
  writeUint32(bytes, offset, value | 0)
}

const writeUint64 = (bytes: Uint8Array, offset: number, value: number) => {
  const hi = Math.floor(value / 0x1_0000_0000) >>> 0
  const lo = value >>> 0
  writeUint32(bytes, offset, hi)
  writeUint32(bytes, offset + 4, lo)
}

const writeInt64 = (bytes: Uint8Array, offset: number, value: number) => {
  const hi = Math.floor(value / 0x1_0000_0000) | 0
  const lo = value >>> 0
  writeInt32(bytes, offset, hi)
  writeUint32(bytes, offset + 4, lo)
}

const readType = (bytes: Uint8Array, offset: number): string =>
  String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!)

const writeType = (bytes: Uint8Array, offset: number, type: string) => {
  bytes[offset] = type.charCodeAt(0)
  bytes[offset + 1] = type.charCodeAt(1)
  bytes[offset + 2] = type.charCodeAt(2)
  bytes[offset + 3] = type.charCodeAt(3)
}

const readBoxes = (bytes: Uint8Array, start = 0, end = bytes.byteLength): Mp4Box[] => {
  const boxes: Mp4Box[] = []
  let offset = start
  while (offset + 8 <= end) {
    let size = readUint32(bytes, offset)
    const type = readType(bytes, offset + 4)
    let headerSize = 8
    if (size === 1) {
      if (offset + 16 > end) throw new Error(`mp4-muxer: truncated 64-bit box header for ${type}`)
      size = readUint64(bytes, offset + 8)
      headerSize = 16
    } else if (size === 0) {
      size = end - offset
    }
    if (size < headerSize || offset + size > end) {
      throw new Error(`mp4-muxer: invalid box size ${size} for ${type}`)
    }
    boxes.push({
      type,
      start: offset,
      headerSize,
      size,
      data: bytes.subarray(offset, offset + size),
    })
    offset += size
  }
  return boxes
}

const wrapBox = (type: string, children: readonly Uint8Array[]): Uint8Array => {
  let payloadBytes = 0
  for (const child of children) payloadBytes += child.byteLength
  const out = new Uint8Array(8 + payloadBytes)
  writeUint32(out, 0, out.byteLength)
  writeType(out, 4, type)
  let offset = 8
  for (const child of children) {
    out.set(child, offset)
    offset += child.byteLength
  }
  return out
}

const wrapFullBox = (type: string, version: number, flags: number, payload: Uint8Array): Uint8Array => {
  const out = new Uint8Array(12 + payload.byteLength)
  writeUint32(out, 0, out.byteLength)
  writeType(out, 4, type)
  out[8] = version & 0xff
  out[9] = (flags >>> 16) & 0xff
  out[10] = (flags >>> 8) & 0xff
  out[11] = flags & 0xff
  out.set(payload, 12)
  return out
}

const readMvhdTimescale = (mvhd: Mp4Box): number => {
  const version = mvhd.data[mvhd.headerSize]!
  const timescaleOffset = mvhd.headerSize + (version === 1 ? 20 : 12)
  if (timescaleOffset + 4 > mvhd.size) throw new Error('mp4-muxer: mvhd box is truncated')
  return readUint32(mvhd.data, timescaleOffset) || 1
}

const readMdhdTimescale = (mdhd: Mp4Box): number => {
  const version = mdhd.data[mdhd.headerSize]!
  const timescaleOffset = mdhd.headerSize + (version === 1 ? 20 : 12)
  if (timescaleOffset + 4 > mdhd.size) throw new Error('mp4-muxer: mdhd box is truncated')
  return readUint32(mdhd.data, timescaleOffset) || 1
}

const readElst = (edts: Mp4Box | undefined): ElstEntry[] => {
  if (!edts) return []
  const elst = readBoxes(edts.data, edts.headerSize, edts.size).find((box) => box.type === 'elst')
  if (!elst || elst.size < elst.headerSize + 8) return []
  const version = elst.data[elst.headerSize]!
  const entryCount = readUint32(elst.data, elst.headerSize + 4)
  const entrySize = version === 1 ? 20 : 12
  let pos = elst.headerSize + 8
  const entries: ElstEntry[] = []
  for (let i = 0; i < entryCount && pos + entrySize <= elst.size; i += 1) {
    if (version === 1) {
      entries.push({
        segmentDuration: readUint64(elst.data, pos),
        mediaTime: readInt64(elst.data, pos + 8),
        rateInt: readInt16(elst.data, pos + 16),
        rateFrac: readInt16(elst.data, pos + 18),
      })
    } else {
      entries.push({
        segmentDuration: readUint32(elst.data, pos),
        mediaTime: readInt32(elst.data, pos + 4),
        rateInt: readInt16(elst.data, pos + 8),
        rateFrac: readInt16(elst.data, pos + 10),
      })
    }
    pos += entrySize
  }
  return entries
}

const readTrexDefaults = (mvex: Mp4Box | undefined) => {
  if (!mvex) return { defaultDuration: 0, defaultSize: 0, defaultFlags: 0 }
  const trex = readBoxes(mvex.data, mvex.headerSize, mvex.size).find((box) => box.type === 'trex')
  if (!trex || trex.size < trex.headerSize + 24) return { defaultDuration: 0, defaultSize: 0, defaultFlags: 0 }
  const base = trex.headerSize
  return {
    defaultDuration: readUint32(trex.data, base + 12),
    defaultSize: readUint32(trex.data, base + 16),
    defaultFlags: readUint32(trex.data, base + 20),
  }
}

const parseTrack = (chunks: readonly Uint8Array[], trackId: 1 | 2): ParsedTrack => {
  const bytes = concatChunks(chunks)
  const top = readBoxes(bytes)
  const moov = top.find((box) => box.type === 'moov')
  if (!moov) throw new Error(`mp4-muxer: track ${trackId} is missing moov box`)

  const moovChildren = readBoxes(moov.data, moov.headerSize, moov.size)
  const mvhd = moovChildren.find((box) => box.type === 'mvhd')
  const trak = moovChildren.find((box) => box.type === 'trak')
  const mvex = moovChildren.find((box) => box.type === 'mvex')
  if (!mvhd || !trak) throw new Error(`mp4-muxer: track ${trackId} moov is missing mvhd or trak`)

  const mvhdTimescale = readMvhdTimescale(mvhd)
  const trakChildren = readBoxes(trak.data, trak.headerSize, trak.size)
  const tkhd = trakChildren.find((box) => box.type === 'tkhd')
  const edts = trakChildren.find((box) => box.type === 'edts')
  const mdia = trakChildren.find((box) => box.type === 'mdia')
  if (!tkhd || !mdia) throw new Error(`mp4-muxer: track ${trackId} trak is missing tkhd or mdia`)

  const mdiaChildren = readBoxes(mdia.data, mdia.headerSize, mdia.size)
  const mdhd = mdiaChildren.find((box) => box.type === 'mdhd')
  const hdlr = mdiaChildren.find((box) => box.type === 'hdlr')
  const minf = mdiaChildren.find((box) => box.type === 'minf')
  if (!mdhd || !hdlr || !minf) throw new Error(`mp4-muxer: track ${trackId} mdia is incomplete`)

  const mdhdTimescale = readMdhdTimescale(mdhd)
  const minfChildren = readBoxes(minf.data, minf.headerSize, minf.size)
  const vmhdOrSmhdData = minfChildren.find((box) => box.type === 'vmhd' || box.type === 'smhd')?.data
  const dinfData = minfChildren.find((box) => box.type === 'dinf')?.data
  const stbl = minfChildren.find((box) => box.type === 'stbl')
  if (!stbl) throw new Error(`mp4-muxer: track ${trackId} minf is missing stbl`)
  const stsd = readBoxes(stbl.data, stbl.headerSize, stbl.size).find((box) => box.type === 'stsd')
  if (!stsd) throw new Error(`mp4-muxer: track ${trackId} stbl is missing stsd`)

  const codecBrand = stsd.size >= stsd.headerSize + 16
    ? readType(stsd.data, stsd.headerSize + 12)
    : 'mp41'
  const elstEntries = readElst(edts)
  const trex = readTrexDefaults(mvex)

  const samples: SampleRecord[] = []
  const fragmentChunks: {
    startSample: number
    sampleCount: number
    decodeTime: number
    byteStart: number
    hasZeroDuration: boolean
  }[] = []
  let runningDecodeTime = 0

  for (let index = 0; index < top.length; index += 1) {
    const box = top[index]!
    if (box.type !== 'moof') continue
    let mdat: Mp4Box | undefined
    for (let nextIndex = index + 1; nextIndex < top.length; nextIndex += 1) {
      const candidate = top[nextIndex]!
      if (candidate.type === 'mdat') {
        mdat = candidate
        index = nextIndex
        break
      }
      if (candidate.type === 'moof') break
    }
    if (!mdat) throw new Error(`mp4-muxer: moof without following mdat on track ${trackId}`)

    const mdatPayloadStart = mdat.start + mdat.headerSize
    const mdatEnd = mdat.start + mdat.size
    let runningMdatOffset = mdatPayloadStart

    const moofChildren = readBoxes(bytes, box.start + box.headerSize, box.start + box.size)
    let firstTraf = true
    for (const traf of moofChildren) {
      if (traf.type !== 'traf') continue
      const trafChildren = readBoxes(bytes, traf.start + traf.headerSize, traf.start + traf.size)
      const tfhd = trafChildren.find((entry) => entry.type === 'tfhd')
      if (!tfhd || tfhd.size < tfhd.headerSize + 8) {
        throw new Error(`mp4-muxer: invalid tfhd on track ${trackId}`)
      }
      const tfhdEnd = tfhd.start + tfhd.size
      const tfFlags = (bytes[tfhd.start + tfhd.headerSize + 1]! << 16)
        | (bytes[tfhd.start + tfhd.headerSize + 2]! << 8)
        | bytes[tfhd.start + tfhd.headerSize + 3]!
      let tfPos = tfhd.start + tfhd.headerSize + 8
      let baseDataOffset: number | undefined
      if (tfFlags & 0x000001) {
        if (tfPos + 8 > tfhdEnd) throw new Error(`mp4-muxer: truncated tfhd base_data_offset on track ${trackId}`)
        baseDataOffset = readUint64(bytes, tfPos)
        tfPos += 8
      }
      if (tfFlags & 0x000002) {
        if (tfPos + 4 > tfhdEnd) throw new Error(`mp4-muxer: truncated tfhd on track ${trackId}`)
        tfPos += 4
      }
      let tfhdDefaultDur = trex.defaultDuration
      if (tfFlags & 0x000008) {
        if (tfPos + 4 > tfhdEnd) throw new Error(`mp4-muxer: truncated tfhd on track ${trackId}`)
        tfhdDefaultDur = readUint32(bytes, tfPos)
        tfPos += 4
      }
      let tfhdDefaultSize = trex.defaultSize
      if (tfFlags & 0x000010) {
        if (tfPos + 4 > tfhdEnd) throw new Error(`mp4-muxer: truncated tfhd on track ${trackId}`)
        tfhdDefaultSize = readUint32(bytes, tfPos)
        tfPos += 4
      }
      let tfhdDefaultFlags = trex.defaultFlags
      if (tfFlags & 0x000020) {
        if (tfPos + 4 > tfhdEnd) throw new Error(`mp4-muxer: truncated tfhd on track ${trackId}`)
        tfhdDefaultFlags = readUint32(bytes, tfPos)
      }

      const defaultBase = (tfFlags & 0x020000) || firstTraf ? box.start : runningMdatOffset
      firstTraf = false

      const tfdt = trafChildren.find((entry) => entry.type === 'tfdt')
      let decodeTime = runningDecodeTime
      if (tfdt) {
        const tfdtVer = bytes[tfdt.start + tfdt.headerSize]!
        const timeOff = tfdt.start + tfdt.headerSize + 4
        if (tfdtVer === 1 && timeOff + 8 <= tfdt.start + tfdt.size) {
          decodeTime = readUint64(bytes, timeOff)
        } else if (timeOff + 4 <= tfdt.start + tfdt.size) {
          decodeTime = readUint32(bytes, timeOff)
        }
      }

      for (const trun of trafChildren) {
        if (trun.type !== 'trun') continue
        if (trun.size < trun.headerSize + 8) throw new Error(`mp4-muxer: truncated trun on track ${trackId}`)
        const trunStart = trun.start + trun.headerSize
        const trunEnd = trun.start + trun.size
        const trVer = bytes[trunStart]!
        const trFlags = (bytes[trunStart + 1]! << 16)
          | (bytes[trunStart + 2]! << 8)
          | bytes[trunStart + 3]!
        const sampleCount = readUint32(bytes, trunStart + 4)
        let trPos = trunStart + 8

        let dataOffset: number | undefined
        if (trFlags & 0x000001) {
          if (trPos + 4 > trunEnd) throw new Error(`mp4-muxer: truncated trun data_offset on track ${trackId}`)
          dataOffset = readInt32(bytes, trPos)
          trPos += 4
        }
        let firstSampleFlags: number | undefined
        if (trFlags & 0x000004) {
          if (trPos + 4 > trunEnd) throw new Error(`mp4-muxer: truncated trun first_sample_flags on track ${trackId}`)
          firstSampleFlags = readUint32(bytes, trPos)
          trPos += 4
        }

        const anchor = baseDataOffset ?? defaultBase
        let runByteStart = runningMdatOffset
        if (dataOffset !== undefined) {
          const candidateStart = anchor + dataOffset
          if (candidateStart < mdatPayloadStart || candidateStart > mdatEnd) {
            throw new Error(`mp4-muxer: trun data_offset out of mdat bounds on track ${trackId}`)
          }
          runByteStart = candidateStart
        }

        const fieldsPerSample = Number(Boolean(trFlags & 0x000100))
          + Number(Boolean(trFlags & 0x000200))
          + Number(Boolean(trFlags & 0x000400))
          + Number(Boolean(trFlags & 0x000800))
        if (trPos + sampleCount * fieldsPerSample * 4 > trunEnd) {
          throw new Error(`mp4-muxer: truncated trun entries on track ${trackId}`)
        }
        if (sampleCount > 1 && !(trFlags & 0x000200) && tfhdDefaultSize === 0) {
          throw new Error(`mp4-muxer: trun has zero-size samples on track ${trackId}`)
        }
        if (!(trFlags & 0x000200) && tfhdDefaultSize > 0 && runByteStart + sampleCount * tfhdDefaultSize > mdatEnd) {
          throw new Error(`mp4-muxer: sample exceeds mdat bounds on track ${trackId}`)
        }

        const fragStartSample = samples.length
        let runBytes = 0
        let runDuration = 0
        for (let s = 0; s < sampleCount; s += 1) {
          const duration = (trFlags & 0x000100)
            ? readUint32(bytes, (trPos += 4) - 4)
            : tfhdDefaultDur
          let size = (trFlags & 0x000200)
            ? readUint32(bytes, (trPos += 4) - 4)
            : tfhdDefaultSize
          if (size === 0 && sampleCount === 1) {
            size = Math.max(0, mdatEnd - runByteStart)
          }
          const flags = (trFlags & 0x000400)
            ? readUint32(bytes, (trPos += 4) - 4)
            : (s === 0 && firstSampleFlags !== undefined ? firstSampleFlags : tfhdDefaultFlags)
          const ctsOffset = (trFlags & 0x000800)
            ? (trVer === 1 ? readInt32(bytes, (trPos += 4) - 4) : readUint32(bytes, (trPos += 4) - 4))
            : 0
          if (runByteStart + runBytes + size > mdatEnd) {
            throw new Error(`mp4-muxer: sample exceeds mdat bounds on track ${trackId}`)
          }
          samples.push({
            duration,
            size,
            ctsOffset,
            isSync: (flags & NON_SYNC_SAMPLE_FLAG) === 0,
            dts: decodeTime + runDuration,
            byteOffset: runByteStart + runBytes,
          })
          runBytes += size
          runDuration += duration
        }

        fragmentChunks.push({
          startSample: fragStartSample,
          sampleCount,
          decodeTime,
          byteStart: runByteStart,
          hasZeroDuration: sampleCount > 0 && runDuration === 0,
        })
        decodeTime += runDuration
        runningMdatOffset = runByteStart + runBytes
      }
      runningDecodeTime = decodeTime
    }
  }

  if (samples.length === 0) {
    throw new Error(`mp4-muxer: track ${trackId} contains no media samples`)
  }

  // Backfill samples whose source omitted duration everywhere using the next fragment's decode timestamp.
  for (let i = 0; i < fragmentChunks.length; i += 1) {
    const frag = fragmentChunks[i]!
    if (!frag.hasZeroDuration) continue
    const next = fragmentChunks[i + 1]
    const span = next && next.decodeTime > frag.decodeTime ? next.decodeTime - frag.decodeTime : frag.sampleCount
    const perSample = Math.max(1, Math.round(span / frag.sampleCount))
    for (let s = 0; s < frag.sampleCount; s += 1) {
      samples[frag.startSample + s]!.duration = perSample
    }
  }

  // Split contiguous fragment runs into ~1 s chunks so audio and video interleave tightly for progressive playback.
  const targetChunkTicks = Math.max(1, mdhdTimescale * TARGET_CHUNK_SEC)
  const chunkRecords: ChunkRecord[] = []
  let order = 0
  let curDecode = 0
  for (const frag of fragmentChunks) {
    curDecode = Math.max(curDecode, frag.decodeTime)
    let pos = frag.byteStart
    let chunkStartByte = pos
    let chunkByteLen = 0
    let chunkDur = 0
    let chunkSamples = 0
    let chunkDecodeStart = curDecode

    for (let s = 0; s < frag.sampleCount; s += 1) {
      const sample = samples[frag.startSample + s]!
      sample.dts = curDecode
      sample.byteOffset = pos
      if (chunkSamples > 0 && chunkDur + sample.duration > targetChunkTicks) {
        chunkRecords.push({
          trackId,
          decodeTimeSec: chunkDecodeStart / mdhdTimescale,
          order: order++,
          sampleCount: chunkSamples,
          payload: bytes.subarray(chunkStartByte, chunkStartByte + chunkByteLen),
        })
        chunkStartByte = pos
        chunkByteLen = 0
        chunkDur = 0
        chunkSamples = 0
        chunkDecodeStart = curDecode
      }
      chunkSamples += 1
      chunkByteLen += sample.size
      chunkDur += sample.duration
      curDecode += sample.duration
      pos += sample.size
    }
    if (chunkSamples > 0) {
      chunkRecords.push({
        trackId,
        decodeTimeSec: chunkDecodeStart / mdhdTimescale,
        order: order++,
        sampleCount: chunkSamples,
        payload: bytes.subarray(chunkStartByte, chunkStartByte + chunkByteLen),
      })
    }
  }

  let totalDurationTicks = 0
  for (const sample of samples) totalDurationTicks += sample.duration

  return {
    trackId,
    mvhdTimescale,
    tkhdData: tkhd.data,
    mdhdData: mdhd.data,
    mdhdTimescale,
    hdlrData: hdlr.data,
    vmhdOrSmhdData,
    dinfData,
    stsdData: stsd.data,
    codecBrand,
    elstEntries,
    samples,
    chunks: chunkRecords,
    totalDurationTicks,
    sourceBytes: bytes,
  }
}

const buildFtyp = (videoCodecBrand: string, hasSignedCtts: boolean): Uint8Array => {
  const brands = ['isom', 'iso2']
  if (hasSignedCtts) brands.push('iso4')
  if (videoCodecBrand && !brands.includes(videoCodecBrand)) brands.push(videoCodecBrand)
  if (!brands.includes('mp41')) brands.push('mp41')
  const payload = new Uint8Array(8 + brands.length * 4)
  writeType(payload, 0, 'isom')
  writeUint32(payload, 4, 0x00000200)
  for (let i = 0; i < brands.length; i += 1) {
    writeType(payload, 8 + i * 4, brands[i]!)
  }
  return wrapBox('ftyp', [payload])
}

const buildMvhd = (durationMs: number, nextTrackId: number): Uint8Array => {
  const use64 = durationMs > 0xffffffff
  const payload = new Uint8Array(use64 ? 108 : 96)
  if (use64) {
    writeUint32(payload, 16, MOVIE_TIMESCALE)
    writeUint64(payload, 20, durationMs)
    writeUint32(payload, 28, 0x00010000)
    writeUint16(payload, 32, 0x0100)
    writeUint32(payload, 44, 0x00010000)
    writeUint32(payload, 60, 0x00010000)
    writeUint32(payload, 76, 0x40000000)
    writeUint32(payload, 104, nextTrackId)
    return wrapFullBox('mvhd', 1, 0, payload)
  }
  writeUint32(payload, 8, MOVIE_TIMESCALE)
  writeUint32(payload, 12, durationMs)
  writeUint32(payload, 16, 0x00010000)
  writeUint16(payload, 20, 0x0100)
  writeUint32(payload, 32, 0x00010000)
  writeUint32(payload, 48, 0x00010000)
  writeUint32(payload, 64, 0x40000000)
  writeUint32(payload, 92, nextTrackId)
  return wrapFullBox('mvhd', 0, 0, payload)
}

const buildTkhd = (src: Uint8Array, trackId: 1 | 2, durationMs: number): Uint8Array => {
  const headerSize = readUint32(src, 0) === 1 ? 16 : 8
  const version = src[headerSize]!
  const srcFlags = ((src[headerSize + 1]! << 16) | (src[headerSize + 2]! << 8) | src[headerSize + 3]!) | 0x3
  const srcTail = src.subarray(headerSize + (version === 1 ? 36 : 24))
  const use64 = durationMs > 0xffffffff
  const prefixSize = use64 ? 32 : 20
  const payload = new Uint8Array(prefixSize + srcTail.byteLength)
  if (use64) {
    writeUint32(payload, 16, trackId)
    writeUint64(payload, 24, durationMs)
  } else {
    writeUint32(payload, 8, trackId)
    writeUint32(payload, 16, durationMs)
  }
  payload.set(srcTail, prefixSize)
  return wrapFullBox('tkhd', use64 ? 1 : 0, srcFlags, payload)
}

const buildEdts = (entries: readonly ElstEntry[], srcMvhdTimescale: number, trackDurationMs: number): Uint8Array | undefined => {
  if (entries.length === 0) return undefined
  const scaled = entries.map((entry) => ({
    segmentDuration: entry.segmentDuration > 0 && srcMvhdTimescale > 0
      ? Math.round((entry.segmentDuration * MOVIE_TIMESCALE) / srcMvhdTimescale)
      : trackDurationMs,
    mediaTime: entry.mediaTime,
    rateInt: entry.rateInt,
    rateFrac: entry.rateFrac,
  }))
  const use64 = scaled.some((e) => e.segmentDuration > 0xffffffff || e.mediaTime < -0x8000_0000 || e.mediaTime > 0x7fff_ffff)
  const entrySize = use64 ? 20 : 12
  const payload = new Uint8Array(4 + scaled.length * entrySize)
  writeUint32(payload, 0, scaled.length)
  scaled.forEach((entry, index) => {
    const pos = 4 + index * entrySize
    if (use64) {
      writeUint64(payload, pos, entry.segmentDuration)
      writeInt64(payload, pos + 8, entry.mediaTime)
      writeUint16(payload, pos + 16, entry.rateInt & 0xffff)
      writeUint16(payload, pos + 18, entry.rateFrac & 0xffff)
    } else {
      writeUint32(payload, pos, entry.segmentDuration)
      writeInt32(payload, pos + 4, entry.mediaTime)
      writeUint16(payload, pos + 8, entry.rateInt & 0xffff)
      writeUint16(payload, pos + 10, entry.rateFrac & 0xffff)
    }
  })
  return wrapBox('edts', [wrapFullBox('elst', use64 ? 1 : 0, 0, payload)])
}

const buildMdhd = (src: Uint8Array, timescale: number, durationTicks: number): Uint8Array => {
  const headerSize = readUint32(src, 0) === 1 ? 16 : 8
  const srcVer = src[headerSize]!
  const langBytes = src.subarray(headerSize + (srcVer === 1 ? 32 : 20), headerSize + (srcVer === 1 ? 36 : 24))
  const use64 = durationTicks > 0xffffffff
  const prefixSize = use64 ? 28 : 16
  const payload = new Uint8Array(prefixSize + 4)
  if (use64) {
    writeUint32(payload, 16, timescale)
    writeUint64(payload, 20, durationTicks)
  } else {
    writeUint32(payload, 8, timescale)
    writeUint32(payload, 12, durationTicks)
  }
  payload.set(langBytes.byteLength === 4 ? langBytes : Uint8Array.from([0x55, 0xc4, 0, 0]), prefixSize)
  return wrapFullBox('mdhd', use64 ? 1 : 0, 0, payload)
}

const buildStts = (samples: readonly SampleRecord[]): Uint8Array => {
  const runs: { count: number, delta: number }[] = []
  for (const sample of samples) {
    const prev = runs[runs.length - 1]
    if (prev && prev.delta === sample.duration) prev.count += 1
    else runs.push({ count: 1, delta: sample.duration })
  }
  const payload = new Uint8Array(4 + runs.length * 8)
  writeUint32(payload, 0, runs.length)
  runs.forEach((run, index) => {
    writeUint32(payload, 4 + index * 8, run.count)
    writeUint32(payload, 8 + index * 8, run.delta)
  })
  return wrapFullBox('stts', 0, 0, payload)
}

const buildCtts = (samples: readonly SampleRecord[]): Uint8Array | undefined => {
  let hasNonZero = false
  let hasNegative = false
  for (const sample of samples) {
    if (sample.ctsOffset !== 0) hasNonZero = true
    if (sample.ctsOffset < 0) hasNegative = true
  }
  if (!hasNonZero) return undefined
  const runs: { count: number, offset: number }[] = []
  for (const sample of samples) {
    const prev = runs[runs.length - 1]
    if (prev && prev.offset === sample.ctsOffset) prev.count += 1
    else runs.push({ count: 1, offset: sample.ctsOffset })
  }
  const version = hasNegative ? 1 : 0
  const payload = new Uint8Array(4 + runs.length * 8)
  writeUint32(payload, 0, runs.length)
  runs.forEach((run, index) => {
    writeUint32(payload, 4 + index * 8, run.count)
    if (version === 1) writeInt32(payload, 8 + index * 8, run.offset)
    else writeUint32(payload, 8 + index * 8, run.offset)
  })
  return wrapFullBox('ctts', version, 0, payload)
}

const buildStss = (samples: readonly SampleRecord[]): Uint8Array | undefined => {
  const syncIndices: number[] = []
  for (let i = 0; i < samples.length; i += 1) {
    if (samples[i]!.isSync) syncIndices.push(i + 1)
  }
  if (syncIndices.length === samples.length) return undefined
  const payload = new Uint8Array(4 + syncIndices.length * 4)
  writeUint32(payload, 0, syncIndices.length)
  syncIndices.forEach((sampleNum, index) => {
    writeUint32(payload, 4 + index * 4, sampleNum)
  })
  return wrapFullBox('stss', 0, 0, payload)
}

const buildStsc = (chunkSampleCounts: readonly number[]): Uint8Array => {
  const entries: { firstChunk: number, samplesPerChunk: number }[] = []
  chunkSampleCounts.forEach((count, index) => {
    const prev = entries[entries.length - 1]
    if (!prev || prev.samplesPerChunk !== count) {
      entries.push({ firstChunk: index + 1, samplesPerChunk: count })
    }
  })
  const payload = new Uint8Array(4 + entries.length * 12)
  writeUint32(payload, 0, entries.length)
  entries.forEach((entry, index) => {
    writeUint32(payload, 4 + index * 12, entry.firstChunk)
    writeUint32(payload, 8 + index * 12, entry.samplesPerChunk)
    writeUint32(payload, 12 + index * 12, 1)
  })
  return wrapFullBox('stsc', 0, 0, payload)
}

const buildStsz = (samples: readonly SampleRecord[]): Uint8Array => {
  const payload = new Uint8Array(8 + samples.length * 4)
  writeUint32(payload, 0, 0)
  writeUint32(payload, 4, samples.length)
  samples.forEach((sample, index) => {
    writeUint32(payload, 8 + index * 4, sample.size)
  })
  return wrapFullBox('stsz', 0, 0, payload)
}

const buildChunkOffsets = (offsets: readonly number[], use64: boolean): Uint8Array => {
  const payload = new Uint8Array(4 + offsets.length * (use64 ? 8 : 4))
  writeUint32(payload, 0, offsets.length)
  offsets.forEach((offset, index) => {
    if (use64) writeUint64(payload, 4 + index * 8, offset)
    else writeUint32(payload, 4 + index * 4, offset)
  })
  return wrapFullBox(use64 ? 'co64' : 'stco', 0, 0, payload)
}

const defaultDinf = (): Uint8Array => {
  const url = wrapFullBox('url ', 0, 1, new Uint8Array(0))
  const drefPayload = new Uint8Array(4)
  writeUint32(drefPayload, 0, 1)
  return wrapBox('dinf', [wrapFullBox('dref', 0, 0, concatChunks([drefPayload, url]))])
}

const buildTrak = (
  track: ParsedTrack,
  chunkSampleCounts: readonly number[],
  chunkOffsets: readonly number[],
  useCo64: boolean,
): Uint8Array => {
  const trackDurationMs = track.overrideDurationMs
    ?? Math.round((track.totalDurationTicks * MOVIE_TIMESCALE) / track.mdhdTimescale)
  const stblChildren: Uint8Array[] = [track.stsdData, buildStts(track.samples)]
  const ctts = buildCtts(track.samples)
  if (ctts) stblChildren.push(ctts)
  const stss = buildStss(track.samples)
  if (stss) stblChildren.push(stss)
  stblChildren.push(
    buildStsc(chunkSampleCounts),
    buildStsz(track.samples),
    buildChunkOffsets(chunkOffsets, useCo64),
  )

  const minfChildren: Uint8Array[] = []
  if (track.vmhdOrSmhdData) minfChildren.push(track.vmhdOrSmhdData)
  minfChildren.push(track.dinfData ?? defaultDinf(), wrapBox('stbl', stblChildren))

  const mdia = wrapBox('mdia', [
    buildMdhd(track.mdhdData, track.mdhdTimescale, track.totalDurationTicks),
    track.hdlrData,
    wrapBox('minf', minfChildren),
  ])

  const trakChildren: Uint8Array[] = [buildTkhd(track.tkhdData, track.trackId, trackDurationMs)]
  const edts = buildEdts(track.elstEntries, track.mvhdTimescale, trackDurationMs)
  if (edts) trakChildren.push(edts)
  trakChildren.push(mdia)
  return wrapBox('trak', trakChildren)
}

const trimTrack = (
  track: ParsedTrack,
  trim: TrimRange,
  cutStartMs = trim.startMs,
): { track: ParsedTrack, actualCutStartMs: number } => {
  const { samples, mdhdTimescale, sourceBytes } = track
  const startTicks = Math.round((trim.startMs * mdhdTimescale) / 1000)
  const cutTicks = Math.round((cutStartMs * mdhdTimescale) / 1000)
  const endTicks = Math.round((trim.endMs * mdhdTimescale) / 1000)
  const requestedClipMs = Math.max(1, Math.round(trim.endMs - trim.startMs))
  const baseEditOffset = track.elstEntries.find((entry) => entry.mediaTime >= 0)?.mediaTime ?? 0
  const targetStartCts = startTicks + baseEditOffset
  const cutStartCts = cutTicks + baseEditOffset
  const targetEndCts = endTicks + baseEditOffset

  const firstAtOrAfter = (() => {
    const idx = samples.findIndex((sample) => sample.dts + sample.ctsOffset >= cutStartCts)
    return idx >= 0 ? idx : samples.length - 1
  })()

  const allSync = samples.every((sample) => sample.isSync)
  let startIdx = firstAtOrAfter
  if (allSync) {
    const chosen = samples[firstAtOrAfter]!
    if (firstAtOrAfter > 0 && chosen.dts + chosen.ctsOffset > cutStartCts) {
      startIdx = firstAtOrAfter - 1
    }
  } else {
    let syncIdx = -1
    for (let i = Math.min(firstAtOrAfter, samples.length - 1); i >= 0; i -= 1) {
      const candidate = samples[i]!
      if (candidate.isSync && candidate.dts + candidate.ctsOffset <= cutStartCts) {
        syncIdx = i
        break
      }
    }
    if (syncIdx < 0) {
      syncIdx = samples.findIndex((sample) => sample.isSync)
    }
    startIdx = syncIdx >= 0 ? syncIdx : 0
  }

  let endIdx = startIdx
  for (let i = startIdx; i < samples.length; i += 1) {
    const sample = samples[i]!
    if (Math.min(sample.dts, sample.dts + sample.ctsOffset) < targetEndCts) {
      endIdx = i
    }
  }
  const kept = samples.slice(startIdx, endIdx + 1)
  if (kept.length === 0) {
    throw new Error(`mp4-muxer: track ${track.trackId} contains no samples in trimmed range`)
  }

  const baseDts = kept[0]!.dts
  const elstMediaTime = Math.max(0, Math.round(targetStartCts - baseDts))
  const actualCutStartMs = trim.startMs - ((targetStartCts - baseDts) * 1000) / mdhdTimescale
  let totalDurationTicks = 0
  for (const sample of kept) totalDurationTicks += sample.duration
  const availableDurationMs = Math.max(
    1,
    Math.round(((totalDurationTicks - elstMediaTime) * MOVIE_TIMESCALE) / mdhdTimescale),
  )
  const trimmedDurationMs = Math.min(requestedClipMs, availableDurationMs)

  const targetChunkTicks = Math.max(1, mdhdTimescale * TARGET_CHUNK_SEC)
  const chunks: ChunkRecord[] = []
  let order = 0
  let batch: SampleRecord[] = []
  let batchDur = 0
  let batchDts = kept[0]!.dts

  const flushBatch = () => {
    if (batch.length === 0) return
    let contiguous = true
    for (let i = 1; i < batch.length; i += 1) {
      const prev = batch[i - 1]!
      if (prev.byteOffset + prev.size !== batch[i]!.byteOffset) {
        contiguous = false
        break
      }
    }
    const payload = contiguous
      ? sourceBytes.subarray(batch[0]!.byteOffset, batch[batch.length - 1]!.byteOffset + batch[batch.length - 1]!.size)
      : concatChunks(batch.map((s) => sourceBytes.subarray(s.byteOffset, s.byteOffset + s.size)))
    chunks.push({
      trackId: track.trackId,
      decodeTimeSec: (batchDts - baseDts) / mdhdTimescale,
      order: order++,
      sampleCount: batch.length,
      payload,
    })
    batch = []
    batchDur = 0
  }

  for (const sample of kept) {
    if (batch.length > 0 && batchDur + sample.duration > targetChunkTicks) {
      flushBatch()
      batchDts = sample.dts
    }
    batch.push(sample)
    batchDur += sample.duration
  }
  flushBatch()

  return {
    track: {
      ...track,
      mvhdTimescale: MOVIE_TIMESCALE,
      elstEntries: [{
        segmentDuration: trimmedDurationMs,
        mediaTime: elstMediaTime,
        rateInt: 1,
        rateFrac: 0,
      }],
      samples: kept,
      chunks,
      totalDurationTicks,
      overrideDurationMs: trimmedDurationMs,
    },
    actualCutStartMs,
  }
}

const finalizeMdatAndMoov = (ftyp: Uint8Array, mvhd: Uint8Array, tracks: readonly ParsedTrack[], combined: readonly ChunkRecord[]): Uint8Array[] => {
  const countsByTrack = new Map<number, number[]>()
  const offsetsByTrack = new Map<number, number[]>()
  for (const t of tracks) {
    countsByTrack.set(t.trackId, [])
    offsetsByTrack.set(t.trackId, [])
  }
  let mdatPayloadBytes = 0
  for (const chunk of combined) {
    countsByTrack.get(chunk.trackId)!.push(chunk.sampleCount)
    offsetsByTrack.get(chunk.trackId)!.push(mdatPayloadBytes)
    mdatPayloadBytes += chunk.payload.byteLength
  }

  const mdatLarge = mdatPayloadBytes + 8 > 0xffffffff
  const mdatHeaderSize = mdatLarge ? 16 : 8

  const assembleMoov = (mdatDataStart: number, useCo64: boolean) => wrapBox('moov', [
    mvhd,
    ...tracks.map((track) =>
      buildTrak(
        track,
        countsByTrack.get(track.trackId)!,
        offsetsByTrack.get(track.trackId)!.map((off) => mdatDataStart + off),
        useCo64,
      ),
    ),
  ])

  const measure32 = assembleMoov(0, false)
  const useCo64 = ftyp.byteLength + measure32.byteLength + mdatHeaderSize + mdatPayloadBytes > 0xffffffff
  const placeholderMoov = useCo64 ? assembleMoov(0, true) : measure32
  const mdatDataStart = ftyp.byteLength + placeholderMoov.byteLength + mdatHeaderSize
  const moov = assembleMoov(mdatDataStart, useCo64)

  const mdatHeader = new Uint8Array(mdatHeaderSize)
  if (mdatLarge) {
    writeUint32(mdatHeader, 0, 1)
    writeType(mdatHeader, 4, 'mdat')
    writeUint64(mdatHeader, 8, mdatHeaderSize + mdatPayloadBytes)
  } else {
    writeUint32(mdatHeader, 0, mdatHeaderSize + mdatPayloadBytes)
    writeType(mdatHeader, 4, 'mdat')
  }

  return [ftyp, moov, mdatHeader, ...combined.map((chunk) => chunk.payload)]
}

/**
 * Remuxes two fragmented MP4 elementary tracks (`videoChunks` as track 1 and `audioChunks` as track 2) into a
 * standard non-fragmented fast-start ISO-BMFF MP4, optionally trimmed to `[trim.startMs, trim.endMs]`.
 */
export const muxMp4 = (
  videoChunks: readonly Uint8Array[],
  audioChunks: readonly Uint8Array[],
  trim?: TrimRange,
): Uint8Array[] => {
  const rawVideo = parseTrack(videoChunks, 1)
  const rawAudio = parseTrack(audioChunks, 2)
  let video = rawVideo
  let audio = rawAudio
  if (trim) {
    const trimmedVideo = trimTrack(rawVideo, trim)
    // Align audio's cut point to video's resolved keyframe pre-roll so edit-list-ignoring players stay A/V synced too.
    const trimmedAudio = trimTrack(rawAudio, trim, Math.min(trim.startMs, trimmedVideo.actualCutStartMs))
    const sharedDurationMs = Math.min(
      trimmedVideo.track.overrideDurationMs ?? 0,
      trimmedAudio.track.overrideDurationMs ?? 0,
    )
    video = {
      ...trimmedVideo.track,
      overrideDurationMs: sharedDurationMs,
      elstEntries: trimmedVideo.track.elstEntries.map((entry) => ({ ...entry, segmentDuration: sharedDurationMs })),
    }
    audio = {
      ...trimmedAudio.track,
      overrideDurationMs: sharedDurationMs,
      elstEntries: trimmedAudio.track.elstEntries.map((entry) => ({ ...entry, segmentDuration: sharedDurationMs })),
    }
  }

  const hasSignedCtts = video.samples.some((sample) => sample.ctsOffset < 0)
    || audio.samples.some((sample) => sample.ctsOffset < 0)
  const ftyp = buildFtyp(video.codecBrand, hasSignedCtts)
  const videoDurationMs = video.overrideDurationMs
    ?? Math.round((video.totalDurationTicks * MOVIE_TIMESCALE) / video.mdhdTimescale)
  const audioDurationMs = audio.overrideDurationMs
    ?? Math.round((audio.totalDurationTicks * MOVIE_TIMESCALE) / audio.mdhdTimescale)
  const movieDurationMs = trim ? Math.min(videoDurationMs, audioDurationMs) : Math.max(videoDurationMs, audioDurationMs)
  const mvhd = buildMvhd(movieDurationMs, 3)

  const combined = [...video.chunks, ...audio.chunks].sort((a, b) =>
    a.decodeTimeSec - b.decodeTimeSec || a.trackId - b.trackId || a.order - b.order,
  )
  return finalizeMdatAndMoov(ftyp, mvhd, [video, audio], combined)
}

/**
 * Remuxes (and trims when `trim` is provided) a fragmented MP4 audio track (`audioChunks`) into a non-fragmented
 * fast-start M4A/MP4 container suitable for `new Blob(parts, { type: 'audio/mp4' })`.
 */
export const muxMp4Audio = (audioChunks: readonly Uint8Array[], trim?: TrimRange): Uint8Array[] => {
  const rawAudio = parseTrack(audioChunks, 1)
  const audio = trim ? trimTrack(rawAudio, trim).track : rawAudio
  const hasSignedCtts = audio.samples.some((sample) => sample.ctsOffset < 0)
  const ftyp = buildFtyp(audio.codecBrand, hasSignedCtts)
  const movieDurationMs = audio.overrideDurationMs
    ?? Math.round((audio.totalDurationTicks * MOVIE_TIMESCALE) / audio.mdhdTimescale)
  const mvhd = buildMvhd(movieDurationMs, 2)
  return finalizeMdatAndMoov(ftyp, mvhd, [audio], audio.chunks)
}
