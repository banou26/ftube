import type { EndScreenElement, FrameApi, OpenPlaybackOptions, PlaybackSession } from '../frame/protocol'

import shaka from 'shaka-player'

import { captionLabel } from '../frame/captions'
import { audioManifestLabel, audioManifestRole, audioRepresentationId, audioTracksOf, pickAudioFormat, trackHasDrc } from '../frame/formats'
import { codecsOf } from '../frame/protocol'
import { markStartup } from '../perf'
import { createStallWatch, isStreamRefusal } from './restart'

type Bridge = {
  api: FrameApi
  generation: number
  initialLiveManifest?: string
  pendingInits: Set<Promise<unknown>>
  player: shaka.Player
  requestNumber: number
  session: PlaybackSession
  video: HTMLVideoElement
}

const SAFE_MARGIN_SECONDS = 1

const waitForPendingInits = async (bridge: Bridge, isStopped: () => boolean) => {
  while (!isStopped() && bridge.pendingInits.size > 0) {
    await Promise.allSettled([...bridge.pendingInits])
    // yield a macrotask so Shaka's createSegmentIndex() -> onUpdate_() settles before switchInternal_() clears buffers
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

const bridges = new Map<string, Bridge>()
let schemeInstalled = false
let diagnosticBridgeId: string | undefined

type SegmentTrace = {
  at: number
  kind: string
  track: string
  formatKey: string
  requestedMs: number
  deliveredMs?: number
  sequenceNumber?: number
  driftMs?: number
}
const SEGMENT_TRACE_LIMIT = 240
const segmentTrace: SegmentTrace[] = []
const traceSegment = (
  kind: string,
  track: string,
  requestedMs: number,
  segment: { formatKey: string, sequenceNumber?: number, startMs?: number },
) => {
  segmentTrace.push({
    at: Math.round(performance.now()),
    kind,
    track,
    formatKey: segment.formatKey,
    requestedMs,
    deliveredMs: segment.startMs,
    sequenceNumber: segment.sequenceNumber,
    driftMs: segment.startMs === undefined ? undefined : segment.startMs - requestedMs,
  })
  if (segmentTrace.length > SEGMENT_TRACE_LIMIT) segmentTrace.splice(0, segmentTrace.length - SEGMENT_TRACE_LIMIT)
  ;(globalThis as { __segmentTrace?: SegmentTrace[] }).__segmentTrace = segmentTrace
}

const rangeFromRequest = (request: shaka.extern.Request) => {
  const value = request.headers.Range ?? request.headers.range
  const match = value?.match(/^bytes=(\d+)-(\d+)$/)
  return match ? { start: Number(match[1]), end: Number(match[2]) } : undefined
}

const abortError = (uri: string) => new shaka.util.Error(
  shaka.util.Error.Severity.RECOVERABLE,
  shaka.util.Error.Category.NETWORK,
  shaka.util.Error.Code.OPERATION_ABORTED,
  uri,
)

const networkError = (uri: string, error: unknown) => error instanceof shaka.util.Error
  ? error
  : new shaka.util.Error(
      shaka.util.Error.Severity.RECOVERABLE,
      shaka.util.Error.Category.NETWORK,
      shaka.util.Error.Code.HTTP_ERROR,
      uri,
      error,
    )

const installScheme = () => {
  if (schemeInstalled) return
  schemeInstalled = true
  shaka.polyfill.installAll()
  shaka.net.NetworkingEngine.registerScheme('sabr', (
    uri,
    request,
    requestType,
    progressUpdated,
    headersReceived,
  ) => {
    let isAborted = false
    let isInit = false
    let bridge: Bridge | undefined
    let segmentRequestId: string | undefined
    let abort = () => {}
    const aborted = new Promise<never>((_, reject) => {
      abort = () => {
        isAborted = true
        reject(abortError(uri))
      }
    })
    const response = (async (): Promise<shaka.extern.Response> => {
      const url = new URL(uri)
      bridge = bridges.get(url.searchParams.get('session') ?? '')
      if (!bridge) throw new Error('shaka: playback session is closed')
      if (requestType === shaka.net.NetworkingEngine.RequestType.MANIFEST) {
        const manifest = bridge.initialLiveManifest ?? await bridge.api.liveManifest(bridge.session.id)
        bridge.initialLiveManifest = undefined
        if (isAborted) throw abortError(uri)
        ;(globalThis as { __liveManifest?: unknown }).__liveManifest = { at: Math.round(performance.now()), manifest }
        const headers = { 'content-type': 'application/dash+xml' }
        headersReceived(headers)
        return {
          uri,
          originalUri: uri,
          originalRequest: request,
          data: new TextEncoder().encode(manifest).buffer as ArrayBuffer,
          status: 200,
          headers,
          fromCache: false,
          timeMs: 0,
        }
      }
      if (requestType !== shaka.net.NetworkingEngine.RequestType.SEGMENT) {
        throw new Error(`shaka: unsupported SABR request type ${requestType}`)
      }
      const track = url.hostname
      if (track !== 'audio' && track !== 'video') throw new Error(`shaka: unknown track ${track}`)
      const formatKey = url.searchParams.get('key')
      if (!formatKey) throw new Error('shaka: SABR format key is missing')
      const generation = Number(url.searchParams.get('generation') ?? 0)
      if (generation < bridge.generation) throw abortError(uri)
      const kind = url.searchParams.get('kind') === 'media' ? 'media' : 'init'
      isInit = kind === 'init'
      segmentRequestId = `${url.searchParams.get('session')}:${++bridge.requestNumber}`
      const started = performance.now()
      const segment = await bridge.api.requestSegment({
        requestId: segmentRequestId,
        sessionId: bridge.session.id,
        generation,
        track,
        kind,
        formatKey,
        range: rangeFromRequest(request),
        startTimeMs: Number(url.searchParams.get('start') ?? 0),
        // `n` is the live template's $Number$, which the manifest generator pins to the SABR sequence
        sequenceNumber: url.searchParams.has('n') ? Number(url.searchParams.get('n')) : undefined,
        snapshot: {
          currentTimeMs: bridge.video.currentTime * 1_000,
          playbackRate: bridge.video.playbackRate,
          bandwidthEstimate: bridge.player.getStats().estimatedBandwidth || 10_000_000,
          viewportWidth: Math.max(1, bridge.video.clientWidth),
          viewportHeight: Math.max(1, bridge.video.clientHeight),
        },
      })
      if (isAborted) throw abortError(uri)
      traceSegment(kind, track, Number(url.searchParams.get('start') ?? 0), segment)
      if (segment.end) throw new Error(`youtube: ${track} ended before the DASH timeline`)
      const headers = {
        'content-length': String(segment.data.byteLength),
        'content-type': segment.mimeType.split(';')[0] ?? 'application/octet-stream',
      }
      // Cached init/harvested segments return in 0 ms; mark them fromCache and skip progressUpdated so Shaka's ABR
      // estimator is not poisoned with fake multi-gigabit speeds that cause a 1440p stall on segment 0.
      const fromCache = segment.elapsedMs === 0
      headersReceived(headers)
      if (kind === 'media' && !fromCache) {
        progressUpdated(segment.elapsedMs, segment.data.byteLength, 0)
      }
      return {
        uri,
        originalUri: uri,
        originalRequest: request,
        data: segment.data,
        status: 200,
        headers,
        fromCache,
        timeMs: segment.elapsedMs,
      }
    })().catch((error) => {
      throw networkError(uri, error)
    })
    const settled = Promise.race([response, aborted])
    if (isInit && bridge) {
      const pendingBridge = bridge
      const done = settled.then(() => {}, () => {})
      pendingBridge.pendingInits.add(done)
      void done.finally(() => pendingBridge.pendingInits.delete(done))
    }
    return new shaka.util.AbortableOperation(settled, async () => {
      abort()
      if (bridge && segmentRequestId) {
        await bridge.api.cancelSegment(bridge.session.id, segmentRequestId).catch(() => {})
      }
    })
  }, shaka.net.NetworkingEngine.PluginPriority.PREFERRED, false)
}

// Shaka's StreamUtils.meetsRestrictions swaps width and height whenever height > width (comparing minHeight/maxHeight
// against the SHORT side), so portrait formats (Shorts, vertical previews) must pass Math.min(width, height).
const restrictionHeight = (video: { width?: number, height?: number }) =>
  video.width && video.height ? Math.min(video.width, video.height) : video.height

/* Shaka opens a live stream on the formats the frame's session already streams. Its own pick differs (it rounds the
   element height UP and keeps the cheapest codec per resolution, the frame rounds down: 244 against 134 on a 1280x720
   window, measured 2026-11-06), and every listed segment the session holds only in another format is a fetch by address. */
const liveOpening = (session: PlaybackSession) => {
  const video = session.videoFormats.find((format) => format.key === session.selectedVideoKey)
  const audio = session.audioFormats.find((format) => format.key === session.selectedAudioKey)
  const height = video ? restrictionHeight(video) : undefined
  if (!video || !height || !audio) return {}
  return {
    preferredVideoCodecs: [codecsOf(video.mimeType).split('.')[0]!],
    preferredAudioCodecs: [codecsOf(audio.mimeType)],
    abr: { restrictToElementSize: false, restrictions: { minHeight: height, maxHeight: height } },
  }
}

// Multi-language and DRC manifests expose multiple AdaptationSets that can share `role="main"`, so pin Shaka's initial
// audio selection to the exact track and DRC variant the SABR session opened on.
const vodAudioOpening = (session: PlaybackSession) => {
  const audio = session.audioFormats.find((format) => format.key === session.selectedAudioKey)
  if (!audio) return {}
  const hasAnyDrc = session.audioFormats.some((format) => format.isDrc)
  const codec = codecsOf(audio.mimeType)
  return {
    preferredAudioLanguage: audio.language ?? '',
    preferredAudioRole: audioManifestRole(audio, hasAnyDrc),
    preferredAudioLabel: audioManifestLabel(audio, hasAnyDrc),
    preferredAudioCodecs: codec ? [codec, 'opus', 'mp4a.40.2', 'mp4a.40.5'] : ['opus', 'mp4a.40.2', 'mp4a.40.5'],
  }
}

// Aligns Shaka's opening video variant to the exact format prewarmStart() already requested over SABR so both init and
// segment 0 hit the prewarmed dual-track response. Keeps ABR enabled during load() so AbrManager honors
// abr.restrictions and picks highest-bitrate Opus audio (with abr.enabled: false during load, Shaka bypasses
// AbrManager and falls back to the first lowest-bitrate video/audio variant in the manifest).
const vodOpening = (session: PlaybackSession, { pinned }: { pinned: boolean }) => {
  const video = session.videoFormats.find((format) => format.key === session.selectedVideoKey)
  const height = video ? restrictionHeight(video) : undefined
  return {
    ...vodAudioOpening(session),
    ...(video && height
      ? {
          preferredVideoCodecs: [codecsOf(video.mimeType).split('.')[0]!],
          abr: {
            enabled: true,
            restrictToElementSize: false,
            defaultBandwidthEstimate: Math.max(pinned ? 10_000_000 : 1_500_000, video.bitrate * 2),
            restrictions: { minHeight: height, maxHeight: height },
          },
        }
      : {}),
  }
}

// a live session's own error, so the restart reopens the playback and keeps the engine
const LIVE_STALLED = 'youtube: live stream stopped delivering'

const describeShakaError = (error: shaka.util.Error) => {
  const cause = error.data.find((value: unknown) => value instanceof Error) as Error | undefined
  return cause ?? Object.assign(new Error(`shaka: error ${error.code} in category ${error.category}`), { cause: error })
}

export const startShakaPlayback = async ({
  api,
  video,
  videoId,
  playerParams,
  stableVolume,
  startTime,
  autoPlay = true,
  bufferingGoal = 30,
  maxHeight: requestedMaxHeight,
  preview = false,
  pinVideoFormat = false,
  openOptions,
  sessionPromise: existingSessionPromise,
  signal,
  onError,
  onEndScreen,
  onAutoplayMuted,
}: {
  api: FrameApi
  video: HTMLVideoElement
  videoId: string
  // the inline playback params of the card previewed or clicked, which the frame reads the watch page with
  playerParams?: string
  stableVolume?: boolean
  startTime: number
  autoPlay?: boolean
  bufferingGoal?: number
  maxHeight?: number
  preview?: boolean
  /** Keeps ABR off on `session.selectedVideoKey` after load (used by Shorts and fixed manual Watch quality). */
  pinVideoFormat?: boolean
  openOptions?: OpenPlaybackOptions
  sessionPromise?: Promise<PlaybackSession>
  signal: AbortSignal
  onError(error: unknown): void
  // the video's end screen; for a page read with a card's params, whose answer carries none, the plain page's
  onEndScreen?: (elements: EndScreenElement[]) => void
  // called when the browser blocks unmuted autoplay and playback falls back to muted
  onAutoplayMuted?: () => void
}) => {
  if (signal.aborted) throw signal.reason
  installScheme()
  if (!shaka.Player.isBrowserSupported()) throw new Error('shaka: browser is not supported')

  const maxHeight = requestedMaxHeight ?? Math.max(360, Math.ceil(video.getBoundingClientRect().height * devicePixelRatio))
  const resolvedOptions: OpenPlaybackOptions | undefined = openOptions
    ?? (preview ? { preview: true } : startTime > 0 ? { prewarm: false } : undefined)
  const sessionPromise = existingSessionPromise
    ?? (resolvedOptions
      ? api.openPlayback(videoId, maxHeight, playerParams, stableVolume, resolvedOptions)
      : api.openPlayback(videoId, maxHeight, playerParams, stableVolume))
  void sessionPromise.catch(() => {})
  const closeSession = () => {
    void sessionPromise.then((session) => api.closePlayback(session.id)).catch(() => {})
  }

  const bridgeId = crypto.randomUUID()
  let player: shaka.Player | undefined
  let networking: shaka.net.NetworkingEngine | undefined
  let manifestUrl: string | undefined
  let requestFilter: shaka.extern.RequestFilter | undefined
  let playerError: ((event: Event) => void) | undefined
  let buffering: ((event: Event) => void) | undefined
  let seeking: (() => void) | undefined
  let unlockAbr: (() => void) | undefined
  let openingRestricted = false
  let stallTimer: ReturnType<typeof setInterval> | undefined
  const captionUrls: string[] = []
  // eslint-disable-next-line prefer-const
  let abortListener: (() => void) | undefined
  let destroyed = false

  const destroy = async () => {
    if (destroyed) return
    destroyed = true
    if (abortListener) signal.removeEventListener('abort', abortListener)
    clearInterval(stallTimer)
    bridges.delete(bridgeId)
    if (networking && requestFilter) networking.unregisterRequestFilter(requestFilter)
    if (player && playerError) player.removeEventListener('error', playerError)
    if (player && buffering) player.removeEventListener('buffering', buffering)
    if (seeking) video.removeEventListener('seeking', seeking)
    if (unlockAbr) video.removeEventListener('loadeddata', unlockAbr)
    if (diagnosticBridgeId === bridgeId) {
      diagnosticBridgeId = undefined
      delete document.documentElement.dataset.playbackBuffering
      delete document.documentElement.dataset.playerEngine
    }
    if (manifestUrl) URL.revokeObjectURL(manifestUrl)
    for (const url of captionUrls) URL.revokeObjectURL(url)
    await player?.destroy().catch(() => {})
    closeSession()
  }
  abortListener = () => void destroy()
  signal.addEventListener('abort', abortListener, { once: true })

  try {
    const activePlayer = new shaka.Player()
    player = activePlayer
    networking = activePlayer.getNetworkingEngine() ?? undefined
    if (!networking) throw new Error('shaka: networking engine is missing')
    playerError = (event: Event) => {
      const detail = (event as Event & { detail?: shaka.util.Error }).detail
      if (destroyed || !detail) return
      const error = describeShakaError(detail)
      // a refused session answers every later request at once, so Shaka, which takes it for a variant's failure, would
      // spin through its variants (measured 2026-11-10: about 1600 requests a second): this player ends here
      if (isStreamRefusal(error)) void destroy()
      if (detail.severity === shaka.util.Error.Severity.CRITICAL || isStreamRefusal(error)) onError(error)
    }
    buffering = (event: Event) => {
      if (destroyed) return
      diagnosticBridgeId = bridgeId
      const active = Boolean((event as Event & { buffering?: boolean }).buffering)
      document.documentElement.dataset.playbackBuffering = String(active)
    }
    activePlayer.addEventListener('error', playerError)
    activePlayer.addEventListener('buffering', buffering)
    activePlayer.configure({
      preferredAudioCodecs: ['opus', 'mp4a.40.2', 'mp4a.40.5'],
      abr: { restrictToElementSize: true },
      streaming: {
        bufferingGoal,
        rebufferingGoal: 0,
        bufferBehind: 30,
        segmentPrefetchLimit: 0,
        ignoreTextStreamFailures: true,
        retryParameters: {
          maxAttempts: 3,
          baseDelay: 500,
          backoffFactor: 2,
          fuzzFactor: 0.5,
          timeout: 30_000,
          stallTimeout: 20_000,
          connectionTimeout: 20_000,
        },
      },
    })

    await activePlayer.attach(video)
    if (signal.aborted) throw signal.reason

    const session = await sessionPromise
    if (signal.aborted) throw signal.reason
    const bridge: Bridge = {
      api,
      generation: 0,
      initialLiveManifest: session.isLive && session.manifest ? session.manifest : undefined,
      pendingInits: new Set<Promise<unknown>>(),
      player: activePlayer,
      requestNumber: 0,
      session,
      video,
    }
    bridges.set(bridgeId, bridge)
    // live's manifest has to be refetchable, and a blob's contents are frozen at creation
    const loadUrl = session.isLive
      ? `sabr://manifest?session=${bridgeId}`
      : (manifestUrl = URL.createObjectURL(new Blob([session.manifest], { type: 'application/dash+xml' })))
    requestFilter = (type, request, context) => {
      if (type !== shaka.net.NetworkingEngine.RequestType.SEGMENT) return
      request.uris = request.uris.map((uri) => {
        if (!uri.startsWith('sabr:')) return uri
        const url = new URL(uri)
        url.searchParams.set('session', bridgeId)
        url.searchParams.set('generation', String(bridge.generation))
        // SegmentBase index requests have no SegmentReference and reuse the init response cache.
        url.searchParams.set('kind', context?.segment ? 'media' : 'init')
        url.searchParams.set('start', String((context?.segment?.getStartTime() ?? video.currentTime) * 1_000))
        return url.toString()
      })
    }
    networking.registerRequestFilter(requestFilter)
    seeking = () => {
      bridge.generation += 1
    }
    video.addEventListener('seeking', seeking)
    // live gets its streaming budget BEFORE load, not after
    const pinnedOpening = preview || pinVideoFormat
    if (session.isLive) {
      activePlayer.configure({
        streaming: {
          bufferingGoal: 10,
          rebufferingGoal: 0.5,
          bufferBehind: 30,
          gapDetectionThreshold: 0.3,
          gapPadding: 0.1,
          stallEnabled: true,
          stallThreshold: 0.5,
          stallSkip: 0.2,
        },
        // live runs WITHOUT automatic ABR: the SABR session streams one video format at a time, so every switch costs its cached readahead
        abr: { enabled: false, defaultBandwidthEstimate: 400_000 },
      })
      activePlayer.configure(liveOpening(session))
    } else if (pinnedOpening) {
      activePlayer.configure(vodOpening(session, { pinned: true }))
    } else if (startTime === 0 && resolvedOptions?.prewarm !== false) {
      openingRestricted = true
      activePlayer.configure(vodOpening(session, { pinned: false }))
    } else {
      activePlayer.configure(vodAudioOpening(session))
    }
    await activePlayer.load(loadUrl, startTime || undefined, 'application/dash+xml')
    if (signal.aborted) throw signal.reason
    const showEndScreen = (elements: EndScreenElement[]) => {
      if (!destroyed) onEndScreen?.(elements)
    }
    if (!session.playerParams) showEndScreen(session.endScreen)
    else if (onEndScreen) void api.endScreen(videoId).then(showEndScreen, () => {})
    if (pinnedOpening && !session.isLive) {
      activePlayer.configure({ abr: { enabled: false, restrictToElementSize: false, restrictions: { minHeight: 0, maxHeight: Infinity } } })
    } else if (openingRestricted) {
      unlockAbr = () => {
        if (!openingRestricted || destroyed) return
        openingRestricted = false
        if (unlockAbr) video.removeEventListener('loadeddata', unlockAbr)
        activePlayer.configure({ abr: { restrictToElementSize: true, restrictions: { minHeight: 0, maxHeight: Infinity } } })
      }
      if (video.readyState >= 2) unlockAbr()
      else video.addEventListener('loadeddata', unlockAbr, { once: true })
    }
    // no goToLive(): it seeks to the availability end, which is where the NEXT segment will begin, not where the newest one is
    if (session.isLive) {
      activePlayer.configure({ abr: { restrictToElementSize: true, restrictions: { minHeight: 0, maxHeight: Infinity } } })
      const waitForBuffered = () => new Promise<void>((resolve) => {
        if (destroyed || signal.aborted || video.buffered.length > 0) return resolve()
        const events = ['progress', 'loadeddata', 'canplay', 'loadedmetadata'] as const
        const done = () => {
          clearTimeout(deadline)
          clearInterval(poll)
          signal.removeEventListener('abort', done)
          for (const event of events) video.removeEventListener(event, check)
          resolve()
        }
        const check = () => {
          if (destroyed || signal.aborted || video.buffered.length > 0) done()
        }
        const deadline = setTimeout(done, 10_000)
        const poll = setInterval(check, 50)
        signal.addEventListener('abort', done, { once: true })
        for (const event of events) video.addEventListener(event, check)
      })
      await waitForBuffered()
      if (!destroyed && !signal.aborted && video.buffered.length > 0) {
        const start = video.buffered.start(0)
        if (video.currentTime < start) video.currentTime = start + 0.1
      }
      const stalled = createStallWatch()
      if (!destroyed) stallTimer = setInterval(() => {
        const playing = !video.paused && !video.ended && document.visibilityState === 'visible'
        if (!destroyed && stalled(video.currentTime, playing, Date.now())) onError(new Error(LIVE_STALLED))
      }, 1_000)
    }
    diagnosticBridgeId = bridgeId
    markStartup('player-attached')
    // `timeupdate` rather than `playing`: an element fires `playing` when it intends to play, and this has to mean the clock moved
    const markFirstFrame = () => {
      if (video.currentTime <= 0) return
      markStartup('first-frame')
      video.removeEventListener('timeupdate', markFirstFrame)
    }
    video.addEventListener('timeupdate', markFirstFrame)
    document.documentElement.dataset.playerEngine = 'shaka'
    // the mute is the browser's choice, not the viewer's, so it is never written back to settings
    const play = async () => {
      if (destroyed) return
      try {
        await video.play()
      } catch (error) {
        if (destroyed || signal.aborted) return
        if ((error as { name?: unknown } | null)?.name === 'AbortError') return
        if (!video.muted) {
          video.muted = true
          onAutoplayMuted?.()
          await video.play().catch(() => {})
        }
      }
    }
    if (autoPlay) {
      // live does not await play(): a live element that is gap-jumping can leave that promise pending indefinitely;
      // previews also return controls/storyboards immediately while video.play() settles
      if (session.isLive || preview) void play()
      else await play()
    }

    const heights = [...new Set(
      session.videoFormats
        .map((format) => format.height)
        .filter((height): height is number => typeof height === 'number' && height > 0),
    )].sort((a, b) => b - a)

    // switching quality is two coordinated moves: the Shaka half alone leaves the SABR adapter advertising the old format
    let qualityRequestId = 0
    const selectQuality = async (height: number | 'auto') => {
      const token = ++qualityRequestId
      const stopped = () => destroyed || token !== qualityRequestId
      if (stopped()) return
      openingRestricted = false
      if (unlockAbr) video.removeEventListener('loadeddata', unlockAbr)
      if (height === 'auto') {
        activePlayer.configure({ abr: { enabled: true, restrictToElementSize: true, restrictions: { minHeight: 0, maxHeight: Infinity } } })
        return
      }
      const format = session.videoFormats
        .filter((candidate) => candidate.height === height)
        .sort((a, b) => b.bitrate - a.bitrate)[0]
      if (!format) return
      // Drain in-flight init/index fetches before switching tracks (same Shaka 4.16.37 StreamingEngine.onUpdate_ bug
      // documented in applyAudio below).
      for (;;) {
        await waitForPendingInits(bridge, stopped)
        if (stopped()) return
        await api.selectVideoFormat(session.id, format.key)
        if (stopped()) return
        if (bridge.pendingInits.size === 0) break
      }
      // restrictToElementSize also restricts manual picks, so it has to come off before selecting a taller track
      activePlayer.configure({ abr: { enabled: false, restrictToElementSize: false, restrictions: { minHeight: 0, maxHeight: Infinity } } })
      const variants = activePlayer.getVariantTracks()
      const activeAudioId = variants.find((candidate) => candidate.active)?.audioId
      const sameAudio = activeAudioId != null
        ? variants.filter((candidate) => candidate.audioId === activeAudioId)
        : variants
      const pool = sameAudio.some((candidate) => candidate.height === height) ? sameAudio : variants
      const track = pool
        .filter((candidate) => candidate.height === height)
        .sort((a, b) => b.bandwidth - a.bandwidth)[0]
      if (!track) return
      // going UP drops the already-buffered lower quality and refetches, with SAFE_MARGIN of decoded video left in front of the playhead
      const upgrade = (video.videoHeight || 0) > 0 && height > video.videoHeight
      activePlayer.selectVariantTrack(track, upgrade, upgrade ? SAFE_MARGIN_SECONDS : 0)
    }

    const supportedAudio = session.isLive
      ? []
      : session.audioFormats.filter((format) =>
          typeof MediaSource === 'undefined' || MediaSource.isTypeSupported(format.mimeType),
        )
    const audioTracks = audioTracksOf(supportedAudio)
    const initialAudio = session.audioFormats.find((format) => format.key === session.selectedAudioKey)
    let activeAudioKey = initialAudio?.key
    let audioChain: Promise<unknown> = Promise.resolve()
    let audioRequestId = 0

    const applyAudio = async (trackId: string | undefined, drc: boolean, token: number) => {
      const stopped = () => destroyed || token !== audioRequestId
      if (stopped() || session.isLive) return
      const format = pickAudioFormat(supportedAudio, { trackId, drc })
      if (!format || format.key === activeAudioKey) return
      // Shaka 4.16.37 deadlocks StreamingEngine.onUpdate_() if switchInternal_() starts clearBuffer_() while a
      // stream.createSegmentIndex() init request is in flight: case 6 schedules an update while clearingBuffer is true,
      // and case 1 returns before resetting updateTimer, leaving a dead non-null timer that blocks every later update
      // and seek. Wait for in-flight init fetches to settle and re-sync the frame format if an old init ran meanwhile.
      for (;;) {
        await waitForPendingInits(bridge, stopped)
        if (stopped()) return
        await api.selectAudioFormat(session.id, format.key)
        if (stopped()) return
        if (bridge.pendingInits.size === 0) break
      }
      activeAudioKey = format.key
      const variants = activePlayer.getVariantTracks?.() ?? []
      const repId = audioRepresentationId(format)
      const exact = variants.filter((candidate) => candidate.originalAudioId === repId)
      const matching = exact.length > 0
        ? exact
        : (() => {
            const ids = new Set(
              supportedAudio
                .filter((candidate) => candidate.audioTrackId === format.audioTrackId && Boolean(candidate.isDrc) === Boolean(format.isDrc))
                .map(audioRepresentationId),
            )
            return variants.filter((candidate) => candidate.originalAudioId !== null && ids.has(candidate.originalAudioId))
          })()
      const sample = matching[0]
      if (!sample) return
      const safeMargin = video.paused ? 0 : SAFE_MARGIN_SECONDS
      // With manual quality (ABR off), selectAudioTrack picks the first (lowest-bitrate) audio representation in the
      // AdaptationSet, so select the exact highest-bitrate variant directly when ABR is disabled.
      const abrEnabled = activePlayer.getConfiguration?.().abr?.enabled !== false
      const audioTrack = abrEnabled
        ? activePlayer.getAudioTracks?.().find((candidate) =>
            candidate.language === sample.language
            && candidate.label === sample.label
            && candidate.codecs === sample.audioCodec
            && (candidate.roles[0] ?? '') === (sample.audioRoles?.[0] ?? ''),
          )
        : undefined
      if (audioTrack) {
        activePlayer.selectAudioTrack(audioTrack, safeMargin)
        return
      }
      const activeVideoId = variants.find((candidate) => candidate.active)?.originalVideoId
      const target = (activeVideoId ? matching.find((candidate) => candidate.originalVideoId === activeVideoId) : undefined) ?? sample
      activePlayer.selectVariantTrack(target, true, safeMargin)
    }

    // serialized so quick switches between tracks or Stable Volume cannot race out of order
    const selectAudio = (trackId: string | undefined, drc: boolean) => {
      const token = ++audioRequestId
      const run = audioChain.then(() => applyAudio(trackId, drc, token))
      audioChain = run.catch(() => {})
      return run
    }

    const hasDrc = (trackId?: string) => !session.isLive && trackHasDrc(supportedAudio, trackId)

    // Shaka is addressed by the numeric id it assigned: `getTextTracks` builds fresh objects on every call
    const captionIds = new Map<string, number>()
    let captionChain: Promise<unknown> = Promise.resolve()

    const applyCaption = async (trackId: string | undefined, translateTo: string | undefined) => {
      if (destroyed) return
      if (!trackId) {
        activePlayer.setTextTrackVisibility(false)
        return
      }
      const track = session.captionTracks.find((candidate) => candidate.id === trackId)
      if (!track) return
      const key = translateTo ? `${trackId}>>${translateTo}` : trackId
      if (!captionIds.has(key)) {
        const vtt = await api.captionCues(session.id, trackId, translateTo)
        if (destroyed) return
        const url = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }))
        captionUrls.push(url)
        const label = captionLabel(session.captionTracks, session.translationLanguages, { trackId, translateTo }) ?? track.label
        const added = await activePlayer.addTextTrackAsync(url, translateTo ?? track.languageCode, 'subtitles', 'text/vtt', undefined, label)
        if (destroyed) return
        captionIds.set(key, added.id)
      }
      const target = activePlayer.getTextTracks().find((candidate) => candidate.id === captionIds.get(key))
      if (!target) return
      activePlayer.selectTextTrack(target)
      activePlayer.setTextTrackVisibility(true)
    }

    // serialized so two quick picks cannot race to decide which track ends up visible
    const selectCaption = (trackId: string | undefined, translateTo?: string) => {
      const run = captionChain.then(() => applyCaption(trackId, translateTo))
      captionChain = run.catch(() => {})
      return run
    }

    return {
      player: activePlayer,
      play,
      destroy,
      heights,
      selectQuality,
      audioTracks,
      audioTrackId: initialAudio?.audioTrackId,
      hasDrc,
      selectAudio,
      storyboards: session.storyboards,
      captionTracks: session.captionTracks,
      translationLanguages: session.translationLanguages,
      selectCaption,
      // REPORTED rather than hardcoded false: the live branch falls through to this same return, and returning false is what left a live stream showing a 3348:27:07 / 0:00 clock instead of a LIVE badge
      isLive: session.isLive,
    }
  } catch (error) {
    await destroy()
    throw error instanceof shaka.util.Error ? describeShakaError(error) : error
  }
}
