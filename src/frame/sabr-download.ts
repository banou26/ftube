import type { SabrFormat } from 'googlevideo/shared-types'
import type { TrimRange } from '../downloads/trim'

import {
  FormatInitializationMetadata,
  NextRequestPolicy,
  PlaybackCookie,
  ReloadPlaybackContext,
  SabrContextSendingPolicy,
  SabrContextUpdate,
  SabrContextWritePolicy,
  SabrError,
  SabrRedirect,
  StreamProtectionStatus,
  UMPPartId,
  VideoPlaybackAbrRequest,
} from 'googlevideo/protos'
import { base64ToU8, EnabledTrackTypes, FormatKeyUtils, MAX_INT32_VALUE } from 'googlevideo/utils'

import { MAX_DOWNLOAD_BYTES, MAX_DOWNLOAD_ERROR } from '../downloads/bytes'
import { applyClientAbrDefaults, createUmpFramer, createUmpSegmentCollector, wait } from './sabr'

const RANGE_PREROLL_MS = 5_000
const RANGE_TAIL_PAD_MS = 500
const MAX_EMPTY_ROUNDS = 6

type ProtoFormatId = {
  itag?: number
  lastModified?: string
  xtags?: string
}

const toFormatId = (format: SabrFormat): ProtoFormatId => ({
  itag: format.itag,
  ...(format.lastModified !== undefined ? { lastModified: String(format.lastModified) } : {}),
  ...(format.xtags !== undefined ? { xtags: format.xtags } : {}),
})

type SegmentMeta = {
  seq: number
  startMs: number
  durationMs: number
  startTicks: string
  durationTicks: string
  timescale: number
}

type DownloadTrackState = {
  kind: 'video' | 'audio'
  format: SabrFormat
  formatId: ProtoFormatId
  key: string
  initSegmentEmitted: boolean
  initMetadata?: ReturnType<typeof FormatInitializationMetadata.decode>
  endSegmentNumber?: number
  segments: Map<number, SegmentMeta>
  pendingPayloads: Map<number, Uint8Array>
  minSeq?: number
  nextFlushSeq?: number
  coveredStartMs?: number
  coveredEndMs: number
}

const buildTrackBufferedRanges = (track: DownloadTrackState) => {
  const ordered = [...track.segments.values()].sort((a, b) => a.seq - b.seq)
  if (ordered.length === 0) return []
  const ranges: {
    formatId: ProtoFormatId
    durationMs: string
    startTimeMs: string
    startSegmentIndex: number
    endSegmentIndex: number
    timeRange: { startTicks: string, durationTicks: string, timescale: number }
  }[] = []
  let runStart = ordered[0]!
  let runEnd = ordered[0]!
  let sumDurationMs = runStart.durationMs
  let sumDurationTicks = Number(runStart.durationTicks) || runStart.durationMs
  const pushRun = () => {
    ranges.push({
      formatId: track.initMetadata?.formatId ?? track.formatId,
      durationMs: String(sumDurationMs),
      startTimeMs: String(runStart.startMs),
      startSegmentIndex: runStart.seq,
      endSegmentIndex: runEnd.seq,
      timeRange: {
        startTicks: runStart.startTicks,
        durationTicks: String(sumDurationTicks),
        timescale: runStart.timescale,
      },
    })
  }
  for (let i = 1; i < ordered.length; i += 1) {
    const seg = ordered[i]!
    if (seg.seq === runEnd.seq + 1 && seg.timescale === runStart.timescale) {
      runEnd = seg
      sumDurationMs += seg.durationMs
      sumDurationTicks += Number(seg.durationTicks) || seg.durationMs
    } else {
      pushRun()
      runStart = seg
      runEnd = seg
      sumDurationMs = seg.durationMs
      sumDurationTicks = Number(seg.durationTicks) || seg.durationMs
    }
  }
  pushRun()
  return ranges
}

const hasContiguousSegmentsThrough = (track: DownloadTrackState, endSeq: number): boolean => {
  if (endSeq <= 0) return false
  for (let seq = 1; seq <= endSeq; seq += 1) {
    if (!track.segments.has(seq)) return false
  }
  return true
}

const isTrackComplete = (
  track: DownloadTrackState,
  targetEndMs: number,
  isTrimmed: boolean,
): boolean => {
  if (!track.initSegmentEmitted || track.segments.size === 0) return false
  if (track.endSegmentNumber && track.segments.has(track.endSegmentNumber)) {
    if (!isTrimmed) return hasContiguousSegmentsThrough(track, track.endSegmentNumber)
    return true
  }
  if (targetEndMs <= 0) return false
  const target = isTrimmed ? targetEndMs : targetEndMs * 0.995
  return track.coveredEndMs >= target
}

/** Arguments for executing a single unified SABR VOD download loop (full or cropped). */
export type RunSabrDownloadOptions = {
  streamingUrl: string
  ustreamerConfig: string
  clientInfo: unknown
  audioFormat: SabrFormat
  videoFormat?: SabrFormat
  fallbackVideoFormat: SabrFormat
  mode: 'video' | 'audio'
  effectiveDurationMs: number
  trim?: TrimRange
  initialPoToken?: string
  signal: AbortSignal
  maxBytes?: number
  fetch: (url: URL, init: RequestInit) => Promise<Response>
  refreshPoToken: (status2Only: boolean) => Promise<string | undefined>
  onChunk: (kind: 'video' | 'audio', data: Uint8Array) => void
  getPoToken?: () => string | undefined
}

/**
 * Runs a single SABR VOD ABR request loop for either full or cropped downloads, streaming contiguous media
 * chunks immediately via `onChunk` while keeping pending out-of-order segments bounded in memory.
 */
export const runSabrDownload = async (options: RunSabrDownloadOptions): Promise<void> => {
  const {
    audioFormat,
    videoFormat,
    fallbackVideoFormat,
    mode,
    effectiveDurationMs,
    trim,
    signal,
    maxBytes = MAX_DOWNLOAD_BYTES,
    fetch,
    refreshPoToken,
    onChunk,
  } = options

  const fetchStartMs = trim ? Math.max(0, trim.startMs - RANGE_PREROLL_MS) : 0
  const fetchTargetEndMs = trim
    ? Math.min(effectiveDurationMs, trim.endMs + RANGE_TAIL_PAD_MS)
    : effectiveDurationMs

  const audioTrack: DownloadTrackState = {
    kind: 'audio',
    format: audioFormat,
    formatId: toFormatId(audioFormat),
    key: FormatKeyUtils.fromFormat(audioFormat) ?? '',
    initSegmentEmitted: false,
    segments: new Map(),
    pendingPayloads: new Map(),
    coveredEndMs: 0,
  }
  const videoTrack: DownloadTrackState | undefined = videoFormat
    ? {
        kind: 'video',
        format: videoFormat,
        formatId: toFormatId(videoFormat),
        key: FormatKeyUtils.fromFormat(videoFormat) ?? '',
        initSegmentEmitted: false,
        segments: new Map(),
        pendingPayloads: new Map(),
        coveredEndMs: 0,
      }
    : undefined

  const activeTracks = videoTrack ? [videoTrack, audioTrack] : [audioTrack]
  const discardedVideoFormatId = !videoTrack && fallbackVideoFormat !== audioFormat
    ? toFormatId(fallbackVideoFormat)
    : undefined
  const discardedVideoKey = discardedVideoFormatId ? FormatKeyUtils.fromFormat(fallbackVideoFormat) : undefined

  let streamingUrl = options.streamingUrl
  let currentPoToken = options.initialPoToken
  let requestNumber = 0
  let nextRequestPolicy: ReturnType<typeof NextRequestPolicy.decode> | undefined
  const sabrContexts = new Map<number, ReturnType<typeof SabrContextUpdate.decode>>()
  const activeSabrContexts = new Set<number>()
  let emptyRounds = 0
  let totalBufferedBytes = 0
  let retriedStatus3 = false

  const checkMemoryLimit = (incomingBytes: number) => {
    totalBufferedBytes += incomingBytes
    if (totalBufferedBytes > maxBytes) {
      throw new Error(MAX_DOWNLOAD_ERROR)
    }
  }

  const startBoundarySatisfied = (track: DownloadTrackState, firstSeq: number) => {
    if (!trim) return firstSeq === 1
    return firstSeq === 1 || (track.coveredStartMs !== undefined && track.coveredStartMs <= trim.startMs + 250)
  }

  const flushContiguous = (track: DownloadTrackState) => {
    if (!track.initSegmentEmitted) return
    if (track.nextFlushSeq === undefined) {
      if (track.minSeq === undefined) return
      if (!startBoundarySatisfied(track, track.minSeq)) return
      track.nextFlushSeq = track.minSeq
    }
    while (track.pendingPayloads.has(track.nextFlushSeq)) {
      const data = track.pendingPayloads.get(track.nextFlushSeq)!
      track.pendingPayloads.delete(track.nextFlushSeq)
      onChunk(track.kind, data)
      track.nextFlushSeq += 1
    }
  }

  try {
    while (!signal.aborted) {
      if (activeTracks.every((track) => isTrackComplete(track, fetchTargetEndMs, Boolean(trim)))) {
        break
      }

      if (nextRequestPolicy?.backoffTimeMs && nextRequestPolicy.backoffTimeMs > 0) {
        await wait(Math.min(5_000, nextRequestPolicy.backoffTimeMs), signal)
      }

      const incomplete = activeTracks.filter((track) => !isTrackComplete(track, fetchTargetEndMs, Boolean(trim)))
      const coveredMins = incomplete
        .filter((track) => track.segments.size > 0)
        .map((track) => track.coveredEndMs)
      const playerTimeMs = coveredMins.length > 0
        ? Math.max(fetchStartMs, Math.min(...coveredMins))
        : fetchStartMs

      const bufferedRanges = activeTracks.flatMap(buildTrackBufferedRanges)
      if (discardedVideoFormatId) {
        bufferedRanges.push({
          formatId: discardedVideoFormatId,
          durationMs: MAX_INT32_VALUE,
          startTimeMs: '0',
          startSegmentIndex: Number(MAX_INT32_VALUE),
          endSegmentIndex: Number(MAX_INT32_VALUE),
          timeRange: {
            durationTicks: MAX_INT32_VALUE,
            startTicks: '0',
            timescale: 1000,
          },
        })
      }

      const selectedFormatIds: ProtoFormatId[] = activeTracks
        .filter((track) => track.initMetadata !== undefined)
        .map((track) => track.initMetadata!.formatId ?? track.formatId)
      if (discardedVideoFormatId) selectedFormatIds.push(discardedVideoFormatId)

      const ctxList: ReturnType<typeof SabrContextUpdate.decode>[] = []
      const unsentList: number[] = []
      for (const ctx of sabrContexts.values()) {
        if (activeSabrContexts.has(ctx.type ?? 0)) ctxList.push(ctx)
        else if (ctx.type !== undefined) unsentList.push(ctx.type)
      }

      const poToken = options.getPoToken?.() ?? currentPoToken
      const abrRequest = {
        clientAbrState: {
          playerTimeMs: String(playerTimeMs),
          audioTrackId: audioFormat.audioTrackId,
          playbackRate: 1,
          stickyResolution: videoFormat?.height ?? 360,
          drcEnabled: audioFormat.isDrc ?? false,
          clientViewportIsFlexible: false,
          visibility: 1,
          enabledTrackTypesBitfield: mode === 'audio'
            ? EnabledTrackTypes.AUDIO_ONLY
            : EnabledTrackTypes.VIDEO_AND_AUDIO,
        },
        preferredAudioFormatIds: [audioTrack.formatId],
        preferredVideoFormatIds: [videoTrack?.formatId ?? toFormatId(fallbackVideoFormat)],
        preferredSubtitleFormatIds: [],
        selectedFormatIds,
        videoPlaybackUstreamerConfig: base64ToU8(options.ustreamerConfig),
        streamerContext: {
          sabrContexts: ctxList,
          unsentSabrContexts: unsentList,
          poToken: poToken ? base64ToU8(poToken) : undefined,
          playbackCookie: nextRequestPolicy?.playbackCookie
            ? PlaybackCookie.encode(nextRequestPolicy.playbackCookie).finish()
            : undefined,
          clientInfo: options.clientInfo as never,
        },
        bufferedRanges,
        field1000: [],
      }
      applyClientAbrDefaults(abrRequest as unknown as ReturnType<typeof VideoPlaybackAbrRequest.decode>, audioFormat)
      const requestBody = VideoPlaybackAbrRequest.encode(abrRequest).finish()

      const reqUrl = new URL(streamingUrl)
      reqUrl.searchParams.set('rn', String(requestNumber++))
      const response = await fetch(reqUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-protobuf',
          'accept-encoding': 'identity',
          accept: 'application/vnd.yt-ump',
        },
        body: requestBody,
      })
      if (!response.ok) throw new Error(`Server returned ${response.status} ${response.statusText}`)
      if (!response.body) throw new Error('youtube: SABR response had no body')

      const framer = createUmpFramer()
      const collector = createUmpSegmentCollector()
      const reader = response.body.getReader()
      let receivedMedia = false
      let updatedProtocol = false
      let shouldRetryStatus3 = false

      try {
        for (;;) {
          if (signal.aborted) break
          const { done, value } = await reader.read()
          if (done) break
          if (!value?.byteLength) continue
          for (const frame of framer.push(value)) {
            if (frame.type === UMPPartId.FORMAT_INITIALIZATION_METADATA) {
              const meta = FormatInitializationMetadata.decode(frame.payload)
              const key = FormatKeyUtils.fromFormatInitializationMetadata(meta)
              const match = activeTracks.find((t) => t.key === key || t.format.itag === meta.formatId?.itag)
              if (match && key !== discardedVideoKey) {
                match.initMetadata = meta
                const endSeg = Number(meta.endSegmentNumber || 0)
                if (endSeg > 0) match.endSegmentNumber = endSeg
                updatedProtocol = true
              }
            } else if (frame.type === UMPPartId.NEXT_REQUEST_POLICY) {
              nextRequestPolicy = NextRequestPolicy.decode(frame.payload)
              updatedProtocol = true
            } else if (frame.type === UMPPartId.SABR_REDIRECT) {
              const redir = SabrRedirect.decode(frame.payload)
              if (redir.url) {
                streamingUrl = redir.url
                updatedProtocol = true
              }
            } else if (frame.type === UMPPartId.SABR_CONTEXT_UPDATE) {
              const ctx = SabrContextUpdate.decode(frame.payload)
              if (ctx.type !== undefined && ctx.value?.length) {
                if (!(ctx.writePolicy === SabrContextWritePolicy.KEEP_EXISTING && sabrContexts.has(ctx.type))) {
                  sabrContexts.set(ctx.type, ctx)
                  if (ctx.sendByDefault) activeSabrContexts.add(ctx.type)
                }
                updatedProtocol = true
              }
            } else if (frame.type === UMPPartId.SABR_CONTEXT_SENDING_POLICY) {
              const pol = SabrContextSendingPolicy.decode(frame.payload)
              for (const idType of pol.startPolicy) activeSabrContexts.add(idType)
              for (const idType of pol.stopPolicy) activeSabrContexts.delete(idType)
              for (const idType of pol.discardPolicy) sabrContexts.delete(idType)
              updatedProtocol = true
            } else if (frame.type === UMPPartId.STREAM_PROTECTION_STATUS) {
              const prot = StreamProtectionStatus.decode(frame.payload)
              if (prot.status === 3) {
                const refreshed = await refreshPoToken(false).catch(() => undefined)
                if (!retriedStatus3 && refreshed) {
                  currentPoToken = refreshed
                  retriedStatus3 = true
                  shouldRetryStatus3 = true
                } else {
                  throw new Error('Cannot proceed with stream: attestation required')
                }
              } else if (prot.status === 2) {
                void refreshPoToken(true).then((refreshed) => {
                  if (refreshed) currentPoToken = refreshed
                }).catch(() => {})
              }
            } else if (frame.type === UMPPartId.SABR_ERROR) {
              const err = SabrError.decode(frame.payload)
              throw new Error(`SABR Error: ${err.type} - ${err.code}`)
            } else if (frame.type === UMPPartId.RELOAD_PLAYER_RESPONSE) {
              ReloadPlaybackContext.decode(frame.payload)
              throw new Error('Player response reload requested by server')
            } else {
              const collected = collector.push(frame)
              if (!collected) continue
              const header = collected.header
              const target = activeTracks.find((t) =>
                t.key === collected.formatKey || t.format.itag === header.itag,
              )
              if (!target || collected.formatKey === discardedVideoKey) continue
              if (header.isInitSeg) {
                if (!target.initSegmentEmitted) {
                  checkMemoryLimit(collected.data.byteLength)
                  target.initSegmentEmitted = true
                  onChunk(target.kind, collected.data)
                  receivedMedia = true
                }
              } else {
                const seq = header.sequenceNumber ?? 1
                const timescale = header.timeRange?.timescale || 1000
                const parsedStartMs = header.startMs !== undefined && header.startMs !== '' ? Number(header.startMs) : Number.NaN
                const startMsVal = Number.isFinite(parsedStartMs)
                  ? parsedStartMs
                  : (header.timeRange
                      ? Math.round((Number(header.timeRange.startTicks ?? 0) * 1000) / timescale)
                      : 0)
                const parsedDurMs = header.durationMs !== undefined && header.durationMs !== '' ? Number(header.durationMs) : Number.NaN
                const durationMsVal = Number.isFinite(parsedDurMs)
                  ? parsedDurMs
                  : (header.timeRange
                      ? Math.ceil((Number(header.timeRange.durationTicks ?? 0) * 1000) / timescale)
                      : 0)
                if (!target.segments.has(seq)) {
                  checkMemoryLimit(collected.data.byteLength)
                  target.segments.set(seq, {
                    seq,
                    startMs: startMsVal,
                    durationMs: durationMsVal,
                    startTicks: String(header.timeRange?.startTicks ?? startMsVal),
                    durationTicks: String(header.timeRange?.durationTicks ?? durationMsVal),
                    timescale,
                  })
                  target.pendingPayloads.set(seq, collected.data)
                  target.minSeq = target.minSeq === undefined ? seq : Math.min(target.minSeq, seq)
                  target.coveredStartMs = target.coveredStartMs === undefined
                    ? startMsVal
                    : Math.min(target.coveredStartMs, startMsVal)
                  target.coveredEndMs = Math.max(target.coveredEndMs, startMsVal + durationMsVal)
                  receivedMedia = true
                }
              }
            }
          }
        }
        // Flush once per response so out-of-order segments within one UMP reply sort before emission.
        for (const track of activeTracks) flushContiguous(track)
      } finally {
        reader.releaseLock()
        collector.clear()
      }

      if (shouldRetryStatus3) {
        continue
      }

      if (receivedMedia) {
        emptyRounds = 0
      } else {
        emptyRounds += 1
        if (emptyRounds > MAX_EMPTY_ROUNDS) {
          if (!trim && activeTracks.every((t) =>
            t.initSegmentEmitted
            && t.segments.size > 0
            && (fetchTargetEndMs <= 0 || t.coveredEndMs >= fetchTargetEndMs * 0.99),
          )) {
            break
          }
          throw new Error(
            trim
              ? 'youtube: ranged SABR download received no new segments'
              : 'youtube: SABR download received no new segments',
          )
        }
        if (!updatedProtocol) {
          await wait(Math.min(4_000, 400 * emptyRounds), signal)
        }
      }
    }

    if (!signal.aborted) {
      for (const track of activeTracks) {
        if (!track.initSegmentEmitted || track.segments.size === 0) {
          throw new Error(`youtube: missing segments for ${trim ? 'cropped ' : ''}${track.kind} download`)
        }
        const sorted = [...track.segments.values()].sort((a, b) => a.seq - b.seq)
        const first = sorted[0]!
        if (trim && first.seq > 1 && (track.coveredStartMs === undefined || track.coveredStartMs > trim.startMs + 250)) {
          throw new Error(`youtube: cropped ${track.kind} stream missed clip start boundary`)
        }
        for (let i = 1; i < sorted.length; i += 1) {
          if (sorted[i]!.seq !== sorted[i - 1]!.seq + 1) {
            throw new Error(`youtube: ${trim ? 'cropped ' : ''}${track.kind} stream has missing segment gap`)
          }
        }
        // Flush if full stream began at a non-1 sequence number without a gap.
        if (track.nextFlushSeq === undefined) {
          for (const seg of sorted) {
            const payload = track.pendingPayloads.get(seg.seq)
            if (payload) {
              track.pendingPayloads.delete(seg.seq)
              onChunk(track.kind, payload)
            }
          }
        }
      }
    }
  } finally {
    for (const track of activeTracks) {
      track.pendingPayloads.clear()
      track.segments.clear()
    }
  }
}
