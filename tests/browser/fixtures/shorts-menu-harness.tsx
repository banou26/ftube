import type { AudioTrack, CaptionPick, CaptionTrack, TranslationLanguage } from '../../../src/frame/protocol'
import type { ShortsMediaState } from '../../../src/player/shorts-menu'
import type { SourceApi } from '../../../src/sources/types'

import { createSchema, createYoga } from 'graphql-yoga'
import { render } from 'preact'
import { useState } from 'preact/hooks'
import { Client, fetchExchange, Provider } from 'urql'

import { Toasts } from '../../../src/components/ui/toast'
import { createCache } from '../../../src/graphql'
import { ShortsDescriptionPanel, ShortsOptionsMenu } from '../../../src/player/shorts-menu'
import ShortsPage from '../../../src/routes/shorts'
import { DEFAULT_SETTINGS, updateSettings } from '../../../src/settings'
import { resolvers } from '../../../src/worker/resolvers'
import typeDefs from '../../../src/worker/schema.gql?raw'

const AVATAR_SVG = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="16" fill="#2563eb"/></svg>',
)

const CAPTION_TRACKS: CaptionTrack[] = [
  { id: 'en', label: 'English', languageCode: 'en', auto: false, translatable: true },
  { id: 'ja', label: 'Japanese (auto)', languageCode: 'ja', auto: true, translatable: true },
]

const TRANSLATION_LANGUAGES: TranslationLanguage[] = [
  { languageCode: 'es', label: 'Spanish' },
  { languageCode: 'fr', label: 'French' },
]

const AUDIO_TRACKS: AudioTrack[] = [
  { id: 'orig', label: 'English (US) original', language: 'en-US', original: true, autoDubbed: false, hasDrc: false },
  { id: 'fr', label: 'French', language: 'fr', original: false, autoDubbed: true, hasDrc: false },
]

const TrackControlsWidget = ({
  onCaptionChange,
  onAudioChange,
}: {
  onCaptionChange: (choice: CaptionPick | undefined) => void
  onAudioChange: (trackId: string) => void
}) => {
  const [caption, setCaption] = useState<CaptionPick | undefined>(undefined)
  const [audioTrackId, setAudioTrackId] = useState('orig')
  const [rate, setRate] = useState(1)
  const [ambientMode, setAmbientMode] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [dubbedDescOpen, setDubbedDescOpen] = useState(false)

  const media: ShortsMediaState = {
    captionTracks: CAPTION_TRACKS,
    translationLanguages: TRANSLATION_LANGUAGES,
    caption,
    onCaption: (choice: CaptionPick | undefined) => {
      setCaption(choice)
      onCaptionChange(choice)
    },
    audioTracks: AUDIO_TRACKS,
    audioTrackId,
    onAudioTrack: (trackId: string) => {
      setAudioTrackId(trackId)
      onAudioChange(trackId)
    },
    playbackRate: rate,
    onPlaybackRate: (nextRate: number) => setRate(nextRate),
    ambientMode,
    onAmbientMode: () => setAmbientMode(value => !value),
    fullscreen,
    onFullscreen: () => setFullscreen(value => !value),
  }

  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' }}>
      <ShortsOptionsMenu
        label='Track controls harness'
        media={media}
        trigger={<button type='button'>Track controls harness</button>}
      />
      <button type='button' onClick={() => setDubbedDescOpen(true)}>
        Open auto-dubbed description
      </button>
      {dubbedDescOpen
        ? (
          <ShortsDescriptionPanel
            videoId='short-1'
            title='Auto-dubbed Sample'
            channel={{ id: 'UClewis', name: 'Coding with Lewis', avatar: AVATAR_SVG, isVerified: true }}
            likeCountText='69K'
            shortViewCountText='3M views'
            publishedDateText='Oct 23, 2026'
            description='Multilingual track test.'
            descriptionRuns={[{ text: 'Multilingual track test.' }]}
            hasAutoDubbed
            onClose={() => setDubbedDescOpen(false)}
          />
        )
        : undefined}
    </div>
  )
}

export const mountShortsMenuHarness = (mode: 'full' | 'tracks' = 'full') => {
  localStorage.clear()
  updateSettings({ ...DEFAULT_SETTINGS, ambientMode: true, playbackRate: 1 })
  history.replaceState(null, '', '/shorts/short-1')

  const app = document.getElementById('app')
  if (app) {
    render(null, app)
    app.hidden = true
  }
  document.documentElement.style.fontSize = '62.5%'
  document.documentElement.style.setProperty('--header-height', '5.6rem')
  document.documentElement.style.setProperty('--z-popup', '2200')
  document.documentElement.style.setProperty('--z-dialog', '2300')
  document.documentElement.style.setProperty('--z-toast', '2400')
  document.body.style.margin = '0'
  document.querySelectorAll('[data-shorts-menu-harness]').forEach(node => node.remove())
  const host = document.createElement('div')
  host.setAttribute('data-shorts-menu-harness', 'true')
  if (mode === 'full') host.style.paddingTop = 'var(--header-height)'
  document.body.append(host)

  const addedToPlaylist: { playlistId: string, videoIds: string[] }[] = []
  const pickedCaptions: (CaptionPick | undefined)[] = []
  const pickedAudio: string[] = []
  const subscriptionMutations: { kind: 'subscribe' | 'level', channelId: string, value: boolean | string }[] = []
  const channelState = new Map<string, {
    id: string
    name: string
    avatar: string
    handle: string
    isSubscribed: boolean
    notificationLevel: 'ALL' | 'PERSONALIZED' | 'NONE' | null
    isVerified: boolean
    isVerifiedArtist: boolean
  }>([
    ['UClewis', {
      id: 'UClewis',
      name: 'RTBF iXPé',
      avatar: AVATAR_SVG,
      handle: '@RTBFiXP%C3%A9',
      isSubscribed: false,
      notificationLevel: null,
      isVerified: true,
      isVerifiedArtist: false,
    }],
    ['UCtwo', {
      id: 'UCtwo',
      name: 'Second Channel',
      avatar: AVATAR_SVG,
      handle: '@second',
      isSubscribed: true,
      notificationLevel: 'PERSONALIZED',
      isVerified: false,
      isVerifiedArtist: false,
    }],
    ['UCthree', {
      id: 'UCthree',
      name: 'Third Channel',
      avatar: AVATAR_SVG,
      handle: '@third',
      isSubscribed: false,
      notificationLevel: null,
      isVerified: false,
      isVerifiedArtist: false,
    }],
  ])

  const source = {
    session: async () => ({
      signedIn: true,
      name: 'Viewer',
      avatar: AVATAR_SVG,
      handle: '@viewer',
      accounts: [],
    }),
    shorts: async () => ({
      items: [
        { id: 'short-1', poster: null, title: 'The AI Model Iceberg' },
        { id: 'short-2', poster: null, title: 'Second Short' },
        { id: 'short-3', poster: null, title: 'Third Short' },
      ],
    }),
    watch: async (id: string) => {
      if (id === 'short-3') {
        return {
          id: 'short-3',
          title: 'Third Short',
          viewCountText: '85K views',
          shortViewCountText: '85K views',
          publishedDateText: 'Nov 10, 2026',
          relativeDateText: '2 weeks ago',
          hashtags: ['#three'],
          likeCountText: '2.9K',
          commentCountText: '41',
          description: 'Third short description.',
          descriptionRuns: [{ text: 'Third short description.' }],
          channel: { ...channelState.get('UCthree')! },
          chapters: [],
          heatmap: [],
          cardTeasers: [],
        }
      }
      if (id === 'short-2') {
        return {
          id: 'short-2',
          title: 'Second Short',
          viewCountText: '120K views',
          shortViewCountText: '120K views',
          publishedDateText: 'Nov 2, 2026',
          relativeDateText: '2 weeks ago',
          hashtags: ['#demo'],
          likeCountText: '4.1K',
          commentCountText: '82',
          description: 'Second short description.',
          descriptionRuns: [{ text: 'Second short description.' }],
          channel: { ...channelState.get('UCtwo')! },
          chapters: [],
          heatmap: [],
          cardTeasers: [],
        }
      }
      return {
        id: 'short-1',
        title: 'The AI Model Iceberg',
        viewCountText: '3,012,450 views',
        shortViewCountText: '3M views',
        publishedDateText: 'Oct 23, 2026',
        relativeDateText: '1 month ago',
        hashtags: ['#ai', '#ml'],
        likeCountText: '69K',
        commentCountText: '447',
        description: 'Deep dive into modern AI models.',
        descriptionRuns: [{ text: 'Deep dive into modern AI models.' }],
        channel: { ...channelState.get('UClewis')! },
        chapters: [],
        heatmap: [],
        cardTeasers: [],
      }
    },
    playlists: async () => ({
      items: [{ id: 'PLfav', title: 'Favorites', videoCountText: '4 videos' }],
    }),
    addToPlaylist: async (playlistId: string, videoIds: string[]) => {
      addedToPlaylist.push({ playlistId, videoIds })
      return { id: playlistId, title: 'Favorites' }
    },
    setSubscribed: async (channelId: string, subscribed: boolean) => {
      subscriptionMutations.push({ kind: 'subscribe', channelId, value: subscribed })
      const entry = channelState.get(channelId)
      if (entry) {
        entry.isSubscribed = subscribed
        if (!subscribed) entry.notificationLevel = null
        else if (!entry.notificationLevel) entry.notificationLevel = 'PERSONALIZED'
        return { ...entry }
      }
      return {
        id: channelId,
        name: channelId,
        avatar: AVATAR_SVG,
        isSubscribed: subscribed,
        notificationLevel: subscribed ? 'PERSONALIZED' : null,
      }
    },
    setNotificationLevel: async (channelId: string, level: 'ALL' | 'PERSONALIZED' | 'NONE') => {
      subscriptionMutations.push({ kind: 'level', channelId, value: level })
      const entry = channelState.get(channelId)
      if (entry) {
        entry.notificationLevel = level
        return { ...entry }
      }
      return {
        id: channelId,
        name: channelId,
        avatar: AVATAR_SVG,
        isSubscribed: true,
        notificationLevel: level,
      }
    },
    subscribedChannels: async () => [],
    comments: async (videoId: string) => ({
      items: [
        {
          id: `comment-${videoId}-1`,
          author: {
            id: `UC-commenter-${videoId}`,
            name: videoId === 'short-1' ? 'VeryLongHandleAuthorNameThatMustTruncateGracefullyOnShorts' : `Commenter ${videoId}`,
            handle: `@${videoId}`,
          },
          text: `Comment on ${videoId}`,
          runs: [{ text: `Comment on ${videoId}` }],
          publishedText: '2 months ago',
          likeCountText: '12',
          replyCount: videoId === 'short-1' ? 1 : 0,
          replies: videoId === 'short-1'
            ? [
                {
                  id: `reply-${videoId}-depth1`,
                  author: { id: 'UC-r1', name: 'Depth One User', handle: '@r1' },
                  text: 'Depth 1 reply text.',
                  runs: [{ text: 'Depth 1 reply text.' }],
                  publishedText: '1 month ago',
                  likeCountText: '4',
                  replyCount: 1,
                  replies: [
                    {
                      id: `reply-${videoId}-depth2`,
                      author: { id: 'UC-r2', name: 'Depth Two User', handle: '@r2' },
                      text: 'Depth 2 reply with replyCount zero bug check.',
                      runs: [{ text: 'Depth 2 reply with replyCount zero bug check.' }],
                      publishedText: '3 weeks ago',
                      likeCountText: '2',
                      replyCount: 0,
                      replies: [
                        {
                          id: `reply-${videoId}-depth3`,
                          author: { id: 'UC-r3', name: 'Depth Three User', handle: '@r3' },
                          text: 'Depth 3 reply must stay wide and readable.',
                          runs: [{ text: 'Depth 3 reply must stay wide and readable.' }],
                          publishedText: '2 weeks ago',
                          likeCountText: '1',
                          replyCount: 1,
                          repliesCursor: 'cursor-depth-4',
                        },
                      ],
                    },
                  ],
                },
              ]
            : [],
        },
        ...(videoId === 'short-1'
          ? Array.from({ length: 12 }, (_, index) => ({
            id: `comment-${videoId}-extra-${index}`,
            author: { id: `UC-extra-${index}`, name: `Viewer ${index + 2}`, handle: `@viewer${index}` },
            text: `Extra comment row ${index + 2} to fill the scrollable drawer.`,
            runs: [{ text: `Extra comment row ${index + 2} to fill the scrollable drawer.` }],
            publishedText: `${index + 1}h ago`,
            likeCountText: String(index + 1),
            replyCount: 0,
          }))
          : []),
      ],
    }),
    commentReplies: async (cursor: string) => (cursor === 'cursor-depth-4'
      ? {
          items: [
            {
              id: 'reply-short-1-depth4',
              author: { id: 'UC-r4', name: 'Depth Four User', handle: '@r4' },
              text: 'Depth 4 deepest reply shares depth 2 rail.',
              runs: [{ text: 'Depth 4 deepest reply shares depth 2 rail.' }],
              publishedText: '1 day ago',
              likeCountText: '1',
              replyCount: 0,
            },
          ],
          cursor: null,
        }
      : { items: [], cursor: null }),
  } as unknown as SourceApi

  const yoga = createYoga<{ source: SourceApi }>({
    graphqlEndpoint: '/graphql',
    maskedErrors: false,
    schema: createSchema({ typeDefs, resolvers }),
  })
  const client = new Client({
    url: 'http://shorts-menu-harness.local/graphql',
    exchanges: [createCache(), fetchExchange],
    fetch: async (input, init) => yoga.handleRequest(new Request(input, init), { source }),
    preferGetMethod: false,
  })

  render(
    <Provider value={client}>
      {mode === 'full'
        ? <ShortsPage />
        : (
          <div style={{ padding: '24px' }}>
            <TrackControlsWidget
              onCaptionChange={(choice: CaptionPick | undefined) => pickedCaptions.push(choice)}
              onAudioChange={(trackId: string) => pickedAudio.push(trackId)}
            />
          </div>
        )}
      <Toasts />
    </Provider>,
    host,
  )

  return {
    addedToPlaylist: () => [...addedToPlaylist],
    pickedCaptions: () => [...pickedCaptions],
    pickedAudio: () => [...pickedAudio],
    subscriptionMutations: () => [...subscriptionMutations],
  }
}
