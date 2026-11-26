import type { SabrFormat } from 'googlevideo/shared-types'
import type {
  DownloadFormatOption,
  DownloadFormatsResult,
  DownloadPollResult,
  PlaybackFormat,
  StartDownloadOptions,
  StartDownloadResult,
} from './protocol'

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
import { SabrStream } from 'googlevideo/sabr-stream'
import { base64ToU8, EnabledTrackTypes, FormatKeyUtils, MAX_INT32_VALUE } from 'googlevideo/utils'

import { egressFetch } from './egress'
import { codecLabel } from './formats'
import { getSabrSource } from './innertube'
import { applyClientAbrDefaults, createUmpFramer, createUmpSegmentCollector } from './sabr'

type DownloadSession = {
  id: string
  controller: AbortController
  stream?: SabrStream
  videoQueue: Uint8Array[]
  audioQueue: Uint8Array[]
  loadedBytes: number
  totalBytes?: number
  done: boolean
  error?: string
  waiters: Set<() => void>
}

const sessions = new Map<string, DownloadSession>()
let nextSessionSeq = 0

const POLL_WAIT_MS = 2_000

const wakeWaiters = (session: DownloadSession) => {
  for (const resolve of session.waiters) resolve()
  session.waiters.clear()
}

const waitForPollEvent = (session: DownloadSession, timeoutMs: number) => new Promise<void>((resolve) => {
  let settled = false
  const finish = () => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    session.waiters.delete(finish)
    resolve()
  }
  const timer = setTimeout(finish, timeoutMs)
  session.waiters.add(finish)
})

const codecPreferenceRank = (codec: string) => {
  if (codec === 'H.264') return 0
  if (codec === 'AV1') return 1
  if (codec === 'VP9') return 2
  return 3
}

const estimateFormatBytes = (
  bitrate: number,
  durationMs: number,
  sabrFormat: SabrFormat | undefined,
): number | undefined => {
  if (sabrFormat?.contentLength && sabrFormat.contentLength > 0) return sabrFormat.contentLength
  if (bitrate > 0 && durationMs > 0) return Math.round((bitrate * durationMs) / 8_000)
  return undefined
}

/** Selects downloadable MP4 video options and M4A/WebM audio options from resolved SABR formats. */
export const selectDownloadFormats = (
  playbackFormats: readonly PlaybackFormat[],
  sabrFormats: readonly SabrFormat[],
  durationMs: number,
): { videoFormats: DownloadFormatOption[], audioFormats: DownloadFormatOption[], effectiveDurationMs: number } => {
  const byKey = new Map(sabrFormats.map((format) => [FormatKeyUtils.fromFormat(format), format]))
  const effectiveDurationMs = Math.max(
    durationMs,
    ...sabrFormats.map((format) => (Number.isFinite(format.approxDurationMs) ? format.approxDurationMs : 0)),
  )

  const rawVideo = playbackFormats
    .filter((format) => Boolean(format.width && format.height) && format.mimeType.startsWith('video/mp4'))
    .map((format): DownloadFormatOption => {
      const codec = codecLabel(format.mimeType)
      const label = format.qualityLabel ?? `${format.height}p`
      return {
        key: format.key,
        itag: format.itag,
        kind: 'video',
        container: 'mp4',
        mimeType: format.mimeType,
        codec,
        qualityLabel: label,
        height: format.height,
        bitrate: format.bitrate,
        estimatedBytes: estimateFormatBytes(format.bitrate, effectiveDurationMs, byKey.get(format.key)),
      }
    })
    .sort((a, b) =>
      (b.height ?? 0) - (a.height ?? 0)
      || codecPreferenceRank(a.codec) - codecPreferenceRank(b.codec)
      || b.bitrate - a.bitrate,
    )

  const seenVideo = new Set<string>()
  const videoFormats: DownloadFormatOption[] = []
  for (const option of rawVideo) {
    const dedupeKey = `${option.qualityLabel}:${option.codec}`
    if (seenVideo.has(dedupeKey)) continue
    seenVideo.add(dedupeKey)
    videoFormats.push(option)
  }

  const rawAudio = playbackFormats
    .filter((format) =>
      !format.width
      && !format.isDrc
      && (format.mimeType.startsWith('audio/mp4') || format.mimeType.startsWith('audio/webm')),
    )
    .map((format): DownloadFormatOption => {
      const container = format.mimeType.startsWith('audio/mp4') ? 'm4a' : 'webm'
      const kbps = Math.max(1, Math.round(format.bitrate / 1_000))
      return {
        key: format.key,
        itag: format.itag,
        kind: 'audio',
        container,
        mimeType: format.mimeType,
        codec: codecLabel(format.mimeType),
        qualityLabel: `${kbps} kbps`,
        bitrate: format.bitrate,
        estimatedBytes: estimateFormatBytes(format.bitrate, effectiveDurationMs, byKey.get(format.key)),
        audioTrackId: format.audioTrackId,
        audioTrackName: format.audioTrackName,
        isOriginal: format.isOriginal,
        isAutoDubbed: format.isAutoDubbed,
      }
    })
    .sort((a, b) =>
      Number(Boolean(b.isOriginal)) - Number(Boolean(a.isOriginal))
      || Number(Boolean(a.isAutoDubbed)) - Number(Boolean(b.isAutoDubbed))
      || b.bitrate - a.bitrate,
    )

  const seenAudio = new Set<string>()
  const audioFormats: DownloadFormatOption[] = []
  for (const option of rawAudio) {
    const dedupeKey = `${option.container}:${Math.round(option.bitrate / 1000)}:${option.audioTrackId ?? ''}`
    if (seenAudio.has(dedupeKey)) continue
    seenAudio.add(dedupeKey)
    audioFormats.push(option)
  }

  return { videoFormats, audioFormats, effectiveDurationMs }
}

export const getDownloadFormats = async (videoId: string): Promise<DownloadFormatsResult> => {
  const source = await getSabrSource(videoId)
  if (source.isLive) {
    return { videoId, durationMs: 0, isLive: true, videoFormats: [], audioFormats: [] }
  }
  const { videoFormats, audioFormats, effectiveDurationMs } = selectDownloadFormats(
    source.playbackFormats,
    source.formats,
    source.durationMs,
  )
  return {
    videoId,
    durationMs: effectiveDurationMs,
    isLive: false,
    videoFormats,
    audioFormats,
  }
}

const headerRecord = (input: HeadersInit | undefined): Record<string, string> => {
  const out: Record<string, string> = {}
  if (!input) return out
  if (input instanceof Headers) {
    input.forEach((value, key) => { out[key] = value })
    return out
  }
  if (Array.isArray(input)) {
    for (const [key, value] of input) out[key] = value
    return out
  }
  return { ...input }
}

const requestUrlString = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

const requestBytes = async (body: BodyInit | null | undefined): Promise<Uint8Array | undefined> => {
  if (!body) return undefined
  if (body instanceof Uint8Array) return body
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
  if (body instanceof ArrayBuffer) return new Uint8Array(body)
  return new Uint8Array(await new Response(body).arrayBuffer())
}

const patchAbrBody = (
  raw: Uint8Array,
  audioFormat: SabrFormat,
  poTokenOverride?: Uint8Array,
): Uint8Array => {
  const decoded = VideoPlaybackAbrRequest.decode(raw)
  applyClientAbrDefaults(decoded, audioFormat)
  if (poTokenOverride && decoded.streamerContext) {
    decoded.streamerContext.poToken = poTokenOverride
  }
  return VideoPlaybackAbrRequest.encode(decoded).finish()
}

const linkSignals = (first: AbortSignal | null | undefined, second: AbortSignal) => {
  if (!first) return { signal: second, cleanup: () => {} }
  const controller = new AbortController()
  const onFirst = () => controller.abort(first.reason)
  const onSecond = () => controller.abort(second.reason)
  if (first.aborted) controller.abort(first.reason)
  else if (second.aborted) controller.abort(second.reason)
  else {
    first.addEventListener('abort', onFirst, { once: true })
    second.addEventListener('abort', onSecond, { once: true })
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      first.removeEventListener('abort', onFirst)
      second.removeEventListener('abort', onSecond)
    },
  }
}

const createDownloadFetch = (
  audioFormat: SabrFormat,
  sessionController: AbortController,
  recoverPoToken: () => Promise<string | undefined>,
) => {
  const perform = async (
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    attempt: number,
    poTokenOverride?: Uint8Array,
  ): Promise<Response> => {
    const url = requestUrlString(input)
    const headers = headerRecord(init?.headers)
    const rawBody = await requestBytes(init?.body)
    const bodyBytes = rawBody && url.includes('googlevideo.com')
      ? patchAbrBody(rawBody, audioFormat, poTokenOverride)
      : rawBody
    const { signal, cleanup } = linkSignals(init?.signal, sessionController.signal)
    try {
      const response = await egressFetch(url, {
        method: init?.method ?? 'POST',
        headers: {
          ...headers,
          origin: 'https://www.youtube.com',
          referer: 'https://www.youtube.com/',
          'content-type': headers['content-type'] ?? 'application/x-protobuf',
        },
        body: bodyBytes ? Uint8Array.from(bodyBytes).buffer : undefined,
        redirect: 'manual',
      }, signal)
      if (response.status === 403 && attempt === 0) {
        await response.body?.cancel().catch(() => {})
        const refreshed = await recoverPoToken()
        return perform(input, init, attempt + 1, refreshed ? base64ToU8(refreshed) : undefined)
      }
      return response
    } finally {
      cleanup()
    }
  }
  return (input: RequestInfo | URL, init?: RequestInit) => perform(input, init, 0)
}

const toStandaloneBuffer = (chunk: Uint8Array): ArrayBuffer => {
  if (chunk.byteOffset === 0 && chunk.byteLength === chunk.buffer.byteLength && chunk.buffer instanceof ArrayBuffer) {
    return chunk.buffer
  }
  return Uint8Array.from(chunk).buffer
}

const RANGE_PREROLL_MS = 5_000
const RANGE_TAIL_PAD_MS = 500
const MAX_RANGE_RETRIES = 5

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

type RangeSegment = {
  seq: number
  startMs: number
  durationMs: number
  startTicks: string
  durationTicks: string
  timescale: number
  data: Uint8Array
}

type RangeTrackState = {
  kind: 'video' | 'audio'
  format: SabrFormat
  formatId: ProtoFormatId
  key: string
  initSegment?: Uint8Array
  initMetadata?: ReturnType<typeof FormatInitializationMetadata.decode>
  endSegmentNumber?: number
  segments: Map<number, RangeSegment>
  coveredStartMs?: number
  coveredEndMs: number
}

const buildTrackBufferedRanges = (track: RangeTrackState) => {
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

const isRangeTrackComplete = (track: RangeTrackState, targetEndMs: number): boolean => {
  if (!track.initSegment || track.segments.size === 0) return false
  if (track.endSegmentNumber && track.segments.has(track.endSegmentNumber)) return true
  return track.coveredEndMs >= targetEndMs
}

const sleepAbortable = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (ms <= 0) return resolve()
  if (signal.aborted) return reject(signal.reason)
  const onAbort = () => {
    clearTimeout(timer)
    reject(signal.reason)
  }
  const timer = setTimeout(() => {
    signal.removeEventListener('abort', onAbort)
    resolve()
  }, ms)
  signal.addEventListener('abort', onAbort, { once: true })
})

/** Starts a SABR VOD download session in the engine frame for `options`. */
export const startDownloadSession = async (options: StartDownloadOptions): Promise<StartDownloadResult> => {
  const source = await getSabrSource(options.videoId)
  if (source.isLive) throw new Error('youtube: live streams cannot be downloaded')

  const byKey = new Map(source.formats.map((format) => [FormatKeyUtils.fromFormat(format), format]))
  const requestedAudio = byKey.get(options.audioKey)
  if (!requestedAudio) throw new Error('youtube: selected audio format is unavailable')

  const audioRank = (format: SabrFormat) => {
    if (format.width || !format.mimeType?.startsWith('audio/mp4')) return 0
    return format.mimeType.toLowerCase().includes('mp4a') ? 2 : 1
  }
  let fallbackAudio: SabrFormat | undefined
  if (options.mode === 'video' && !requestedAudio.mimeType?.startsWith('audio/mp4')) {
    for (const format of source.formats) {
      if (requestedAudio.audioTrackId && format.audioTrackId !== requestedAudio.audioTrackId) continue
      if (audioRank(format) > (fallbackAudio ? audioRank(fallbackAudio) : 0)) fallbackAudio = format
    }
  }
  const audioFormat = fallbackAudio ?? requestedAudio

  const videoFormat = options.mode === 'video'
    ? (options.videoKey ? byKey.get(options.videoKey) : undefined)
    : undefined
  if (options.mode === 'video' && !videoFormat) {
    throw new Error('youtube: selected video format is unavailable')
  }

  const effectiveDurationMs = Math.max(
    source.durationMs,
    videoFormat?.approxDurationMs ?? 0,
    audioFormat.approxDurationMs ?? 0,
  )
  const fullEstimatedBytes = options.mode === 'video'
    ? (() => {
        const videoEst = estimateFormatBytes(videoFormat!.bitrate, effectiveDurationMs, videoFormat)
        const audioEst = estimateFormatBytes(audioFormat.bitrate, effectiveDurationMs, audioFormat)
        return videoEst !== undefined && audioEst !== undefined ? videoEst + audioEst : videoEst
      })()
    : estimateFormatBytes(audioFormat.bitrate, effectiveDurationMs, audioFormat)

  const trimmedRange = options.startMs !== undefined && options.endMs !== undefined && effectiveDurationMs > 0
    ? (() => {
        const startMs = Math.max(0, Math.min(effectiveDurationMs - 1_000, Math.round(options.startMs)))
        const endMs = Math.max(startMs + 1_000, Math.min(effectiveDurationMs, Math.round(options.endMs)))
        return startMs > 500 || endMs < effectiveDurationMs - 500 ? { startMs, endMs } : undefined
      })()
    : undefined

  const estimatedBytes = trimmedRange && fullEstimatedBytes !== undefined && effectiveDurationMs > 0
    ? Math.max(1024, Math.round((fullEstimatedBytes * (trimmedRange.endMs - trimmedRange.startMs)) / effectiveDurationMs))
    : fullEstimatedBytes

  const controller = new AbortController()
  let currentPoToken = await source.mint()
  const holder: { stream?: SabrStream } = {}
  let replacedOnStatus2 = false
  let pendingRefresh: Promise<string> | undefined
  const refreshPoToken = (status2Only: boolean): Promise<string | undefined> => {
    if (status2Only && replacedOnStatus2) return Promise.resolve(undefined)
    if (status2Only) replacedOnStatus2 = true
    if (!pendingRefresh) {
      pendingRefresh = source.recoverMint()
        .then(() => source.mint())
        .then((token) => {
          currentPoToken = token
          holder.stream?.setPoToken(token)
          return token
        })
        .finally(() => { pendingRefresh = undefined })
    }
    return pendingRefresh
  }
  const fetch = createDownloadFetch(audioFormat, controller, () => refreshPoToken(false))

  const id = `dl:${++nextSessionSeq}`
  const session: DownloadSession = {
    id,
    controller,
    videoQueue: [],
    audioQueue: [],
    loadedBytes: 0,
    totalBytes: estimatedBytes,
    done: false,
    waiters: new Set(),
  }
  sessions.set(id, session)

  if (trimmedRange) {
    const fetchStartMs = Math.max(0, trimmedRange.startMs - RANGE_PREROLL_MS)
    const fetchTargetEndMs = Math.min(effectiveDurationMs, trimmedRange.endMs + RANGE_TAIL_PAD_MS)
    const fallbackVideoFormat = videoFormat ?? source.formats.find((format) => Boolean(format.width)) ?? audioFormat

    const audioTrack: RangeTrackState = {
      kind: 'audio',
      format: audioFormat,
      formatId: toFormatId(audioFormat),
      key: FormatKeyUtils.fromFormat(audioFormat) ?? '',
      segments: new Map(),
      coveredEndMs: 0,
    }
    const videoTrack: RangeTrackState | undefined = videoFormat
      ? {
          kind: 'video',
          format: videoFormat,
          formatId: toFormatId(videoFormat),
          key: FormatKeyUtils.fromFormat(videoFormat) ?? '',
          segments: new Map(),
          coveredEndMs: 0,
        }
      : undefined
    const activeTracks = videoTrack ? [videoTrack, audioTrack] : [audioTrack]
    const discardedVideoFormatId = !videoTrack && fallbackVideoFormat !== audioFormat
      ? toFormatId(fallbackVideoFormat)
      : undefined
    const discardedVideoKey = discardedVideoFormatId ? FormatKeyUtils.fromFormat(fallbackVideoFormat) : undefined

    void (async () => {
      let streamingUrl = source.streamingUrl
      let requestNumber = 0
      let nextRequestPolicy: ReturnType<typeof NextRequestPolicy.decode> | undefined
      const sabrContexts = new Map<number, ReturnType<typeof SabrContextUpdate.decode>>()
      const activeSabrContexts = new Set<number>()
      let emptyRounds = 0

      try {
        while (!controller.signal.aborted) {
          if (activeTracks.every((track) => isRangeTrackComplete(track, fetchTargetEndMs))) {
            break
          }

          if (nextRequestPolicy?.backoffTimeMs && nextRequestPolicy.backoffTimeMs > 0) {
            await sleepAbortable(Math.min(5_000, nextRequestPolicy.backoffTimeMs), controller.signal)
          }

          const incomplete = activeTracks.filter((track) => !isRangeTrackComplete(track, fetchTargetEndMs))
          const coveredMins = incomplete
            .filter((track) => track.segments.size > 0)
            .map((track) => track.coveredEndMs)
          const playerTimeMs = coveredMins.length > 0
            ? Math.max(fetchStartMs, Math.min(...coveredMins))
            : fetchStartMs

          const bufferedRanges = activeTracks.flatMap((track) => buildTrackBufferedRanges(track))
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

          const requestBody = VideoPlaybackAbrRequest.encode({
            clientAbrState: {
              playerTimeMs: String(playerTimeMs),
              audioTrackId: audioFormat.audioTrackId,
              playbackRate: 1,
              stickyResolution: videoFormat?.height ?? 360,
              drcEnabled: audioFormat.isDrc ?? false,
              clientViewportIsFlexible: false,
              visibility: 1,
              enabledTrackTypesBitfield: options.mode === 'audio'
                ? EnabledTrackTypes.AUDIO_ONLY
                : EnabledTrackTypes.VIDEO_AND_AUDIO,
            },
            preferredAudioFormatIds: [audioTrack.formatId],
            preferredVideoFormatIds: [videoTrack?.formatId ?? toFormatId(fallbackVideoFormat)],
            preferredSubtitleFormatIds: [],
            selectedFormatIds,
            videoPlaybackUstreamerConfig: base64ToU8(source.ustreamerConfig),
            streamerContext: {
              sabrContexts: ctxList,
              unsentSabrContexts: unsentList,
              poToken: currentPoToken ? base64ToU8(currentPoToken) : undefined,
              playbackCookie: nextRequestPolicy?.playbackCookie
                ? PlaybackCookie.encode(nextRequestPolicy.playbackCookie).finish()
                : undefined,
              clientInfo: source.clientInfo as never,
            },
            bufferedRanges,
            field1000: [],
          }).finish()

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

          try {
            for (;;) {
              if (controller.signal.aborted) break
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
                    await refreshPoToken(false).catch(() => {})
                    throw new Error('Cannot proceed with stream: attestation required')
                  }
                  if (prot.status === 2) void refreshPoToken(true).catch(() => {})
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
                  if (!target) continue
                  if (header.isInitSeg) {
                    if (!target.initSegment) {
                      target.initSegment = collected.data
                      session.loadedBytes += collected.data.byteLength
                      wakeWaiters(session)
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
                      target.segments.set(seq, {
                        seq,
                        startMs: startMsVal,
                        durationMs: durationMsVal,
                        startTicks: String(header.timeRange?.startTicks ?? startMsVal),
                        durationTicks: String(header.timeRange?.durationTicks ?? durationMsVal),
                        timescale,
                        data: collected.data,
                      })
                      target.coveredStartMs = target.coveredStartMs === undefined
                        ? startMsVal
                        : Math.min(target.coveredStartMs, startMsVal)
                      target.coveredEndMs = Math.max(target.coveredEndMs, startMsVal + durationMsVal)
                      session.loadedBytes += collected.data.byteLength
                      wakeWaiters(session)
                      receivedMedia = true
                    }
                  }
                }
              }
            }
          } finally {
            reader.releaseLock()
            collector.clear()
          }

          if (receivedMedia) {
            emptyRounds = 0
          } else {
            emptyRounds += 1
            if (emptyRounds > MAX_RANGE_RETRIES) {
              throw new Error('youtube: ranged SABR download received no new segments')
            }
            if (!updatedProtocol) {
              await sleepAbortable(Math.min(4_000, 400 * emptyRounds), controller.signal)
            }
          }
        }

        if (!controller.signal.aborted) {
          for (const track of activeTracks) {
            if (!track.initSegment || track.segments.size === 0) {
              throw new Error(`youtube: missing segments for cropped ${track.kind} download`)
            }
            const sorted = [...track.segments.values()].sort((a, b) => a.seq - b.seq)
            const first = sorted[0]!
            if (first.seq > 1 && (track.coveredStartMs === undefined || track.coveredStartMs > trimmedRange.startMs + 250)) {
              throw new Error(`youtube: cropped ${track.kind} stream missed clip start boundary`)
            }
            for (let i = 1; i < sorted.length; i += 1) {
              if (sorted[i]!.seq !== sorted[i - 1]!.seq + 1) {
                throw new Error(`youtube: cropped ${track.kind} stream has missing segment gap`)
              }
            }
            const targetQueue = track.kind === 'video' ? session.videoQueue : session.audioQueue
            targetQueue.push(track.initSegment)
            for (const seg of sorted) targetQueue.push(seg.data)
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          session.error = error instanceof Error ? error.message : String(error)
        }
      } finally {
        session.done = true
        wakeWaiters(session)
      }
    })()

    const mimeType = options.mode === 'video' ? 'video/mp4' : (audioFormat.mimeType ?? 'audio/mp4')
    const container = options.mode === 'video'
      ? 'mp4'
      : mimeType.startsWith('audio/webm')
      ? 'webm'
      : 'm4a'

    return {
      downloadId: id,
      estimatedBytes,
      container,
      mimeType,
    }
  }

  const stream = new SabrStream({
    fetch,
    serverAbrStreamingUrl: source.streamingUrl,
    videoPlaybackUstreamerConfig: source.ustreamerConfig,
    clientInfo: source.clientInfo as never,
    formats: source.formats,
    durationMs: effectiveDurationMs,
    poToken: currentPoToken,
  })
  holder.stream = stream
  session.stream = stream

  stream.on('streamProtectionStatusUpdate', (protection) => {
    if (protection.status === 3) void refreshPoToken(false).catch(() => {})
    else if (protection.status === 2) void refreshPoToken(true).catch(() => {})
  })

  const started = await stream.start({
    videoFormat,
    audioFormat,
    enabledTrackTypes: options.mode === 'audio' ? EnabledTrackTypes.AUDIO_ONLY : EnabledTrackTypes.VIDEO_AND_AUDIO,
    preferMP4: options.mode === 'video',
    maxRetries: 5,
  })

  const drainStream = async (
    readable: ReadableStream<Uint8Array>,
    targetQueue: Uint8Array[],
  ) => {
    const reader = readable.getReader()
    try {
      for (;;) {
        if (controller.signal.aborted) break
        const { done, value } = await reader.read()
        if (done) break
        if (value?.byteLength) {
          targetQueue.push(value)
          session.loadedBytes += value.byteLength
          wakeWaiters(session)
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  void Promise.all([
    drainStream(started.audioStream, session.audioQueue),
    drainStream(started.videoStream, session.videoQueue),
  ]).then(
    () => {
      session.done = true
      wakeWaiters(session)
    },
    (error) => {
      if (!controller.signal.aborted) {
        session.error = error instanceof Error ? error.message : String(error)
      }
      session.done = true
      wakeWaiters(session)
    },
  )

  const mimeType = options.mode === 'video' ? 'video/mp4' : (audioFormat.mimeType ?? 'audio/mp4')
  const container = options.mode === 'video'
    ? 'mp4'
    : mimeType.startsWith('audio/webm')
    ? 'webm'
    : 'm4a'

  return {
    downloadId: id,
    estimatedBytes,
    container,
    mimeType,
  }
}

export const pollDownloadSession = async (downloadId: string): Promise<DownloadPollResult> => {
  const session = sessions.get(downloadId)
  if (!session) throw new Error(`youtube: unknown download session ${downloadId}`)

  if (session.videoQueue.length === 0 && session.audioQueue.length === 0 && !session.done) {
    await waitForPollEvent(session, POLL_WAIT_MS)
  }

  const videoChunks = session.videoQueue.splice(0, session.videoQueue.length).map(toStandaloneBuffer)
  const audioChunks = session.audioQueue.splice(0, session.audioQueue.length).map(toStandaloneBuffer)

  const done = session.done && session.videoQueue.length === 0 && session.audioQueue.length === 0
  if (done) sessions.delete(downloadId)

  return {
    videoChunks,
    audioChunks,
    loadedBytes: session.loadedBytes,
    totalBytes: session.totalBytes,
    done,
    error: session.error,
  }
}

export const cancelDownloadSession = (downloadId: string) => {
  const session = sessions.get(downloadId)
  if (!session) return
  sessions.delete(downloadId)
  session.controller.abort()
  session.done = true
  try {
    session.stream?.abort()
  } catch {}
  wakeWaiters(session)
}

export const cancelAllDownloadSessions = () => {
  for (const id of Array.from(sessions.keys())) cancelDownloadSession(id)
}
