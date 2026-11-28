import type { SourceApi } from '../../../src/sources/types'
import type { PlayerState } from '../../../src/player/use-player-state'

import { createSchema, createYoga } from 'graphql-yoga'
import { render } from 'preact'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { Client, fetchExchange, Provider } from 'urql'

import { createCache } from '../../../src/graphql'
import { PlayerControls } from '../../../src/player/controls'
import { TimedCommentsOverlay } from '../../../src/player/timed-comments-overlay'
import { updateSettings, useSetting } from '../../../src/settings'
import { resolvers } from '../../../src/worker/resolvers'
import typeDefs from '../../../src/worker/schema.gql?raw'

export type TimedCommentsScenario = {
  videoId?: string
  duration?: number
  isLive?: boolean
  commentsHidden?: boolean
  initialTime?: number
}

declare global {
  interface Window {
    __timedCommentsHarness?: {
      advanceTime: (nextTime: number) => void
      seekTo: (nextTime: number) => void
      setRate: (rate: number) => void
      setScenario: (next: TimedCommentsScenario) => void
      currentTime: () => number
      paused: () => boolean
      requestedVideos: () => string[]
    }
  }
}

const AVATAR_SVG = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="#3ea6ff"/></svg>',
)

const makeComment = ({
  id,
  text,
  runs,
  likeCountText,
  authorName = 'Viewer',
}: {
  id: string
  text: string
  runs: { text: string, videoId?: string | null, startSeconds?: number | null }[]
  likeCountText?: string
  authorName?: string
}) => ({
  __typename: 'Comment',
  id,
  text,
  runs: runs.map((run) => ({
    text: run.text,
    url: run.startSeconds !== undefined && run.startSeconds !== null ? `/watch?v=${run.videoId ?? 'v1'}&t=${run.startSeconds}s` : null,
    videoId: run.videoId ?? null,
    startSeconds: run.startSeconds ?? null,
    browseId: null,
  })),
  publishedText: '1 hour ago',
  likeCountText: likeCountText ?? null,
  replyCount: 0,
  repliesCursor: null,
  replies: [],
  actionsToken: null,
  isPinned: false,
  pinnedText: null,
  isHearted: false,
  heartAvatar: null,
  heartTooltip: null,
  isCreator: false,
  isMember: false,
  isLiked: false,
  isDisliked: false,
  author: {
    __typename: 'Author',
    id: `UC-${id}`,
    name: authorName,
    avatar: AVATAR_SVG,
    isVerified: false,
    isVerifiedArtist: false,
  },
})

const Harness = ({
  initialScenario,
  onReady,
}: {
  initialScenario: TimedCommentsScenario
  onReady: (api: { setScenario: (next: TimedCommentsScenario) => void }) => void
}) => {
  const timedComments = useSetting('timedComments')
  const [scenario, setScenario] = useState<TimedCommentsScenario>(initialScenario)
  const videoId = scenario.videoId ?? 'video-1'
  const duration = scenario.duration ?? 200
  const isLive = scenario.isLive ?? false
  const commentsHidden = scenario.commentsHidden ?? false

  const rootRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const [currentTime, setCurrentTime] = useState(scenario.initialTime ?? 0)
  const [paused, setPaused] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [seeking, setSeeking] = useState(false)
  const clockStateRef = useRef({
    time: scenario.initialTime ?? 0,
    rate: 1,
    seeking: false,
    paused: false,
    duration,
  })
  clockStateRef.current.duration = duration

  const applyScenario = useCallback((next: TimedCommentsScenario) => {
    const start = next.initialTime ?? 0
    clockStateRef.current.time = start
    clockStateRef.current.seeking = false
    setCurrentTime(start)
    setSeeking(false)
    setScenario(next)
  }, [])

  useEffect(() => {
    onReady({ setScenario: applyScenario })
  }, [applyScenario, onReady])

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    Object.defineProperty(el, 'duration', { configurable: true, get: () => clockStateRef.current.duration })
    Object.defineProperty(el, 'seeking', { configurable: true, get: () => clockStateRef.current.seeking })
    Object.defineProperty(el, 'paused', { configurable: true, get: () => clockStateRef.current.paused })
    Object.defineProperty(el, 'playbackRate', {
      configurable: true,
      get: () => clockStateRef.current.rate,
      set: (value: number) => {
        clockStateRef.current.rate = value
        setPlaybackRate(value)
      },
    })
    Object.defineProperty(el, 'currentTime', {
      configurable: true,
      get: () => clockStateRef.current.time,
      set: (value: number) => {
        const clamped = Math.max(0, Math.min(clockStateRef.current.duration, value))
        clockStateRef.current.time = clamped
        setCurrentTime(clamped)
      },
    })
    el.play = async () => {
      clockStateRef.current.paused = false
      setPaused(false)
    }
    el.pause = () => {
      clockStateRef.current.paused = true
      setPaused(true)
    }
    setVideo(el)
  }, [])

  const state: PlayerState = {
    paused,
    ended: false,
    currentTime,
    duration,
    buffered: duration,
    volume: 1,
    muted: true,
    playbackRate,
    buffering: false,
    seeking,
  }

  return (
    <div
      ref={rootRef}
      data-timed-comments-harness={videoId}
      data-player-root=''
      data-player-surface=''
      data-paused={String(paused)}
      style={{
        position: 'relative',
        width: '800px',
        height: '450px',
        background: '#000',
        containerType: 'inline-size',
        containerName: 'player',
        overflow: 'hidden',
      }}
    >
      <video ref={videoRef} width={800} height={450} muted style={{ width: '100%', height: '100%', display: 'block' }} />
      {video
        ? (
          <TimedCommentsOverlay
            video={video}
            videoId={videoId}
            duration={duration}
            enabled={timedComments}
            isLive={isLive}
            docked={false}
            commentsHidden={commentsHidden}
          />
        )
        : undefined}
      {video
        ? (
          <PlayerControls
            video={video}
            player={undefined}
            state={state}
            heights={[1080, 720]}
            storyboards={[]}
            quality='auto'
            onQuality={() => {}}
            captionTracks={[]}
            caption={undefined}
            onCaption={() => {}}
            onToggleCaption={() => {}}
            theater='default'
            onTheater={() => {}}
            visible
            isLive={isLive}
            timedComments={timedComments}
            onTimedComments={() => updateSettings({ timedComments: !timedComments })}
          />
        )
        : undefined}
    </div>
  )
}

export const mountTimedCommentsHarness = (initialScenario: TimedCommentsScenario = {}) => {
  document.documentElement.dataset.engine = 'ready'
  document.querySelector('[data-timed-comments-host]')?.remove()

  const host = document.createElement('div')
  host.setAttribute('data-timed-comments-host', '')
  host.style.cssText = 'position: fixed; inset: 0; z-index: 2150; background: var(--bg-base); overflow: auto; padding: 2.4rem'
  document.body.prepend(host)

  const requestedVideos: string[] = []
  let setScenarioImpl: ((next: TimedCommentsScenario) => void) | undefined

  const source = {
    comments: async (videoId: string) => {
      requestedVideos.push(videoId)
      if (videoId === 'video-disabled') {
        return { items: [], cursor: null, disabled: true, countText: null, customEmojis: [] }
      }
      if (videoId === 'video-empty') {
        return { items: [], cursor: null, disabled: false, countText: '0 Comments', customEmojis: [] }
      }
      if (videoId === 'video-error') {
        throw new Error('Comments unavailable')
      }
      if (videoId === 'video-2') {
        return {
          items: [
            makeComment({
              id: 'v2-c1',
              text: '0:10 Fresh cue on video two',
              likeCountText: '25',
              runs: [
                { text: '0:10', videoId: 'video-2', startSeconds: 10 },
                { text: ' Fresh cue on video two' },
              ],
            }),
          ],
          cursor: null,
          disabled: false,
          countText: '1 Comment',
          customEmojis: [],
        }
      }
      return {
        items: [
          makeComment({
            id: 'c-ts-only',
            text: '0:15',
            likeCountText: '999',
            runs: [{ text: '0:15', videoId: 'video-1', startSeconds: 15 }],
          }),
          makeComment({
            id: 'c-other-video',
            text: '0:20 Wrong target video',
            likeCountText: '500',
            runs: [
              { text: '0:20', videoId: 'other-video', startSeconds: 20 },
              { text: ' Wrong target video' },
            ],
          }),
          makeComment({
            id: 'c-out-of-range',
            text: '8:20 Past video duration',
            likeCountText: '800',
            runs: [
              { text: '8:20', videoId: 'video-1', startSeconds: 500 },
              { text: ' Past video duration' },
            ],
          }),
          makeComment({
            id: 'c-first-valid',
            text: '0:30 intro 0:42 Guitar riff hits',
            likeCountText: '50',
            runs: [
              { text: '0:30', videoId: 'other-video', startSeconds: 30 },
              { text: ' intro ' },
              { text: '0:42', videoId: 'video-1', startSeconds: 42 },
              { text: ' Guitar riff hits ' },
              { text: '1:50', videoId: 'video-1', startSeconds: 110 },
            ],
          }),
          makeComment({
            id: 'c-shared-low',
            text: '1:00 Lower likes comment',
            likeCountText: '120',
            runs: [
              { text: '1:00', videoId: 'video-1', startSeconds: 60 },
              { text: ' Lower likes comment' },
            ],
          }),
          makeComment({
            id: 'c-shared-high',
            text: '1:00 Top liked reaction!',
            likeCountText: '1.5K',
            runs: [
              { text: '1:00', videoId: 'video-1', startSeconds: 60 },
              { text: ' Top liked reaction!' },
            ],
          }),
          makeComment({
            id: 'c-mid',
            text: '2:00 Intermediate cue',
            likeCountText: '20',
            runs: [
              { text: '2:00', videoId: 'video-1', startSeconds: 120 },
              { text: ' Intermediate cue' },
            ],
          }),
          makeComment({
            id: 'c-late',
            text: '2:30 Finale note',
            likeCountText: '30',
            runs: [
              { text: '2:30', videoId: 'video-1', startSeconds: 150 },
              { text: ' Finale note' },
            ],
          }),
        ],
        cursor: 'page-2-token',
        disabled: false,
        countText: '8 Comments',
        customEmojis: [],
      }
    },
  } as unknown as SourceApi

  const yoga = createYoga<{ source: SourceApi }>({
    graphqlEndpoint: '/graphql',
    maskedErrors: false,
    schema: createSchema({ typeDefs, resolvers }),
  })
  const client = new Client({
    url: 'http://timed-comments-harness.local/graphql',
    exchanges: [createCache(), fetchExchange],
    fetch: async (input, init) => yoga.handleRequest(new Request(input, init), { source }),
  })

  window.__timedCommentsHarness = {
    advanceTime: (nextTime: number) => {
      const video = document.querySelector<HTMLVideoElement>('[data-timed-comments-harness] video')
      if (!video) return
      video.currentTime = nextTime
      video.dispatchEvent(new Event('timeupdate'))
    },
    seekTo: (nextTime: number) => {
      const video = document.querySelector<HTMLVideoElement>('[data-timed-comments-harness] video')
      if (!video) return
      video.dispatchEvent(new Event('seeking'))
      video.currentTime = nextTime
      video.dispatchEvent(new Event('seeked'))
      video.dispatchEvent(new Event('timeupdate'))
    },
    setRate: (rate: number) => {
      const video = document.querySelector<HTMLVideoElement>('[data-timed-comments-harness] video')
      if (!video) return
      video.playbackRate = rate
    },
    setScenario: (next: TimedCommentsScenario) => {
      setScenarioImpl?.(next)
    },
    currentTime: () => document.querySelector<HTMLVideoElement>('[data-timed-comments-harness] video')?.currentTime ?? 0,
    paused: () => document.querySelector<HTMLVideoElement>('[data-timed-comments-harness] video')?.paused ?? true,
    requestedVideos: () => [...requestedVideos],
  }

  render(
    <Provider value={client}>
      <Harness
        initialScenario={initialScenario}
        onReady={(api: { setScenario: (next: TimedCommentsScenario) => void }) => {
          setScenarioImpl = api.setScenario
        }}
      />
    </Provider>,
    host,
  )
}
