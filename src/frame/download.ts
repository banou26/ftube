import type { SabrFormat } from 'googlevideo/shared-types'
import type { SabrSource } from './innertube'
import type {
  DownloadFormatOption,
  DownloadFormatsResult,
  DownloadPollResult,
  PlaybackFormat,
  StartDownloadOptions,
  StartDownloadResult,
} from './protocol'

import { VideoPlaybackAbrRequest } from 'googlevideo/protos'
import { SabrStream } from 'googlevideo/sabr-stream'
import { base64ToU8, EnabledTrackTypes, FormatKeyUtils } from 'googlevideo/utils'

import { egressFetch } from './egress'
import { codecLabel } from './formats'
import { getSabrSource } from './innertube'
import { applyClientAbrDefaults } from './sabr'

type DownloadSession = {
  id: string
  controller: AbortController
  stream: SabrStream
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

/** Starts a SABR VOD download session in the engine frame for `options`. */
export const startDownloadSession = async (options: StartDownloadOptions): Promise<StartDownloadResult> => {
  const source = await getSabrSource(options.videoId)
  if (source.isLive) throw new Error('youtube: live streams cannot be downloaded')

  const byKey = new Map(source.formats.map((format) => [FormatKeyUtils.fromFormat(format), format]))
  const requestedAudio = byKey.get(options.audioKey)
  if (!requestedAudio) throw new Error('youtube: selected audio format is unavailable')

  const audioFormat = options.mode === 'video' && !requestedAudio.mimeType?.startsWith('audio/mp4')
    ? source.formats.find((format) =>
        !format.width
        && format.mimeType?.startsWith('audio/mp4')
        && (!requestedAudio.audioTrackId || format.audioTrackId === requestedAudio.audioTrackId),
      ) ?? requestedAudio
    : requestedAudio

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
  const estimatedBytes = options.mode === 'video'
    ? (() => {
        const videoEst = estimateFormatBytes(videoFormat!.bitrate, effectiveDurationMs, videoFormat)
        const audioEst = estimateFormatBytes(audioFormat.bitrate, effectiveDurationMs, audioFormat)
        return videoEst !== undefined && audioEst !== undefined ? videoEst + audioEst : videoEst
      })()
    : estimateFormatBytes(audioFormat.bitrate, effectiveDurationMs, audioFormat)

  const controller = new AbortController()
  const poToken = await source.mint()
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
          holder.stream?.setPoToken(token)
          return token
        })
        .finally(() => { pendingRefresh = undefined })
    }
    return pendingRefresh
  }
  const fetch = createDownloadFetch(audioFormat, controller, () => refreshPoToken(false))
  const stream = new SabrStream({
    fetch,
    serverAbrStreamingUrl: source.streamingUrl,
    videoPlaybackUstreamerConfig: source.ustreamerConfig,
    clientInfo: source.clientInfo as never,
    formats: source.formats,
    durationMs: effectiveDurationMs,
    poToken,
  })
  holder.stream = stream

  const id = `dl:${++nextSessionSeq}`
  const session: DownloadSession = {
    id,
    controller,
    stream,
    videoQueue: [],
    audioQueue: [],
    loadedBytes: 0,
    totalBytes: estimatedBytes,
    done: false,
    waiters: new Set(),
  }
  sessions.set(id, session)

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
    session.stream.abort()
  } catch {}
  wakeWaiters(session)
}

export const cancelAllDownloadSessions = () => {
  for (const id of Array.from(sessions.keys())) cancelDownloadSession(id)
}
