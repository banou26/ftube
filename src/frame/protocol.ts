import type { Exhaustive, SourceApi } from '../sources/types'
import type { TransportResponse } from '../engine/protocol'

import type { CaptionTrack, TranslationLanguage } from './captions'
import type { EndScreenElement } from './end-screen'
import type { Storyboard } from './storyboard'

import { SOURCE_METHODS } from '../sources/types'

export type { CaptionPick, CaptionTrack, TranslationLanguage } from './captions'
export type { EndScreenElement } from './end-screen'
export type { AudioTrack } from './formats'
export type { Storyboard, StoryboardFrame } from './storyboard'

// the terminal marker the players match on, declared here because the app realm has to recognize it too
export const LIVE_UNSUPPORTED = 'youtube: live streams are not playable in this client yet'
/**
 * Leads the message every segment request of a playback fails with once its stream was refused twice in a row: the
 * session that replaced a refused one was refused too. Not a `PlaybackRefusal`: the watch page said the video plays.
 */
export const STREAM_REFUSED = 'youtube: stream refused'

/**
 * What youtube.com shows in place of the player when upstream refuses a video, in its own words: the title and the
 * line under it, the channel's avatar over the video's thumbnail for a members-only video, and whether it offers
 * Sign in, and at its large size as on the age gate. `final` marks a refusal that asking again cannot change, such as a deleted, members-only, age-restricted
 * or private video, which the players show at once rather than retrying.
 */
export type PlaybackRefusal = {
  title: string
  description?: string
  thumbnail?: string
  avatar?: string
  signIn?: boolean
  largeSignIn?: boolean
  final: boolean
}

/** Leads the message `openPlayback` rejects with when upstream refuses the video, followed by its `PlaybackRefusal` as JSON. */
export const PLAYBACK_REFUSED = 'youtube: refused: '

/** The refusal an `openPlayback` rejection carries, undefined for any other failure. */
export const playbackRefusal = (error: unknown): PlaybackRefusal | undefined => {
  if (!(error instanceof Error) || !error.message.startsWith(PLAYBACK_REFUSED)) return undefined
  try {
    return JSON.parse(error.message.slice(PLAYBACK_REFUSED.length)) as PlaybackRefusal
  } catch {
    return undefined
  }
}

export type PlaybackFormat = {
  key: string
  itag: number
  mimeType: string
  bitrate: number
  width?: number
  height?: number
  qualityLabel?: string
  audioTrackId?: string
  audioTrackName?: string
  isOriginal?: boolean
  isAutoDubbed?: boolean
  isDrc?: boolean
  language?: string
  // optional rather than zero-filled: a `{0,0}` range is a REAL range meaning "one byte"
  initRange?: { start: number, end: number }
  indexRange?: { start: number, end: number }
  // live only: one segment's worth, and sequence maps onto time through it
  targetDurationMs?: number
}

// a format mimeType's codecs parameter, '' when it names none
export const codecsOf = (mimeType: string) => mimeType.match(/codecs="([^"]+)"/)?.[1] ?? ''

export type PlaybackSnapshot = {
  currentTimeMs: number
  playbackRate: number
  bandwidthEstimate: number
  viewportWidth: number
  viewportHeight: number
}

export type PlaybackSession = {
  id: string
  durationMs: number
  manifest: string
  videoFormats: PlaybackFormat[]
  audioFormats: PlaybackFormat[]
  selectedVideoKey: string
  selectedAudioKey: string
  storyboards: Storyboard[]
  // always empty for live: Shaka refuses a side-loaded text track when the presentation duration is infinite (CANNOT_ADD_EXTERNAL_TEXT_TO_LIVE_STREAM)
  captionTracks: CaptionTrack[]
  translationLanguages: TranslationLanguage[]
  endScreen: EndScreenElement[]
  /** The card params the watch page was read with, whose answer carries no end screen; unset for a plain read. */
  playerParams?: string
  isLive: boolean
}

export type SegmentRequest = {
  requestId: string
  sessionId: string
  generation: number
  track: 'audio' | 'video'
  kind: 'init' | 'media'
  formatKey?: string
  range?: { start: number, end: number }
  startTimeMs: number
  // live only: the SABR sequence the manifest named, and the only address the session can resolve exactly; absent for VOD, which addresses by byte range
  sequenceNumber?: number
  snapshot: PlaybackSnapshot
}

type SegmentMetadata = {
  generation: number
  track: 'audio' | 'video'
  kind: 'init' | 'media'
  formatKey: string
  mimeType: string
  sequenceNumber?: number
  startMs?: number
  durationMs?: number
  elapsedMs: number
}

export type SegmentEnvelope = SegmentMetadata & ({
  end: true
  data?: never
} | {
  end?: false
  data: ArrayBuffer
})

export type OpenPlaybackOptions = {
  /** Uses the faster `/player` path when a warmed player is ready and trims the VOD manifest to the selected pair. */
  preview?: boolean
  /** Prewarms the opening dual-track SABR request at t = 0 before returning. Defaults to true for VOD. */
  prewarm?: boolean
  /** Physical box size for `object-fit: contain` (Shorts): picks the smallest tier covering either dimension. */
  cover?: { width: number, height: number }
  /** Exact height pinned by user settings so playback opens directly on it without a post-load switch. */
  pinnedHeight?: number
}

/** Selectable MP4 video or M4A/WebM audio stream entry returned by `downloadFormats`. */
export type DownloadFormatOption = {
  key: string
  itag: number
  kind: 'video' | 'audio'
  container: 'mp4' | 'm4a' | 'webm'
  mimeType: string
  codec: string
  qualityLabel: string
  height?: number
  bitrate: number
  estimatedBytes?: number
  audioTrackId?: string
  audioTrackName?: string
  isOriginal?: boolean
  isAutoDubbed?: boolean
}

/** Available downloadable streams for a video, or `isLive: true` when still broadcasting. */
export type DownloadFormatsResult = {
  videoId: string
  durationMs: number
  isLive: boolean
  videoFormats: DownloadFormatOption[]
  audioFormats: DownloadFormatOption[]
}

/** Stream selection passed to `startDownload` in the engine frame. */
export type StartDownloadOptions = {
  videoId: string
  mode: 'video' | 'audio'
  videoKey?: string
  audioKey: string
  startMs?: number
  endMs?: number
}

/** Handle and MIME metadata returned when a SABR download session starts. */
export type StartDownloadResult = {
  downloadId: string
  estimatedBytes?: number
  container: 'mp4' | 'm4a' | 'webm'
  mimeType: string
}

/** Batch of transferable stream buffers and progress counters returned by `pollDownload`. */
export type DownloadPollResult = {
  videoChunks: ArrayBuffer[]
  audioChunks: ArrayBuffer[]
  loadedBytes: number
  totalBytes?: number
  done: boolean
  error?: string
}

export type FrameApi = SourceApi & {
  prefetchPlayback(videoId: string, playerParams?: string): Promise<void>
  warmPlayback(): Promise<void>
  /**
   * Opens a playback of the video; a card's hover preview, or a click on the card, passes its inline playback params
   * as `playerParams`.
   */
  openPlayback(
    videoId: string,
    maxHeight?: number,
    playerParams?: string,
    stableVolume?: boolean,
    options?: boolean | OpenPlaybackOptions,
  ): Promise<PlaybackSession>
  /** The end screen of the video's plain watch page, which the answer to a card's params leaves out. */
  endScreen(videoId: string): Promise<EndScreenElement[]>
  requestSegment(request: SegmentRequest): Promise<SegmentEnvelope>
  liveManifest(sessionId: string): Promise<string>
  captionCues(sessionId: string, trackId: string, translateTo?: string): Promise<string>
  cancelSegment(sessionId: string, requestId: string): Promise<void>
  selectVideoFormat(sessionId: string, formatKey: string): Promise<void>
  selectAudioFormat(sessionId: string, formatKey: string): Promise<void>
  closePlayback(sessionId: string): Promise<void>
  downloadFormats(videoId: string): Promise<DownloadFormatsResult>
  startDownload(options: StartDownloadOptions): Promise<StartDownloadResult>
  pollDownload(downloadId: string): Promise<DownloadPollResult>
  cancelDownload(downloadId: string): Promise<void>
  resetIdentity(): Promise<void>
}

export const FRAME_METHODS = [
  ...SOURCE_METHODS,
  'prefetchPlayback',
  'warmPlayback',
  'openPlayback',
  'endScreen',
  'requestSegment',
  'liveManifest',
  'captionCues',
  'cancelSegment',
  'selectVideoFormat',
  'selectAudioFormat',
  'closePlayback',
  'downloadFormats',
  'startDownload',
  'pollDownload',
  'cancelDownload',
  'resetIdentity',
] as const satisfies readonly (keyof FrameApi)[]

export type FrameMethod = (typeof FRAME_METHODS)[number]

export type FrameMethodsAreExhaustive = Exhaustive<Exclude<keyof FrameApi, FrameMethod>>

const frameMethods: ReadonlySet<string> = new Set(FRAME_METHODS)

export const isFrameMethod = (value: unknown): value is FrameMethod =>
  typeof value === 'string' && frameMethods.has(value)

export type FrameRequest = {
  [Method in keyof FrameApi]: {
    id: number
    method: Method
    args: Parameters<FrameApi[Method]>
  }
}[keyof FrameApi]

export type FrameResponse = {
  id: number
  result: unknown
  error?: never
} | {
  id: number
  result?: never
  error: string
}

export type FrameProgress = {
  id: number
  progress: string
}

export type FrameEgressRequest = {
  type: 'fetch'
  id: number
  url: string
  options: {
    method?: string
    headers?: Record<string, string>
    body?: ArrayBuffer | null
    redirect?: 'follow' | 'manual'
  }
} | {
  type: 'cancel'
  id: number
}

export type FrameEgressResponse = {
  id: number
  response: TransportResponse
  error?: never
} | {
  id: number
  response?: never
  error: string
}
