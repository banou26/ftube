import type { SabrFormat } from 'googlevideo/shared-types'

import { buildURL } from 'bgutils-js'
import { buildSabrFormat, FormatKeyUtils } from 'googlevideo/utils'
import { Constants, Innertube, Platform, Player, Types, UniversalCache, Utils, YT } from 'youtubei.js/web'

import type { PlaybackFormat } from './protocol'

import { readChannel } from '../engine/signed-in'
import { WEB_CLIENT_VERSION } from '../sources/youtube/client-version'
import { mintPoToken, recoverPoTokenSession, warmPoTokenSession } from './botguard'
import type { CaptionSource } from './captions'
import type { EndScreenElement } from './end-screen'
import type { Storyboard } from './storyboard'

import { parseCaptionTracks } from './captions'
import { egressFetch } from './egress'
import { parseEndScreen } from './end-screen'
import { playableFormats } from './formats'
import { PLAYBACK_REFUSED } from './protocol'
import { readRefusal } from './refusal'
import { parseStoryboards } from './storyboard'
import { GVS_ORIGIN_KEY, VISITOR_DATA_KEY } from './identity'
import { realm } from './realm'
import { fetchPlayerResponse, pagePlayerOf, warmChallengePage } from './watch-page'

export { GVS_ORIGIN_KEY }

type YoutubeFormat = {
  itag: number
  target_duration_sec?: number
  width?: number
  height?: number
  bitrate: number
  average_bitrate?: number
  mime_type: string
  quality_label?: string
  xtags?: string
  is_drc?: boolean
  is_dubbed?: boolean
  is_auto_dubbed?: boolean
  is_descriptive?: boolean
  has_audio: boolean
  has_video: boolean
  language?: string | null
  audio_track?: { id: string }
  init_range?: { start: number, end: number }
  index_range?: { start: number, end: number }
}

type InnertubeContext = {
  client: {
    visitorData: string
    clientVersion: string
    clientName: string
    osName: string
    osVersion: string
    userAgent: string
  }
}

;(Constants as unknown as { CLIENTS: { WEB: { VERSION: string } } }).CLIENTS.WEB.VERSION = WEB_CLIENT_VERSION

/* Evaluates only what youtubei.js already built: Player.decipher appends its own processor ending in
   `return process(n, sp, s)`, so `env` is deliberately unused. Do not re-add a second `return` reading
   `exportedVars.nFunction`/`sigFunction`: neither name exists in youtubei.js 18.3.0, whose only export is `nsigFunction`. */
Platform.shim.eval = async (data: Types.BuildScriptResult, _env: Record<string, Types.VMPrimative>) =>
  new Function(data.output)()

const readVisitorData = () => {
  try {
    return localStorage.getItem(VISITOR_DATA_KEY) ?? undefined
  } catch {
    return undefined
  }
}

const storeVisitorData = (visitorData: string) => {
  try {
    localStorage.setItem(VISITOR_DATA_KEY, visitorData)
  } catch {}
}

/** Whether this engine reads YouTube signed in: the FKN page answered a session at boot, and no answer ended it since. */
export const hasSessionCookie = () => realm.cookie !== undefined && !realm.signedOut

const authCookie = realm.cookie

/** The engine's fetch for youtubei.js, captions and the watch page: each request takes its lane (lanes.ts). */
export const youtubeFetch = (input: RequestInfo | URL, init?: RequestInit) => realm.fetch(input, init)

// One build per frame, but a failed build is dropped so the next call builds it again: a kept rejection fails every later playback in the frame.
const keepOnSuccess = <T>(build: () => Promise<T>) => {
  let pending: Promise<T> | undefined
  return () => pending ??= build().catch((error: unknown) => {
    pending = undefined
    throw error
  })
}

export const catalogInnertube = keepOnSuccess(() => Innertube.create({
  fetch: youtubeFetch,
  generate_session_locally: false,
  retrieve_innertube_config: true,
  retrieve_player: false,
  visitor_data: readVisitorData(),
  ...(authCookie && { cookie: authCookie }),
}).then((client) => {
  const context = client.session.context as unknown as InnertubeContext
  // retrieve_innertube_config can hand back a canary/experiment clientVersion; YouTube's public innertube API then rejects EVERY request with FAILED_PRECONDITION.
  const rawVersion = context.client.clientVersion
  if (rawVersion && !/^\d+\.\d{8}\.\d{2}\.\d{2}$/.test(rawVersion)) {
    context.client.clientVersion = rawVersion.match(/(\d+\.\d{8}\.\d{2}\.\d{2})$/)?.[1] ?? WEB_CLIENT_VERSION
  }
  storeVisitorData(context.client.visitorData)
  return client
}))

const playerCache = new UniversalCache(true)

// Fallback only: used when a watch page names no PLAYER_JS_URL or its page player fails to build.
// Building this eagerly on boot downloads /iframe_api + a 2.5 MB base.js that matched the watch page's player 0 of 78 times (2026-11-05).
const innertube = keepOnSuccess(() => catalogInnertube().then((client) => {
  const context = client.session.context as unknown as InnertubeContext
  return Innertube.create({
    fetch: youtubeFetch,
    generate_session_locally: true,
    retrieve_innertube_config: false,
    retrieve_player: true,
    cache: playerCache,
    visitor_data: context.client.visitorData,
    user_agent: context.client.userAgent,
    ...(authCookie && { cookie: authCookie }),
  })
}))

void catalogInnertube()
  .then((client) => {
    const context = client.session.context as unknown as InnertubeContext
    warmPoTokenSession(context.client.visitorData)
  })
  .catch(() => {})

const prewarmEgress = (origin: string) => {
  void Promise.resolve(egressFetch(`${origin}/generate_204`, { method: 'GET' }))
    .then((response) => response?.body?.cancel())
    .catch(() => {})
}

try {
  const gvsOrigin = localStorage.getItem(GVS_ORIGIN_KEY)
  if (gvsOrigin) prewarmEgress(gvsOrigin)
} catch {}
// Prewarm libcurl/WebVPN sockets for BotGuard's interpreter and GenerateIT while the first page streams.
prewarmEgress('https://www.google.com')
prewarmEgress(new URL(buildURL('GenerateIT', true)).origin)

const pagePlayers = new Map<string, () => Promise<Player>>()

const loadPagePlayer = (pageId: string) => {
  let build = pagePlayers.get(pageId)
  if (!build) {
    build = keepOnSuccess(() => Player.create(playerCache, youtubeFetch, undefined, pageId))
    pagePlayers.set(pageId, build)
  }
  return build()
}

/* The watch page names the exact player that deciphers its stream URLs (`PLAYER_JS_URL`); /iframe_api's player
   answered 403 to every request 7 of 7 times when it differed, and 0 of 78 matched (2026-11-05). Building the page's
   player directly avoids downloading and parsing an unused /iframe_api player on cold start. */
const decipherPlayer = async (pageId: string | undefined, started?: Promise<Player>) => {
  if (!pageId) return (await innertube()).session.player!
  return (started ?? loadPagePlayer(pageId)).catch(async (error: unknown) => {
    const fallback = (await innertube()).session.player!
    console.warn(`youtube: player ${pageId} failed to build, deciphering with ${fallback.player_id}`, error)
    return fallback
  })
}

const warmPagePlayer = (pageId: string) => {
  void loadPagePlayer(pageId).catch(() => {})
}

// youtubei.js keeps a visitor_data it is given, so a stored visitor is the catalog's and only a first visit waits for its build
const catalogVisitor = async () =>
  readVisitorData() ?? ((await catalogInnertube()).session.context as unknown as InnertubeContext).client.visitorData

/**
 * Warms the BotGuard session and web player script from youtube.com while the viewer browses non-watch pages, so the
 * first video opened after start does not wait ~1 s for attestation and player compilation.
 */
export const warmPlaybackResources = () => {
  if (!warmChallengePage(catalogVisitor(), warmPagePlayer)) return
  warmPoTokenSession('warmup')
}

const playbackResponseCache = new Map<string, Promise<Record<string, unknown>>>()
const prefetchedPlayerFor = new WeakMap<Promise<Record<string, unknown>>, () => Promise<Player> | undefined>()

/* YouTube counts a playback toward the Home of the visitor its watch page was read as, and only when the registration
   names that visitor too. In fresh youtube.com profiles, registrations sent with both filled Home 3 of 3 times (34 to
   37 videos) and with either one alone 0 of 4; with the watch-time reports blocked, youtube.com's own player still
   filled it 2 of 2 (measured 2026-11-10). So both go as the catalog's visitor, the one Home is read as. */
export const prefetchInitialPlayerResponse = (videoId: string) => {
  const cached = playbackResponseCache.get(videoId)
  if (cached) return cached
  let startedPlayer: Promise<Player> | undefined
  const promise = fetchPlayerResponse(videoId, catalogVisitor(), undefined, (pageId) => {
    startedPlayer = loadPagePlayer(pageId)
    void startedPlayer.catch(() => {})
  })
  prefetchedPlayerFor.set(promise, () => startedPlayer)
  playbackResponseCache.set(videoId, promise)
  promise.catch(() => {
    if (playbackResponseCache.get(videoId) === promise) playbackResponseCache.delete(videoId)
  })
  if (playbackResponseCache.size > 6) {
    const oldest = playbackResponseCache.keys().next().value
    if (oldest !== undefined && oldest !== videoId) playbackResponseCache.delete(oldest)
  }
  return promise
}

type BeaconFormat = Pick<YoutubeFormat, 'itag' | 'has_audio' | 'has_video'>

const registerPlayback = async (raw: Record<string, unknown>, nonce: string, formats: BeaconFormat[], visitorData: string) => {
  const base = (raw as {
    playbackTracking?: { videostatsPlaybackUrl?: { baseUrl?: string } }
  }).playbackTracking?.videostatsPlaybackUrl?.baseUrl
  if (!base) return
  const url = new URL(base)
  url.searchParams.set('ver', '2')
  url.searchParams.set('cpn', nonce)
  const audio = formats.find((format) => format.has_audio && !format.has_video)
  const video = formats.find((format) => format.has_video)
  if (audio) url.searchParams.set('afmt', String(audio.itag))
  if (video) url.searchParams.set('fmt', String(video.itag))
  // signed in, the session lane sends it to www.youtube.com, as a brand channel with its header (lanes.ts)
  const response = await youtubeFetch(url, { method: 'POST', headers: { 'X-Goog-Visitor-Id': visitorData } })
  if (!response.ok) console.warn(`youtube: playback registration returned ${response.status}`)
}

/* A brand channel's playback is filed only from tracking addresses YouTube issued to that channel. The watch page is
   the account's own channel's whatever X-Goog-PageId says, and a registration from it sent as the brand landed in
   neither channel's history; one from a /player answer the session lane read as the brand landed in the brand's within
   a minute (measured 2026-11-20). Without a signature timestamp, the account's own /player answer that day was "The
   page needs to be reloaded", with no tracking. */
const trackingAnswer = async (
  videoId: string,
  raw: Record<string, unknown>,
  client: Innertube,
  signatureTimestamp: () => Promise<number | undefined>,
) => {
  if (!hasSessionCookie() || readChannel() === undefined) return raw
  const { data } = await client.actions.execute('/player', {
    videoId,
    racyCheckOk: true,
    contentCheckOk: true,
    playbackContext: { contentPlaybackContext: { signatureTimestamp: await signatureTimestamp() } },
  })
  return data as Record<string, unknown>
}

const beaconFormats = (raw: Record<string, unknown>): BeaconFormat[] => {
  const adaptive = (raw as {
    streamingData?: { adaptiveFormats?: { itag?: number, mimeType?: string }[] }
  }).streamingData?.adaptiveFormats ?? []
  return adaptive.flatMap((format) => {
    if (!format.itag || !format.mimeType) return []
    return [{
      itag: format.itag,
      has_video: format.mimeType.startsWith('video'),
      has_audio: format.mimeType.startsWith('audio'),
    }]
  })
}

/* `init_range` is required for VOD and absent for live. It still gates VOD on purpose: letting range-less
   formats through there admits ones the VOD manifest cannot describe and playback stops before the first
   frame. Requiring it unconditionally is what dropped every live format before a session could be built. */
const playbackFormat = (format: YoutubeFormat, isLive: boolean): PlaybackFormat | undefined => {
  if (!format.mime_type) return undefined
  if (!isLive && !format.init_range) return undefined
  const sabr = buildSabrFormat(format as never)
  const key = FormatKeyUtils.fromFormat(sabr)
  if (!key) return undefined
  return {
    key,
    itag: format.itag,
    mimeType: format.mime_type,
    bitrate: format.average_bitrate ?? format.bitrate,
    width: format.width,
    height: format.height,
    qualityLabel: format.quality_label,
    audioTrackId: format.audio_track?.id,
    language: format.language ?? undefined,
    initRange: format.init_range,
    indexRange: format.index_range,
    targetDurationMs: format.target_duration_sec ? format.target_duration_sec * 1_000 : undefined,
  }
}

export type SabrSource = {
  videoId: string
  isLive: boolean
  durationMs: number
  manifest: string
  streamingUrl: string
  ustreamerConfig: string
  formats: SabrFormat[]
  playbackFormats: PlaybackFormat[]
  storyboards: Storyboard[]
  captions: CaptionSource[]
  endScreen: EndScreenElement[]
  // the card params the page was read with; unset for a plain read, including the one after params whose answer did not play
  playerParams?: string
  clientInfo: Record<string, unknown>
  mint(): Promise<string>
  recoverMint(): Promise<void>
}

// a card's params work for their own video only: on another, the answer was unplayable with no formats (2026-11-10)
const playsWithParams = (raw: Record<string, unknown>) => {
  const answer = raw as { playabilityStatus?: { status?: string }, streamingData?: { serverAbrStreamingUrl?: string } }
  return answer.playabilityStatus?.status === 'OK' && Boolean(answer.streamingData?.serverAbrStreamingUrl)
}

/**
 * A SABR session's source, off the video's watch page. A card's hover preview, or a click on the card, passes its
 * inline playback params, and the page is read afresh with them; an answer to them that does not play is read again
 * as the plain page. The plain page an intent prefetch read for the click is neither used nor dropped.
 */
export const getSabrSource = async (videoId: string, playerParams?: string): Promise<SabrSource> => {
  // The /player API alternative is NOT an option: anonymous /player calls yield preview-tier (~60s) SABR sessions.
  let startedPlayer: Promise<Player> | undefined
  const rawPromise = playerParams
    ? fetchPlayerResponse(videoId, catalogVisitor(), playerParams, (pageId) => {
        startedPlayer = loadPagePlayer(pageId)
        void startedPlayer.catch(() => {})
      })
    : prefetchInitialPlayerResponse(videoId)
  // Consumed and EVICTED: a session refresh or retry re-enters here needing fresh streaming URLs and must not reuse the cached response.
  if (!playerParams) playbackResponseCache.delete(videoId)
  void rawPromise.catch(() => {})
  void rawPromise.then((raw) => {
    const streamingUrl = (raw as {
      streamingData?: { serverAbrStreamingUrl?: string }
    }).streamingData?.serverAbrStreamingUrl
    if (!streamingUrl) return
    return Promise.resolve(egressFetch(`${new URL(streamingUrl).origin}/generate_204`, { method: 'GET' }))
      .then((response) => response?.body?.cancel())
  }).catch(() => {})
  // The WEB GVS/streaming poToken is bound to the VIDEO ID, not the visitor or datasync id; the botguard session itself stays visitor/attestation-bound.
  const mintIdentifier = videoId
  warmPoTokenSession(mintIdentifier)
  const [catalogClient, raw] = await Promise.all([catalogInnertube(), rawPromise])
  const context = catalogClient.session.context as unknown as InnertubeContext
  warmPoTokenSession(context.client.visitorData)
  if (playerParams && !playsWithParams(raw)) return getSabrSource(videoId)
  const nonce = Utils.generateRandomString(16)
  const info = new YT.VideoInfo([{ data: raw } as never], catalogClient.actions, Utils.generateRandomString(16))
  if (info.playability_status?.status !== 'OK') throw new Error(`${PLAYBACK_REFUSED}${JSON.stringify(readRefusal(raw))}`)
  const streaming = info.streaming_data
  /* `is_live` rather than `is_live_content`, which stays true for the VOD a finished stream leaves behind. */
  const isLive = info.basic_info?.is_live === true
  if (!streaming?.server_abr_streaming_url) throw new Error('youtube: SABR URL is missing')
  const rawFormats = playableFormats(streaming.adaptive_formats ?? []) as unknown as YoutubeFormat[]
  const playbackFormats = rawFormats
    .map((format) => playbackFormat(format, isLive))
    .filter((format) => format !== undefined)
  // The manifest must advertise EXACTLY the formats the SABR session can serve, so it is filtered by format KEY rather than by itag: a DRC or dubbed audio track shares itag 251 with the plain one and differs only in xtags.
  const allowedKeys = new Set(playbackFormats.map((format) => format.key))
  const playerPromise = decipherPlayer(pagePlayerOf(raw), startedPlayer ?? prefetchedPlayerFor.get(rawPromise)?.())
  void Promise.resolve().then(async () => {
    const answer = await trackingAnswer(videoId, raw, catalogClient, () => playerPromise.then((player) => player.signature_timestamp))
    return registerPlayback(answer, nonce, beaconFormats(raw), context.client.visitorData)
  }).catch(() => {})
  const [manifest, decipheredUrl] = await Promise.all([
    isLive ? Promise.resolve('') : info.toDash({
      format_filter: (format: YoutubeFormat) => {
        const key = FormatKeyUtils.fromFormat(buildSabrFormat(format as never))
        return !key || !allowedKeys.has(key)
      },
      manifest_options: { is_sabr: true, include_thumbnails: false },
    } as never),
    playerPromise.then((player) => player.decipher(streaming.server_abr_streaming_url)),
  ])
  const url = new URL(decipheredUrl)
  url.searchParams.set('alr', 'yes')
  url.searchParams.set('cpn', nonce)
  const ustreamerConfig = info.player_config?.media_common_config?.media_ustreamer_request_config?.video_playback_ustreamer_config
  if (!ustreamerConfig) throw new Error('youtube: ustreamer configuration is missing')
  return {
    videoId,
    isLive,
    durationMs: Number(info.basic_info?.duration ?? 0) * 1_000,
    manifest,
    streamingUrl: url.toString(),
    ustreamerConfig,
    formats: rawFormats.map((format) => buildSabrFormat(format as never)),
    playbackFormats,
    storyboards: parseStoryboards((raw as {
      storyboards?: { playerStoryboardSpecRenderer?: { spec?: string } }
    }).storyboards?.playerStoryboardSpecRenderer?.spec),
    captions: parseCaptionTracks(info.captions),
    endScreen: parseEndScreen(raw),
    playerParams,
    clientInfo: {
      clientName: Number((Constants.CLIENT_NAME_IDS as Record<string, string>)[context.client.clientName]),
      clientVersion: context.client.clientVersion,
      osName: context.client.osName,
      osVersion: context.client.osVersion,
    },
    mint: () => mintPoToken(mintIdentifier),
    recoverMint: () => recoverPoTokenSession(),
  }
}

