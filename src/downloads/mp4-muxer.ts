type Mp4Box = {
  type: string
  start: number
  headerSize: number
  size: number
  data: Uint8Array
}

type Fragment = {
  trackId: 1 | 2
  decodeTimeSec: number
  order: number
  moof: Uint8Array
  mdat: Uint8Array
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

const readUint32 = (bytes: Uint8Array, offset: number): number =>
  ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0

const writeUint32 = (bytes: Uint8Array, offset: number, value: number) => {
  bytes[offset] = (value >>> 24) & 0xff
  bytes[offset + 1] = (value >>> 16) & 0xff
  bytes[offset + 2] = (value >>> 8) & 0xff
  bytes[offset + 3] = value & 0xff
}

const readUint64 = (bytes: Uint8Array, offset: number): number =>
  readUint32(bytes, offset) * 0x1_0000_0000 + readUint32(bytes, offset + 4)

const readType = (bytes: Uint8Array, offset: number): string =>
  String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!)

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
  out[4] = type.charCodeAt(0)
  out[5] = type.charCodeAt(1)
  out[6] = type.charCodeAt(2)
  out[7] = type.charCodeAt(3)
  let offset = 8
  for (const child of children) {
    out.set(child, offset)
    offset += child.byteLength
  }
  return out
}

const makeTrex = (trackId: number): Uint8Array => {
  const payload = new Uint8Array(24)
  writeUint32(payload, 4, trackId)
  writeUint32(payload, 8, 1)
  return wrapBox('trex', [payload])
}

const patchTrackInTrak = (trak: Uint8Array, trackId: number): { patched: Uint8Array, timescale: number } => {
  const copy = Uint8Array.from(trak)
  const children = readBoxes(copy, 8, copy.byteLength)
  const tkhd = children.find((box) => box.type === 'tkhd')
  if (!tkhd) throw new Error('mp4-muxer: trak is missing tkhd box')
  const tkhdVersion = copy[tkhd.start + tkhd.headerSize]!
  const trackIdOffset = tkhd.start + tkhd.headerSize + (tkhdVersion === 1 ? 20 : 12)
  if (trackIdOffset + 4 > tkhd.start + tkhd.size) {
    throw new Error('mp4-muxer: tkhd box is truncated')
  }
  writeUint32(copy, trackIdOffset, trackId)

  let timescale = 1
  const mdia = children.find((box) => box.type === 'mdia')
  if (mdia) {
    const mdiaChildren = readBoxes(copy, mdia.start + mdia.headerSize, mdia.start + mdia.size)
    const mdhd = mdiaChildren.find((box) => box.type === 'mdhd')
    if (mdhd) {
      const mdhdVersion = copy[mdhd.start + mdhd.headerSize]!
      const timescaleOffset = mdhd.start + mdhd.headerSize + (mdhdVersion === 1 ? 20 : 12)
      if (timescaleOffset + 4 <= mdhd.start + mdhd.size) {
        timescale = readUint32(copy, timescaleOffset) || 1
      }
    }
  }
  return { patched: copy, timescale }
}

const patchMvexTrack = (mvex: Uint8Array | undefined, trackId: number): { mehd?: Uint8Array, trex: Uint8Array } => {
  if (!mvex) return { trex: makeTrex(trackId) }
  const children = readBoxes(mvex, 8, mvex.byteLength)
  const mehd = children.find((box) => box.type === 'mehd')?.data
  const trex = children.find((box) => box.type === 'trex')
  if (!trex || trex.size < 32) return { mehd, trex: makeTrex(trackId) }
  const copy = Uint8Array.from(trex.data)
  writeUint32(copy, trex.headerSize + 4, trackId)
  return { mehd, trex: copy }
}

const parseTrack = (chunks: readonly Uint8Array[], trackId: 1 | 2) => {
  const bytes = concatChunks(chunks)
  const top = readBoxes(bytes)
  const ftyp = top.find((box) => box.type === 'ftyp')?.data
  const moov = top.find((box) => box.type === 'moov')
  if (!moov) throw new Error(`mp4-muxer: track ${trackId} is missing moov box`)

  const moovChildren = readBoxes(moov.data, moov.headerSize, moov.size)
  const mvhd = moovChildren.find((box) => box.type === 'mvhd')?.data
  const trak = moovChildren.find((box) => box.type === 'trak')?.data
  const mvex = moovChildren.find((box) => box.type === 'mvex')?.data
  if (!mvhd || !trak) throw new Error(`mp4-muxer: track ${trackId} moov is missing mvhd or trak`)

  const { patched: patchedTrak, timescale } = patchTrackInTrak(trak, trackId)
  const { mehd, trex } = patchMvexTrack(mvex, trackId)

  const fragments: Fragment[] = []
  let order = 0
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

    const moofCopy = Uint8Array.from(box.data)
    const moofChildren = readBoxes(moofCopy, box.headerSize, box.size)
    let decodeTime = 0
    for (const child of moofChildren) {
      if (child.type !== 'traf') continue
      const trafChildren = readBoxes(moofCopy, child.start + child.headerSize, child.start + child.size)
      const tfhd = trafChildren.find((entry) => entry.type === 'tfhd')
      if (tfhd && tfhd.size >= tfhd.headerSize + 8) {
        writeUint32(moofCopy, tfhd.start + tfhd.headerSize + 4, trackId)
      }
      const tfdt = trafChildren.find((entry) => entry.type === 'tfdt')
      if (tfdt) {
        const version = moofCopy[tfdt.start + tfdt.headerSize]!
        const timeOffset = tfdt.start + tfdt.headerSize + 4
        if (version === 1 && timeOffset + 8 <= tfdt.start + tfdt.size) {
          decodeTime = readUint64(moofCopy, timeOffset)
        } else if (timeOffset + 4 <= tfdt.start + tfdt.size) {
          decodeTime = readUint32(moofCopy, timeOffset)
        }
      }
    }

    fragments.push({
      trackId,
      decodeTimeSec: decodeTime / timescale,
      order: order++,
      moof: moofCopy,
      mdat: mdat.data,
    })
  }

  return { ftyp, mvhd, patchedTrak, mehd, trex, fragments }
}

const patchMvhd = (mvhd: Uint8Array, nextTrackId: number): Uint8Array => {
  const copy = Uint8Array.from(mvhd)
  if (copy.byteLength < 108) throw new Error('mp4-muxer: mvhd box is truncated')
  writeUint32(copy, copy.byteLength - 4, nextTrackId)
  return copy
}

const patchMfhdSequence = (moof: Uint8Array, sequenceNumber: number) => {
  const children = readBoxes(moof, 8, moof.byteLength)
  const mfhd = children.find((box) => box.type === 'mfhd')
  if (mfhd && mfhd.size >= mfhd.headerSize + 8) {
    writeUint32(moof, mfhd.start + mfhd.headerSize + 4, sequenceNumber)
  }
}

/**
 * Muxes two fragmented MP4 elementary tracks (`videoChunks` as track 1 and `audioChunks` as track 2) into ordered
 * MP4 slices suitable for `new Blob(parts, { type: 'video/mp4' })`.
 */
export const muxMp4 = (videoChunks: readonly Uint8Array[], audioChunks: readonly Uint8Array[]): Uint8Array[] => {
  const video = parseTrack(videoChunks, 1)
  const audio = parseTrack(audioChunks, 2)

  const mvexChildren: Uint8Array[] = []
  const mehd = video.mehd ?? audio.mehd
  if (mehd) mvexChildren.push(mehd)
  mvexChildren.push(video.trex, audio.trex)
  const mvex = wrapBox('mvex', mvexChildren)

  const mvhd = patchMvhd(video.mvhd, 3)
  const moov = wrapBox('moov', [mvhd, video.patchedTrak, audio.patchedTrak, mvex])

  const combined = [...video.fragments, ...audio.fragments].sort((a, b) =>
    a.decodeTimeSec - b.decodeTimeSec || a.trackId - b.trackId || a.order - b.order,
  )

  const parts: Uint8Array[] = []
  if (video.ftyp) parts.push(video.ftyp)
  parts.push(moov)
  for (let index = 0; index < combined.length; index += 1) {
    const fragment = combined[index]!
    patchMfhdSequence(fragment.moof, index + 1)
    parts.push(fragment.moof, fragment.mdat)
  }
  return parts
}
