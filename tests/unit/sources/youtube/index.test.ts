import { describe, expect, it } from 'vite-plus/test'

import { Innertube, Parser, YT, YTNodes } from 'youtubei.js'

import type { YoutubeClient } from '../../../../src/sources/youtube'

import { createYoutubeSource } from '../../../../src/sources/youtube'
import { CHANNEL_NOT_FOUND, CHANNEL_UNAVAILABLE, PLAYLIST_UNAVAILABLE, SOURCE_CURSOR_ARGUMENT, SOURCE_REPLAY } from '../../../../src/sources/types'
import { accountsListAnswer, BRAND_PAGE_ID, twoChannels } from '../../fixtures/accounts-list'

type FakeFeed = {
  videos: { video_id: string, title: { text: string } }[]
  memo: Map<string, unknown[]>
  has_continuation: boolean
  getContinuation(): Promise<FakeFeed>
}

type FakeSearch = {
  videos: unknown[]
  results: unknown[]
  refinements: string[]
  estimated_results: number
  has_continuation: boolean
  getContinuation(): Promise<FakeSearch>
}

type FakeCommand = { call(actions: unknown, args?: Record<string, unknown>): Promise<unknown> }

type FakeComments = {
  contents: {
    comment: {
      comment_id: string
      content: { text: string }
      like_command?: FakeCommand
      dislike_command?: FakeCommand
      unlike_command?: FakeCommand
      reply_command?: { dialog?: { reply_button?: { endpoint?: FakeCommand } } }
    }
  }[]
  header?: { count?: { text: string }, comments_count?: { text: string } }
  has_continuation: boolean
  getContinuation(): Promise<FakeComments>
}

type FakePlaylist = {
  info: { title: string, total_items: string }
  memo: Map<string, unknown[]>
  has_continuation: boolean
  getContinuation(): Promise<FakePlaylist>
}

type FakePlaylists = {
  playlists: unknown[]
  has_continuation: boolean
  getContinuation(): Promise<FakePlaylists>
}

const feed = (id: string, next?: () => Promise<FakeFeed>): FakeFeed => ({
  videos: [{ video_id: id, title: { text: id } }],
  memo: new Map<string, unknown[]>([['ShortsLockupView', [
    { on_tap_endpoint: { payload: { videoId: `short-${id}` } }, overlay_metadata: { primary_text: { text: `Short ${id}` } } },
  ]]]),
  has_continuation: Boolean(next),
  getContinuation: next ?? (() => Promise.reject(new Error('no continuation'))),
})

const search = (id: string, next?: () => Promise<FakeSearch>): FakeSearch => ({
  videos: [],
  results: [
    { video_id: id, title: { text: id } },
    { id: 'UCchannel', author: { id: 'UCchannel', name: 'A Channel' }, subscriber_count: { text: '1M subscribers' } },
  ],
  refinements: ['refined query'],
  estimated_results: 1234,
  has_continuation: Boolean(next),
  getContinuation: next ?? (() => Promise.reject(new Error('no continuation'))),
})

const commentCalls: string[] = []

const commandFor = (id: string, name: string) => ({
  call: async (_actions: unknown, args?: Record<string, unknown>) => {
    commentCalls.push(args ? `${name}:${id}:${JSON.stringify(args)}` : `${name}:${id}`)
    return {}
  },
})

const comments = (id: string, next?: () => Promise<FakeComments>): FakeComments => ({
  contents: [{
    comment: {
      comment_id: id,
      content: { text: id },
      like_command: commandFor(id, 'like'),
      dislike_command: commandFor(id, 'dislike'),
      unlike_command: commandFor(id, 'unlike'),
      reply_command: { dialog: { reply_button: { endpoint: commandFor(id, 'reply') } } },
    },
  }],
  has_continuation: Boolean(next),
  getContinuation: next ?? (() => Promise.reject(new Error('no continuation'))),
})

// The playlist rows live in the memo rather than behind the `items` getter, which throws on any node outside its union
const playlist = (id: string, next?: () => Promise<FakePlaylist>): FakePlaylist => ({
  info: { title: 'My playlist', total_items: '2 videos' },
  memo: new Map<string, unknown[]>([['PlaylistVideo', [
    { id, title: { text: id }, index: { text: '1' }, set_video_id: `set-${id}` },
  ]]]),
  has_continuation: Boolean(next),
  getContinuation: next ?? (() => Promise.reject(new Error('no continuation'))),
})

const playlists = (id: string, next?: () => Promise<FakePlaylists>): FakePlaylists => ({
  playlists: [{ id, title: { text: id }, video_count: { text: '3 videos' } }],
  has_continuation: Boolean(next),
  getContinuation: next ?? (() => Promise.reject(new Error('no continuation'))),
})

type FakePosts = {
  videos: unknown[]
  posts: unknown[]
  has_continuation: boolean
  getContinuation(): Promise<FakePosts>
}

const posts = (id: string, next?: () => Promise<FakePosts>): FakePosts => ({
  videos: [],
  posts: [{ id, content: { text: `Body of ${id}` }, published: { text: '2 days ago' }, author: { id: 'UC1', name: 'Chan' } }],
  has_continuation: Boolean(next),
  getContinuation: next ?? (() => Promise.reject(new Error('no continuation'))),
})

type FakeNotifications = {
  contents: unknown[]
  getContinuation(): Promise<FakeNotifications>
}

const notifications = (id: string, next?: () => Promise<FakeNotifications>): FakeNotifications => ({
  contents: [{
    notification_id: id,
    short_message: { text: `Message ${id}` },
    sent_time: { text: '1 hour ago' },
    thumbnails: [{ url: 'avatar', width: 48 }],
    video_thumbnails: [{ url: 'still', width: 320 }],
    endpoint: { payload: { videoId: `v-${id}` } },
    record_click_endpoint: commandFor(id, 'recordClick'),
    read: false,
  }],
  getContinuation: next ?? (() => Promise.reject(new Error('no continuation'))),
})

type FakeCall = { endpoint: string, args?: Record<string, unknown> }

const createFakeClient = () => {
  const calls: string[] = []
  const nextChatTokens = new Map<string, string | null>([['nochat', null]])
  const chatQueues = new Map<string, (() => unknown)[]>()
  const parkedChatPolls = new Map<string, { resolve: (raw: unknown) => void, reject: (err: unknown) => void }>()
  const pollWaiters: ((continuation: string) => void)[] = []
  let panelHandler: ((args?: Record<string, unknown>) => unknown) | undefined
  let sendChatHandler: ((args?: Record<string, unknown>) => unknown) | undefined
  let pollActionHandler: ((endpoint: string, args?: Record<string, unknown>) => unknown) | undefined

  const setNextChatToken = (videoId: string, token: string | null) => {
    nextChatTokens.set(videoId, token)
  }

  const enqueueChatResponse = (token: string, raw: unknown) => {
    const responder = typeof raw === 'function' ? raw as () => unknown : () => raw
    const parked = parkedChatPolls.get(token)
    if (parked) {
      parkedChatPolls.delete(token)
      Promise.resolve().then(responder).then(parked.resolve, parked.reject)
      return
    }
    const queue = chatQueues.get(token) ?? []
    queue.push(responder)
    chatQueues.set(token, queue)
  }

  const parkChatToken = (token: string) => {
    enqueueChatResponse(token, () => new Promise((resolve, reject) => {
      parkedChatPolls.set(token, { resolve, reject })
    }))
  }

  const waitForChatPoll = async (token?: string) => {
    if (token && parkedChatPolls.has(token)) return
    await new Promise<void>((resolve) => {
      pollWaiters.push((hit) => {
        if (!token || hit === token) resolve()
      })
    })
  }

  const payloads: FakeCall[] = []
  const searchFilters: unknown[] = []
  return {
    calls,
    setNextChatToken,
    enqueueChatResponse,
    parkChatToken,
    waitForChatPoll,
    setPanelHandler: (fn: typeof panelHandler) => { panelHandler = fn },
    setSendChatHandler: (fn: typeof sendChatHandler) => { sendChatHandler = fn },
    setPollActionHandler: (fn: typeof pollActionHandler) => { pollActionHandler = fn },
    payloads,
    searchFilters,
    getHomeFeed: async () => feed('first', async () => feed('second')),
    search: async (_query: string, filters?: unknown) => {
      searchFilters.push(filters)
      return search('search', async () => search('search-2'))
    },
    getBasicInfo: async () => ({ basic_info: undefined }),
    // getWatchNextContinuation MUTATES this object and returns `this` rather than handing back a fresh page
    getShortsVideoInfo: async (id: string) => {
      const entry = (video: string, title?: string) => ({
        payload: {
          videoId: video,
          thumbnail: { thumbnails: [{ url: `${video}-sd.jpg`, width: 480, height: 854 }, { url: `${video}.jpg`, width: 1080, height: 1920 }] },
          ...(title ? { unserializedPrefetchData: { playerResponse: { videoDetails: { title } } } } : {}),
        },
      })
      let page = 0
      const sequence = {
        basic_info: { id, title: `Seed ${id}`, thumbnail: [{ url: 'seed-sd.jpg', width: 320 }, { url: 'seed.jpg', width: 1080 }] },
        watch_next_feed: [entry('reel-1', 'Prefetched title'), entry('reel-2')],
        wn_has_continuation: true,
        getWatchNextContinuation: async () => {
          page += 1
          sequence.watch_next_feed = [entry(`reel-page-${page}`)]
          sequence.wn_has_continuation = page < 2
          return sequence
        },
      }
      return sequence
    },
    getChannel: async () => {
      // Real methods rather than arrows: every upstream tab opener is a prototype method that reaches for `this.getTabByURL`
      const channel = {
        ...feed('channel'),
        metadata: { external_id: 'c', title: 'Channel' },
        has_videos: true,
        has_playlists: true,
        has_community: true,
        has_about: true,
        async getVideos(this: unknown) {
          if (this !== channel) throw new TypeError("Cannot read properties of undefined (reading 'getTabByURL')")
          return feed('channel-videos', async () => feed('channel-videos-2'))
        },
        async getPlaylists(this: unknown) {
          if (this !== channel) throw new TypeError("Cannot read properties of undefined (reading 'getTabByURL')")
          return feed('channel-playlists', async () => feed('channel-playlists-2'))
        },
        async getCommunity(this: unknown) {
          if (this !== channel) throw new TypeError("Cannot read properties of undefined (reading 'getTabByURL')")
          return posts('post-1', async () => posts('post-2'))
        },
        async getAbout(this: unknown) {
          if (this !== channel) throw new TypeError("Cannot read properties of undefined (reading 'getTabByURL')")
          return { metadata: { description: 'About us', country: 'Norway', view_count: '1,234 views', links: [{ title: { text: 'Site' }, link: { text: 'example.com' } }] } }
        },
      }
      return channel
    },
    getComments: async () => ({
      ...comments('top', async () => comments('next')),
      header: { count: { text: '2,461,151 Comments' }, comments_count: { text: '2.4M' } },
    }),
    getPostComments: async (postId: string, channelId: string, sortBy?: string) => {
      calls.push(`getPostComments:${postId}:${channelId}:${sortBy}`)
      return {
        ...comments(`${postId}-top`, async () => comments(`${postId}-next`)),
        header: { count: { text: '1,045 Comments' }, comments_count: { text: '1K' } },
      }
    },
    resolveURL: async (url: string) => {
      calls.push(`resolveURL:${url}`)
      return { payload: { browseId: 'UCresolved' } }
    },
    getPlaylists: async () => playlists('PLone', async () => playlists('PLtwo')),
    getNotifications: async () => notifications('n1', async () => notifications('n2')),
    getUnseenNotificationsCount: async () => 3,
    getPlaylist: async (id: string) => playlist(`${id}-first`, async () => playlist(`${id}-second`)),
    getSubscriptionsFeed: async () => feed('sub'),
    getHistory: async () => ({
      ...feed('watched'),
      sections: [
        { header: { title: 'Today' }, contents: [{ video_id: 'today', title: { text: 'Today video' } }] },
        { header: { title: 'Yesterday' }, contents: [{ video_id: 'older', title: { text: 'Older video' } }] },
      ],
      removeVideo: async (videoId: string, _pagesToLoad?: number): Promise<boolean | undefined> => void calls.push(`removeHistory:${videoId}`),
    }),
    getChannelsFeed: async () => ({
      channels: [{ author: { id: 'UC1', name: 'Chan', thumbnails: [{ url: 'a' }] } }],
    }),
    session: { logged_in: true, context: { client: { hl: 'en', gl: 'US' } } },
    interact: {
      comment: async (videoId: string, body: string) => void calls.push(`comment:${videoId}:${body}`),
      subscribe: async (channelId: string) => void calls.push(`subscribe:${channelId}`),
      unsubscribe: async (channelId: string) => void calls.push(`unsubscribe:${channelId}`),
      setNotificationPreferences: async (channelId: string, type: string) =>
        void calls.push(`notifications:${channelId}:${type}`),
    },
    actions: {
      execute: async (endpoint: string, args?: Record<string, unknown>) => {
        calls.push(endpoint)
        payloads.push({ endpoint, args })
        if (endpoint === 'live_chat/get_live_chat') {
          const token = typeof args?.continuation === 'string' ? args.continuation : ''
          const responder = chatQueues.get(token)?.shift()
          const resultPromise = responder ? Promise.resolve(responder()) : undefined
          for (let i = pollWaiters.length - 1; i >= 0; i -= 1) {
            pollWaiters[i]?.(token)
          }
          return {
            success: true,
            data: (resultPromise ? await resultPromise : {}) as never,
          }
        }
        if (endpoint === '/get_panel' && panelHandler) {
          return { success: true, data: (await panelHandler(args)) as never }
        }
        if (endpoint === '/live_chat/send_message' && sendChatHandler) {
          return { success: true, data: (await sendChatHandler(args)) as never }
        }
        if (endpoint.startsWith('/live_chat/') && pollActionHandler) {
          return { success: true, data: (await pollActionHandler(endpoint, args)) as never }
        }
        const relatedNext = {
          call: async () => ({
            on_response_received_endpoints_memo: new Map<string, unknown[]>([
              ['CompactVideo', [{ video_id: 'related-next', title: { text: 'More like this' } }]],
            ]),
          }),
        }
        const chatToken = endpoint === '/next' && typeof args?.videoId === 'string'
          ? nextChatTokens.get(args.videoId)
          : undefined
        const memo: [string, unknown[]][] = [
          ['VideoPrimaryInfo', [{ view_count: { view_count: { text: '42 views' } } }]],
          // A Map keeps the last value for a duplicate key, so a second TwoColumnWatchNextResults would silently hide this one
          ['TwoColumnWatchNextResults', [{
            // Mirrors the real nesting: a flat fixture here would pass while the real response does not
            secondary_results: [
              { contents: [
                { video_id: 'rel1', title: { text: 'Related one' } },
                { endpoint: relatedNext },
              ] },
            ],
            ...(chatToken
              ? { conversation_bar: { is_replay: false, continuation: chatToken } }
              : {}),
            ...(args?.playlistId
              ? {
                  playlist: {
                    id: args.playlistId,
                    title: 'Queue',
                    author: { name: 'Owner' },
                    contents: [
                      { video_id: 'q1', title: { text: 'First' }, thumbnail: [{ url: 'q1.jpg', width: 320 }], duration: { seconds: 61 } },
                      { primary: { video_id: 'q2', title: { text: 'Second' } } },
                      { playlist_video: {} },
                    ],
                    current_index: args.playlistIndex ?? 0,
                    is_infinite: false,
                  },
                }
              : {}),
          }]],
          ['ContinuationItem', [{ endpoint: { call: async () => ({}) } }]],
        ]
        return {
          success: true,
          // `playlistId` is optional on the wire and is never validated upstream
          data: (endpoint === '/reel/reel_item_watch'
            ? { replacementEndpoint: { reelWatchEndpoint: { videoId: 'seedless-short' } } }
            : { playlistId: 'PLnew' }) as { playlistId?: string, replacementEndpoint?: { reelWatchEndpoint?: { videoId?: string } } },
          contents_memo: new Map<string, unknown[]>(memo),
          actions_memo: endpoint === '/account/accounts_list' ? Parser.parseResponse(accountsListAnswer(twoChannels('own'))).actions_memo : undefined,
        }
      },
    },
  }
}

describe('youtube comment writes', () => {
  it('acts through the endpoint the page arrived with, not the comment id', async () => {
    commentCalls.length = 0
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => createFakeClient(),
    })
    const page = await source.comments('abc')
    const token = page.items[0]?.actionsToken
    expect(token).toBeTruthy()

    await source.rateComment(token!, 'LIKE')
    await source.rateComment(token!, 'DISLIKE')
    await source.rateComment(token!, 'INDIFFERENT')
    await source.replyToComment(token!, 'well said')
    expect(commentCalls).toEqual([
      'like:top',
      'dislike:top',
      'unlike:top',
      'reply:top:{"commentText":"well said"}',
    ])
  })

  it('reports an evicted comment handle as reloadable rather than failing opaquely', async () => {
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => createFakeClient(),
    })
    await expect(source.rateComment('youtube:comment:99999', 'LIKE'))
      .rejects.toThrow('no longer available')
  })

  it('posts a top-level comment through the video rather than a handle', async () => {
    const client = createFakeClient()
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await expect(source.postComment('abc', 'first')).resolves.toBe(true)
    expect(client.calls).toContain('comment:abc:first')
  })

  it('posts a top-level comment on a channel post through the post header\'s createCommentEndpoint', async () => {
    const executed: { endpoint: string, args: unknown }[] = []
    let postReads = 0
    const fakeActions = {
      execute: async (endpoint: string, args?: unknown) => {
        executed.push({ endpoint, args })
        return { success: true, status_code: 200, data: {} }
      },
    }
    const rawPostComments = {
      onResponseReceivedEndpoints: [
        {
          reloadContinuationItemsCommand: {
            continuationItems: [{
              commentsHeaderRenderer: {
                countText: { runs: [{ text: '12' }, { text: ' Comments' }] },
                createRenderer: {
                  commentSimpleboxRenderer: {
                    placeholderText: { runs: [{ text: 'Add a comment...' }] },
                    submitButton: {
                      buttonRenderer: {
                        text: { simpleText: 'Comment' },
                        serviceEndpoint: {
                          commandMetadata: { webCommandMetadata: { apiUrl: '/youtubei/v1/comment/create_comment', sendPost: true } },
                          createCommentEndpoint: { createCommentParams: 'POST_CREATE_PARAMS' },
                        },
                      },
                    },
                  },
                },
              },
            }],
          },
        },
        { reloadContinuationItemsCommand: { continuationItems: [] } },
      ],
    }
    const base = createFakeClient()
    const client = {
      ...base,
      actions: fakeActions,
      getPostComments: async (postId: string, channelId: string) => {
        postReads += 1
        base.calls.push(`getPostComments:${postId}:${channelId}`)
        return new YT.Comments(fakeActions as never, rawPostComments as never)
      },
    }
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => client as unknown as YoutubeClient,
    })

    // warm path: reading postComments caches the submit endpoint from the header
    await source.postComments('UgkxPost1', 'UCauthor1')
    expect(postReads).toBe(1)
    await expect(source.commentOnPost('UgkxPost1', 'UCauthor1', 'Great post!')).resolves.toBe(true)
    expect(postReads).toBe(1)
    expect(executed).toEqual([
      { endpoint: 'comment/create_comment', args: { createCommentParams: 'POST_CREATE_PARAMS', commentText: 'Great post!' } },
    ])

    // cold path: posting before postComments ran fetches the post's comments header once
    await expect(source.commentOnPost('UgkxPost2', 'UCauthor1', 'Second post')).resolves.toBe(true)
    expect(postReads).toBe(2)
    expect(executed[1]).toEqual({
      endpoint: 'comment/create_comment',
      args: { createCommentParams: 'POST_CREATE_PARAMS', commentText: 'Second post' },
    })
  })

  it('extracts custom channel emojis from CommentsHeader into CommentPage.customEmojis', async () => {
    const fakeActions = {
      execute: async () => ({ success: true, status_code: 200, data: {} }),
    }
    const rawComments = {
      onResponseReceivedEndpoints: [
        {
          reloadContinuationItemsCommand: {
            continuationItems: [{
              commentsHeaderRenderer: {
                countText: { runs: [{ text: '5 Comments' }] },
                customEmojis: [
                  {
                    emojiId: 'UC1/e1',
                    shortcuts: [':fanwave:', ':wave:'],
                    searchTerms: ['wave'],
                    image: { thumbnails: [{ url: '//yt3.ggpht.com/e1=w48', width: 48, height: 48 }] },
                    isCustomEmoji: true,
                  },
                  {
                    emojiId: 'UCkszU2WH9gy1mb0dV-11UJg/g1',
                    shortcuts: [':ytlogo:'],
                    image: { thumbnails: [{ url: '//yt3.ggpht.com/yt=w48', width: 48, height: 48 }] },
                    isCustomEmoji: true,
                  },
                  {
                    emojiId: 'UC1/e1',
                    shortcuts: [':fanwave:'],
                    image: { thumbnails: [{ url: '//yt3.ggpht.com/dup=w48', width: 48, height: 48 }] },
                    isCustomEmoji: true,
                  },
                  {
                    emojiId: 'UC1/empty',
                    shortcuts: [],
                    image: { thumbnails: [{ url: '//yt3.ggpht.com/e2=w48', width: 48, height: 48 }] },
                    isCustomEmoji: true,
                  },
                ],
              },
            }],
          },
        },
        { reloadContinuationItemsCommand: { continuationItems: [] } },
      ],
    }
    const base = createFakeClient()
    const client = {
      ...base,
      actions: fakeActions,
      getComments: async () => new YT.Comments(fakeActions as never, rawComments as never),
    }
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => client as unknown as YoutubeClient,
    })

    const page = await source.comments('vid1')
    expect(page.customEmojis).toEqual([
      { id: 'UC1/e1', shortcut: ':fanwave:', url: 'https://yt3.ggpht.com/e1=w48' },
      { id: 'UCkszU2WH9gy1mb0dV-11UJg/g1', shortcut: ':ytlogo:', url: 'https://yt3.ggpht.com/yt=w48', group: 'youtube' },
    ])
  })

  it('refuses to comment on a channel post when signed out or when the header has no submit endpoint', async () => {
    const signedOutClient = createFakeClient()
    signedOutClient.session.logged_in = false
    const signedOutSource = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => signedOutClient,
    })
    await expect(signedOutSource.commentOnPost('UgkxPost1', 'UC1', 'hello')).rejects.toThrow('sign in')
    expect(signedOutClient.calls).toEqual([])

    const noBoxClient = createFakeClient()
    const noBoxSource = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => noBoxClient,
    })
    await expect(noBoxSource.commentOnPost('UgkxPost1', 'UC1', 'hello')).rejects.toThrow('turned off')
  })
})

describe('youtube search', () => {
  it('keeps channel and playlist hits that the videos getter drops', async () => {
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => createFakeClient(),
    })
    const results = await source.search('query')
    expect(results.results.map((row) => row.kind)).toEqual(['video', 'channel'])
    expect(results.results[0]).toMatchObject({ kind: 'video', id: 'search' })
    expect(results.results[1]).toMatchObject({ kind: 'channel', id: 'UCchannel', name: 'A Channel' })
    expect(results.refinements).toEqual(['refined query'])
    expect(results.estimatedResults).toBe(1234)
  })

  it('translates the filter vocabulary and drops the unset axes', async () => {
    const client = createFakeClient()
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await source.search('query', { uploadDate: 'WEEK', sortBy: 'POPULARITY', features: ['FOUR_K', 'CREATIVE_COMMONS'] })
    await source.search('query', { uploadDate: 'ALL', type: 'ALL' })
    expect(client.searchFilters[0]).toEqual({
      upload_date: 'week',
      type: undefined,
      duration: undefined,
      prioritize: 'popularity',
      features: ['4k', 'creative_commons'],
    })
    expect(client.searchFilters[1]).toBeUndefined()
  })

  it('refuses a cursor minted under a different filter set', async () => {
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => createFakeClient(),
    })
    const unfiltered = await source.search('query')
    expect(unfiltered.cursor).toBeTruthy()
    await expect(source.search('query', { uploadDate: 'WEEK' }, unfiltered.cursor))
      .rejects.toThrow('belongs to')
    await expect(source.search('query', undefined, unfiltered.cursor)).resolves.toBeTruthy()
  })
})

describe('youtube channel tabs', () => {
  it('browses a channel once and serves every tab off it', async () => {
    const client = createFakeClient()
    let fetches = 0
    const inner = client.getChannel
    client.getChannel = async () => {
      fetches += 1
      return inner()
    }
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await source.channel('c')
    await source.channel('c', 'PLAYLISTS')
    await source.channel('c', 'COMMUNITY')
    await source.channelAbout('c')
    expect(await source.channelTags('c')).toEqual([])
    await source.communityPosts('c')
    expect(fetches).toBe(1)
  })


  it('reports only the tabs the channel actually has', async () => {
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => createFakeClient(),
    })
    const result = await source.channel('c')
    expect(result.availableTabs).toEqual(['VIDEOS', 'PLAYLISTS', 'COMMUNITY', 'ABOUT'])
    expect(result.tab).toBe('VIDEOS')
    expect(result.videos.items[0]?.id).toBe('channel-videos')
  })

  it('opens the requested tab and ignores one the channel does not have', async () => {
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => createFakeClient(),
    })
    const playlists = await source.channel('c', 'PLAYLISTS')
    expect(playlists.tab).toBe('PLAYLISTS')
    expect(playlists.videos.items[0]?.id).toBe('channel-playlists')
    const missing = await source.channel('c', 'SHORTS')
    expect(missing.tab).toBe('VIDEOS')
  })

  it('returns the Posts tab items on channel(id, COMMUNITY) and continues through communityPosts without re-fetching getCommunity', async () => {
    const client = createFakeClient()
    let communityCalls = 0
    const inner = client.getChannel
    client.getChannel = async () => {
      const channel = await inner()
      const orig = channel.getCommunity.bind(channel)
      channel.getCommunity = async function (this: unknown) {
        communityCalls += 1
        return orig()
      }
      return channel
    }
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    const first = await source.channel('c', 'COMMUNITY')
    expect(first.tab).toBe('COMMUNITY')
    expect(first.posts?.items.map((post) => post.id)).toEqual(['post-1'])
    expect(first.posts?.cursor).toBeTruthy()
    expect(communityCalls).toBe(1)

    const second = await source.communityPosts('c', first.posts?.cursor)
    expect(second.items.map((post) => post.id)).toEqual(['post-2'])
    expect(communityCalls).toBe(1)
  })

  it('sorts the Videos tab by its chip bar, through the chip itself', async () => {
    const client = createFakeClient()
    const applied: unknown[] = []
    const chips = ['Latest', 'Popular', 'Oldest'].map((text) => ({ text, display_type: 'CHIP_VIEW_MODEL_DISPLAY_TYPE_UNSPECIFIED' }))
    const inner = client.getChannel
    client.getChannel = async () => Object.assign(await inner(), {
      async getVideos() {
        return {
          ...feed('latest'),
          memo: new Map<string, unknown[]>([['ChipView', chips]]),
          applyFilter: async (chip: unknown) => {
            applied.push(chip)
            return feed('oldest')
          },
        }
      },
    })
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    const latest = await source.channel('c', 'VIDEOS')
    expect(latest.sortOptions).toEqual(['Latest', 'Popular', 'Oldest'])
    expect(applied).toEqual([])
    const oldest = await source.channel('c', 'VIDEOS', 'Oldest')
    expect(oldest.appliedSort).toBe('Oldest')
    expect(applied).toEqual([chips[2]])
    expect(oldest.videos.items[0]?.id).toBe('oldest')
  })

  it('refuses a cursor minted for a different tab of the same channel', async () => {
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => createFakeClient(),
    })
    const videos = await source.channel('c')
    expect(videos.videos.cursor).toBeTruthy()
    await expect(source.channel('c', 'PLAYLISTS', undefined, undefined, videos.videos.cursor))
      .rejects.toThrow('belongs to')
  })

  it('enriches channel live status from the channel feed while ignoring other channels live streams', async () => {
    const liveOwn = createFakeClient()
    const ownInner = liveOwn.getChannel
    liveOwn.getChannel = async () => Object.assign(await ownInner(), {
      async getVideos() {
        return {
          ...feed('live-own-1'),
          videos: [{ video_id: 'live-own-1', title: { text: 'Live now' }, is_live: true }],
          memo: new Map<string, unknown[]>(),
          has_continuation: false,
        }
      },
    })
    const ownSource = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => liveOwn })
    const ownResult = await ownSource.channel('c')
    expect(ownResult.channel.isLive).toBe(true)
    expect(ownResult.channel.liveVideoId).toBe('live-own-1')

    const foreignOnly = createFakeClient()
    const foreignInner = foreignOnly.getChannel
    foreignOnly.getChannel = async () => Object.assign(await foreignInner(), {
      async getVideos() {
        return {
          ...feed('live-foreign-1'),
          videos: [{
            video_id: 'live-foreign-1',
            title: { text: 'Collab guest stream' },
            is_live: true,
            author: { id: 'UC_other_creator', name: 'Other Creator' },
          }],
          memo: new Map<string, unknown[]>(),
          has_continuation: false,
        }
      },
    })
    const foreignSource = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => foreignOnly })
    const foreignResult = await foreignSource.channel('c')
    expect(foreignResult.channel.isLive).toBeUndefined()
    expect(foreignResult.channel.liveVideoId).toBeUndefined()
  })

  it('ignores Home shelf live videos without matching channel id (APP-956)', async () => {
    const homeFeaturedForeign = createFakeClient()
    const baseChannel = await homeFeaturedForeign.getChannel()
    homeFeaturedForeign.getChannel = async () => ({
      ...baseChannel,
      has_home: true,
      current_tab: {
        endpoint: { metadata: { url: '/channel/c/featured' } },
        content: {
          contents: [{
            contents: [{
              type: 'Shelf',
              title: { text: 'Featured Channels' },
              content: {
                items: [{
                  type: 'GridVideo',
                  id: 'foreign-live-1',
                  title: { text: 'Someone else is streaming' },
                  is_live: true,
                }],
              },
            }],
          }],
        },
      },
    })
    const foreignSource = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => homeFeaturedForeign })
    const foreignHome = await foreignSource.channel('c', 'HOME')
    expect(foreignHome.channel.isLive).toBeUndefined()
    expect(foreignHome.channel.liveVideoId).toBeUndefined()

    const ownHome = createFakeClient()
    const ownChannel = await ownHome.getChannel()
    ownHome.getChannel = async () => ({
      ...ownChannel,
      has_home: true,
      current_tab: {
        endpoint: { metadata: { url: '/channel/c/featured' } },
        content: {
          contents: [{
            contents: [{
              type: 'Shelf',
              title: { text: 'Happening now' },
              endpoint: { payload: { browseId: 'c' } },
              content: {
                items: [{
                  type: 'GridVideo',
                  id: 'own-live-1',
                  title: { text: 'Creator stream without byline' },
                  is_live: true,
                }],
              },
            }],
          }],
        },
      },
    })
    const ownSource = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => ownHome })
    const ownResult = await ownSource.channel('c', 'HOME')
    expect(ownResult.channel.isLive).toBe(true)
    expect(ownResult.channel.liveVideoId).toBe('own-live-1')

    const featuredHome = createFakeClient()
    const featuredChannel = await featuredHome.getChannel()
    featuredHome.getChannel = async () => ({
      ...featuredChannel,
      has_home: true,
      current_tab: {
        endpoint: { metadata: { url: '/channel/c/featured' } },
        content: {
          contents: [{
            contents: [{
              type: 'ChannelVideoPlayer',
              id: 'featured-live-1',
              title: { text: 'Channel trailer live stream' },
              is_live: true,
            }],
          }],
        },
      },
    })
    const featuredSource = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => featuredHome })
    const featuredResult = await featuredSource.channel('c', 'HOME')
    expect(featuredResult.channel.isLive).toBe(true)
    expect(featuredResult.channel.liveVideoId).toBe('featured-live-1')

    const ownCollabForeign = createFakeClient()
    const collabChannel = await ownCollabForeign.getChannel()
    ownCollabForeign.getChannel = async () => ({
      ...collabChannel,
      has_home: true,
      current_tab: {
        endpoint: { metadata: { url: '/channel/c/featured' } },
        content: {
          contents: [{
            contents: [{
              type: 'Shelf',
              title: { text: 'Collaborations' },
              endpoint: { payload: { browseId: 'c' } },
              content: {
                items: [{
                  type: 'GridVideo',
                  id: 'guest-live-1',
                  title: { text: 'Guest stream on own shelf' },
                  is_live: true,
                  author: { id: 'UC_other', name: 'Guest Creator' },
                }],
              },
            }],
          }],
        },
      },
    })
    const collabSource = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => ownCollabForeign })
    const collabResult = await collabSource.channel('c', 'HOME')
    expect(collabResult.channel.isLive).toBeUndefined()
    expect(collabResult.channel.liveVideoId).toBeUndefined()
  })

  it('preserves members-only badges on parsed Posts tab and Home post shelf items (APP-957)', async () => {
    const rawPostsBrowse = {
      header: {
        c4TabbedHeaderRenderer: {
          channelId: 'UC-posts',
          title: 'Posts Creator',
        },
      },
      contents: {
        twoColumnBrowseResultsRenderer: {
          tabs: [{
            tabRenderer: {
              title: 'Posts',
              selected: true,
              endpoint: { commandMetadata: { webCommandMetadata: { url: '/channel/UC-posts/posts' } } },
              content: {
                sectionListRenderer: {
                  contents: [{
                    itemSectionRenderer: {
                      contents: [
                        {
                          backstagePostThreadRenderer: {
                            post: {
                              backstagePostRenderer: {
                                postId: 'Ugkx-tab-members',
                                authorText: { runs: [{ text: 'Posts Creator' }] },
                                authorEndpoint: { browseEndpoint: { browseId: 'UC-posts' } },
                                contentText: { runs: [{ text: 'Members post on Posts tab' }] },
                                publishedTimeText: { runs: [{ text: '1 day ago' }] },
                                sponsorsOnlyBadge: {
                                  sponsorsOnlyBadgeRenderer: {
                                    label: { simpleText: 'Members only' },
                                  },
                                },
                              },
                            },
                          },
                        },
                        {
                          backstagePostThreadRenderer: {
                            post: {
                              backstagePostRenderer: {
                                postId: 'Ugkx-tab-public',
                                authorText: { runs: [{ text: 'Posts Creator' }] },
                                authorEndpoint: { browseEndpoint: { browseId: 'UC-posts' } },
                                contentText: { runs: [{ text: 'Public post on Posts tab' }] },
                                publishedTimeText: { runs: [{ text: '2 days ago' }] },
                              },
                            },
                          },
                        },
                      ],
                    },
                  }],
                },
              },
            },
          }],
        },
      },
    }

    const postsSource = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => ({
        getChannel: async () => new YT.Channel(undefined as never, Parser.parseResponse(rawPostsBrowse as never), true),
      }) as never,
    })

    const tabPage = await postsSource.channel('UC-posts', 'COMMUNITY')
    expect(tabPage.posts?.items.map((item) => ({
      id: item.id,
      isMembersOnly: item.isMembersOnly,
      membersOnlyLabel: item.membersOnlyLabel,
    }))).toEqual([
      { id: 'Ugkx-tab-members', isMembersOnly: true, membersOnlyLabel: 'Members only' },
      { id: 'Ugkx-tab-public', isMembersOnly: undefined, membersOnlyLabel: undefined },
    ])

    const directPosts = await postsSource.communityPosts('UC-posts')
    expect(directPosts.items[0]).toMatchObject({
      id: 'Ugkx-tab-members',
      isMembersOnly: true,
      membersOnlyLabel: 'Members only',
    })
    expect(directPosts.items[1]?.isMembersOnly).toBeUndefined()

    const rawHomeBrowse = {
      header: {
        c4TabbedHeaderRenderer: {
          channelId: 'UC-home-posts',
          title: 'Home Creator',
        },
      },
      contents: {
        twoColumnBrowseResultsRenderer: {
          tabs: [{
            tabRenderer: {
              title: 'Home',
              selected: true,
              endpoint: { commandMetadata: { webCommandMetadata: { url: '/channel/UC-home-posts/featured' } } },
              content: {
                sectionListRenderer: {
                  contents: [{
                    itemSectionRenderer: {
                      contents: [{
                        shelfRenderer: {
                          title: { runs: [{ text: 'Latest posts' }] },
                          content: {
                            horizontalListRenderer: {
                              items: [
                                {
                                  postRenderer: {
                                    postId: 'Ugkx-home-members',
                                    authorText: { runs: [{ text: 'Home Creator' }] },
                                    authorEndpoint: { browseEndpoint: { browseId: 'UC-home-posts' } },
                                    contentText: { runs: [{ text: 'Members post on Home shelf' }] },
                                    publishedTimeText: { runs: [{ text: '3 hours ago' }] },
                                    sponsorsOnlyBadge: {
                                      sponsorsOnlyBadgeRenderer: {
                                        label: { simpleText: 'Members only' },
                                      },
                                    },
                                  },
                                },
                                {
                                  backstagePostRenderer: {
                                    postId: 'Ugkx-home-backstage-members',
                                    authorText: { runs: [{ text: 'Home Creator' }] },
                                    authorEndpoint: { browseEndpoint: { browseId: 'UC-home-posts' } },
                                    contentText: { runs: [{ text: 'Members backstage post on Home' }] },
                                    publishedTimeText: { runs: [{ text: '4 hours ago' }] },
                                    badges: [{
                                      metadataBadgeRenderer: {
                                        style: 'BADGE_STYLE_TYPE_MEMBERS_ONLY',
                                        label: 'Members only',
                                      },
                                    }],
                                  },
                                },
                                {
                                  postRenderer: {
                                    postId: 'Ugkx-home-public',
                                    authorText: { runs: [{ text: 'Home Creator' }] },
                                    authorEndpoint: { browseEndpoint: { browseId: 'UC-home-posts' } },
                                    contentText: { runs: [{ text: 'Public post on Home shelf' }] },
                                    publishedTimeText: { runs: [{ text: '5 hours ago' }] },
                                  },
                                },
                              ],
                            },
                          },
                        },
                      }],
                    },
                  }],
                },
              },
            },
          }],
        },
      },
    }

    const homeSource = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => ({
        getChannel: async () => new YT.Channel(undefined as never, Parser.parseResponse(rawHomeBrowse as never), true),
      }) as never,
    })

    const homePage = await homeSource.channel('UC-home-posts', 'HOME')
    expect(homePage.home?.shelves).toHaveLength(1)
    expect(homePage.home?.shelves[0]?.posts.map((item) => ({
      id: item.id,
      isMembersOnly: item.isMembersOnly,
      membersOnlyLabel: item.membersOnlyLabel,
    }))).toEqual([
      { id: 'Ugkx-home-members', isMembersOnly: true, membersOnlyLabel: 'Members only' },
      { id: 'Ugkx-home-backstage-members', isMembersOnly: true, membersOnlyLabel: 'Members only' },
      { id: 'Ugkx-home-public', isMembersOnly: undefined, membersOnlyLabel: undefined },
    ])
  })

  // youtube.com's signed-out answer for a channel id nobody holds, read 2026-11-10, less its tracking fields
  it('rejects with upstream\'s own line for a channel that does not exist, marked apart from any other failure', async () => {
    const answer = {
      header: { c4TabbedHeaderRenderer: { channelId: 'UCzzzzzzzzzzzzzzzzzzzzzz', avatar: { thumbnails: [{ url: 'https://yt3.googleusercontent.com/a/default-user=s100-c-k-c0x00ffffff-no-rj', width: 100, height: 100 }] } } },
      alerts: [{ alertRenderer: { type: 'ERROR', text: { simpleText: 'This channel does not exist.' } } }],
    }
    const missing = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => ({
        getChannel: async () => new YT.Channel(undefined as never, Parser.parseResponse(answer as never), true),
      }) as never,
    })
    await expect(missing.channel('UCzzzzzzzzzzzzzzzzzzzzzz')).rejects.toThrow(new Error(`${CHANNEL_UNAVAILABLE}This channel does not exist.`))
    const broken = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => ({
        getChannel: async () => { throw new Error('Tab "featured" not found') },
      }) as never,
    })
    await expect(broken.channel('UCzzzzzzzzzzzzzzzzzzzzzz')).rejects.toThrow(new Error('Tab "featured" not found'))
  })

  it('rejects a handle upstream answers 404 for as not found, and any other failure as it came', async () => {
    const resolving = (error: Error) => createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => ({ resolveURL: async () => { throw error } }) as never,
    })
    // youtubei.js's own words for a failed request, measured on resolve_url for a missing handle on 2026-11-10
    const failed = (status: number) => new Error(`Request to https://www.youtube.com/youtubei/v1/navigation/resolve_url?prettyPrint=false&alt=json failed with status code ${status}`)
    await expect(resolving(failed(404)).channel('@thischanneldoesnotexist9876543')).rejects.toThrow(new Error(CHANNEL_NOT_FOUND))
    await expect(resolving(failed(500)).channel('@someone')).rejects.toThrow(failed(500))
    await expect(resolving(new TypeError('Failed to fetch')).channel('@someone')).rejects.toThrow(new TypeError('Failed to fetch'))
  })

  // youtubei.js's words for a playlist id nobody holds, read 2026-11-11: an InnertubeError carrying upstream's alert
  it('rejects with upstream\'s own line for a playlist that does not exist, and any other failure as it came', async () => {
    const answer = { alerts: [{ alertRenderer: { type: 'ERROR', text: { simpleText: 'The playlist does not exist.' } } }] }
    const playlist = (getPlaylist: () => Promise<unknown>) => createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => ({ getPlaylist }) as never,
    }).playlist('PLzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz')
    await expect(playlist(async () => new YT.Playlist(undefined as never, Parser.parseResponse(answer as never), true)))
      .rejects.toThrow(new Error(`${PLAYLIST_UNAVAILABLE}The playlist does not exist.`))
    const failed = new Error('Request to https://www.youtube.com/youtubei/v1/browse?prettyPrint=false&alt=json failed with status code 500')
    await expect(playlist(async () => { throw failed })).rejects.toThrow(failed)
  })
})

describe('youtube source', () => {
  const rawTextMessage = (id: string, text: string, authorId = 'UCchat', authorName = 'Viewer') => ({
    liveChatTextMessageRenderer: {
      id,
      message: { runs: [{ text }] },
      authorName: { simpleText: authorName },
      authorExternalChannelId: authorId,
      authorPhoto: { thumbnails: [{ url: 'https://img/avatar.jpg', width: 32 }] },
      timestampText: { simpleText: '1:02' },
    },
  })

  const rawChatResponse = ({
    cont,
    timeoutMs = 250,
    contType = 'invalidation' as 'invalidation' | 'timed',
    actions = [] as unknown[],
    emojis = [] as unknown[],
    topToken,
    allToken,
    selectedView,
    restrictionText,
    sendParams,
  }: {
    cont?: string
    timeoutMs?: number
    contType?: 'invalidation' | 'timed'
    actions?: unknown[]
    emojis?: unknown[]
    topToken?: string
    allToken?: string
    selectedView?: 'TOP' | 'ALL'
    restrictionText?: string
    sendParams?: string
  } = {}) => ({
    continuationContents: {
      liveChatContinuation: {
        ...(cont
          ? {
              continuations: [
                contType === 'timed'
                  ? { timedContinuationData: { continuation: cont, timeoutMs } }
                  : { invalidationContinuationData: { continuation: cont, timeoutMs } },
              ],
            }
          : {}),
        ...(topToken || allToken
          ? {
              header: {
                liveChatHeaderRenderer: {
                  viewSelector: {
                    sortFilterSubMenuRenderer: {
                      subMenuItems: [
                        ...(topToken ? [{ selected: selectedView === 'TOP', continuation: topToken }] : []),
                        ...(allToken ? [{ selected: selectedView === 'ALL', continuation: allToken }] : []),
                      ],
                    },
                  },
                },
              },
            }
          : {}),
        ...(emojis.length ? { emojis } : {}),
        ...(restrictionText
          ? {
              actionPanel: {
                liveChatRestrictedParticipationRenderer: {
                  message: { runs: [{ text: restrictionText }] },
                },
              },
            }
          : sendParams
            ? {
                actionPanel: {
                  liveChatMessageInputRenderer: {
                    sendButton: { buttonRenderer: { serviceEndpoint: { sendLiveChatMessageEndpoint: { params: sendParams } } } },
                  },
                },
              }
            : {}),
        actions,
      },
    },
  })

  it('reuses watch /next chat token, polls directly without queue lag, and stops when stream ends', async () => {
    const client = createFakeClient()
    client.setNextChatToken('abc', 'top-tok')
    client.enqueueChatResponse('top-tok', rawChatResponse({
      cont: 'tok-2',
      actions: [{ addChatItemAction: { item: rawTextMessage('c1', 'hello') } }],
    }))
    client.parkChatToken('tok-2')

    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await source.watch('abc')
    const first = await source.liveChat('abc')
    expect(client.calls.filter((c) => c === '/next')).toHaveLength(1)
    expect(first.items.map((item) => item.id)).toEqual(['c1'])
    expect(first.cursor).toBeTruthy()

    const poll = source.liveChat('abc', first.cursor)
    await client.waitForChatPoll('tok-2')
    client.enqueueChatResponse('tok-2', rawChatResponse({
      actions: [{ addChatItemAction: { item: rawTextMessage('c2', 'still here') } }],
    }))
    const second = await poll
    expect(second.items.map((item) => item.id)).toEqual(['c2'])
    expect(second.cursor).toBeUndefined()
  })

  it('captures backlog, pinned banners, emojis, removals, and Top/Live view switching', async () => {
    const client = createFakeClient()
    client.setNextChatToken('v-stream', 'top-tok')
    client.enqueueChatResponse('top-tok', rawChatResponse({
      cont: 'tok-2',
      topToken: 'top-tok',
      allToken: 'all-tok',
      selectedView: 'TOP',
      emojis: [{ emojiId: 'e1', shortcuts: [':wave:'], image: { thumbnails: [{ url: 'https://img/wave.png', width: 48 }] }, isCustomEmoji: true }],
      actions: [
        { addChatItemAction: { item: rawTextMessage('init-1', 'initial backlog') } },
        {
          addBannerToLiveChatCommand: {
            bannerRenderer: {
              liveChatBannerRenderer: {
                actionId: 'pin-1',
                header: { liveChatBannerHeaderRenderer: { text: { simpleText: 'Pinned message' } } },
                contents: rawTextMessage('pin-msg', 'Read FAQ'),
              },
            },
          },
        },
      ],
    }))
    client.parkChatToken('tok-2')
    client.enqueueChatResponse('all-tok', rawChatResponse({
      actions: [{ addChatItemAction: { item: rawTextMessage('all-1', 'unfiltered') } }],
    }))

    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    const first = await source.liveChat('v-stream', undefined, 'TOP')
    expect(first.items.map((item) => item.id)).toEqual(['init-1'])
    expect(first.pinned).toMatchObject({ id: 'pin-1', header: 'Pinned message' })
    expect(first.customEmojis).toEqual([{ id: 'e1', shortcut: ':wave:', url: 'https://img/wave.png' }])

    const secondPromise = source.liveChat('v-stream', first.cursor, 'TOP')
    await client.waitForChatPoll('tok-2')
    client.enqueueChatResponse('tok-2', rawChatResponse({
      cont: 'tok-3',
      actions: [
        { removeBannerForLiveChatCommand: { targetActionId: 'other-banner' } },
        { removeChatItemAction: { targetItemId: 'init-1' } },
      ],
    }))
    const second = await secondPromise
    expect(second.pinnedCleared).toBeUndefined()
    expect(second.removedIds).toEqual(['init-1'])

    client.parkChatToken('tok-3')
    const thirdPromise = source.liveChat('v-stream', second.cursor, 'TOP')
    await client.waitForChatPoll('tok-3')
    client.enqueueChatResponse('tok-3', rawChatResponse({
      actions: [
        { removeBannerForLiveChatCommand: { targetActionId: 'pin-1' } },
        { removeChatItemByAuthorAction: { externalChannelId: 'UCbad' } },
      ],
    }))
    const third = await thirdPromise
    expect(third.pinnedCleared).toBe(true)
    expect(third.removedAuthorIds).toEqual(['UCbad'])

    const allPage = await source.liveChat('v-stream', undefined, 'ALL')
    expect(allPage.items.map((item) => item.id)).toEqual(['all-1'])
  })

  it('switches a cold liveChat(ALL) opening without leaking TOP messages or calling /next twice', async () => {
    const client = createFakeClient()
    client.setNextChatToken('v-cold', 'top-tok')
    client.enqueueChatResponse('top-tok', rawChatResponse({
      cont: 'top-next',
      topToken: 'top-tok',
      allToken: 'all-tok',
      selectedView: 'TOP',
      actions: [{ addChatItemAction: { item: rawTextMessage('top-stale', 'should not leak') } }],
    }))
    client.enqueueChatResponse('all-tok', rawChatResponse({
      topToken: 'top-tok',
      allToken: 'all-tok',
      selectedView: 'ALL',
      actions: [{ addChatItemAction: { item: rawTextMessage('all-real', 'live chat unfiltered') } }],
    }))

    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    const first = await source.liveChat('v-cold', undefined, 'ALL')
    expect(client.calls.filter((call) => call === '/next')).toHaveLength(1)
    expect(first.items.map((item) => item.id)).toEqual(['all-real'])
  })

  it('reopens a restricted liveChat session when cursor is omitted to refresh permissions', async () => {
    const client = createFakeClient()
    client.setNextChatToken('v-res', 'tok-res')
    client.enqueueChatResponse('tok-res', rawChatResponse({
      cont: 'tok-res-2',
      restrictionText: 'Subscribers-only mode',
    }))
    client.parkChatToken('tok-res-2')

    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    const restrictedPage = await source.liveChat('v-res', undefined, 'TOP')
    expect(restrictedPage.inputState).toMatchObject({ status: 'RESTRICTED', restrictionMode: 'SUBSCRIBERS_ONLY' })
    await expect(source.sendLiveChatMessage('v-res', 'hello')).rejects.toThrow('Subscribers-only mode')

    client.setNextChatToken('v-res', 'tok-unlocked')
    client.enqueueChatResponse('tok-unlocked', rawChatResponse({ sendParams: 'unlocked-secret' }))
    const unlockedPage = await source.liveChat('v-res', undefined, 'TOP')
    expect(client.calls.filter((c) => c === '/next')).toHaveLength(2)
    expect(unlockedPage.inputState?.status).toBe('ENABLED')
  })

  it('opens the chat again on a cursor it never issued and never returns a replaced cursor', async () => {
    const client = createFakeClient()
    client.setNextChatToken('abc', 'top-tok')
    client.enqueueChatResponse('top-tok', rawChatResponse({
      cont: 'tok-2',
      actions: [{ addChatItemAction: { item: rawTextMessage('c0', 'initial') } }],
    }))
    const before = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    const old = (await before.liveChat('abc')).cursor!
    expect(old).toBeTruthy()

    const afterClient = createFakeClient()
    afterClient.setNextChatToken('abc', 'top-tok')
    afterClient.enqueueChatResponse('top-tok', rawChatResponse({
      cont: 'tok-3',
      actions: [{ addChatItemAction: { item: rawTextMessage('c2', 'back') } }],
    }))
    const after = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => afterClient })
    const page = await after.liveChat('abc', old)
    expect(page.items.map((item) => item.id)).toEqual(['c2'])
    expect(page.cursor).toBeTruthy()
    expect(page.cursor).not.toBe(old)

    const resetClient = createFakeClient()
    resetClient.setNextChatToken('abc', 'top-tok')
    resetClient.enqueueChatResponse('top-tok', rawChatResponse({
      actions: [{ addChatItemAction: { item: rawTextMessage('c3', 'reopened') } }],
    }))
    const resetSource = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => resetClient })
    const unknownPage = await resetSource.liveChat('abc', 'youtube:livechat:abc:7')
    expect(unknownPage.items.map((item) => item.id)).toEqual(['c3'])
  })

  it('reports chat being unavailable rather than throwing', async () => {
    const client = createFakeClient()
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    const page = await source.liveChat('nochat')
    expect(page).toEqual({ items: [], disabled: true })
    expect(client.calls).not.toContain('live_chat/get_live_chat')
  })

  it('sends through open session with sendParams, pushes instant echo, and surfaces tooltip errors', async () => {
    const client = createFakeClient()
    client.setNextChatToken('abc', 'top-tok')
    client.enqueueChatResponse('top-tok', rawChatResponse({
      cont: 'tok-2',
      sendParams: 'panel-send-params',
    }))
    client.parkChatToken('tok-2')
    client.setSendChatHandler(async (args) => {
      const segments = (args?.richMessage as { textSegments?: { text?: string }[] })?.textSegments
      const msg = segments?.[0]?.text ?? ''
      if (msg === 'too-fast') {
        return {
          actions: [{ showLiveChatTooltipCommand: { tooltip: { tooltipRenderer: { text: { simpleText: 'Slow mode enabled' } } } } }],
        }
      }
      return {
        actions: [{ addChatItemAction: { item: rawTextMessage('echo-1', msg) } }],
      }
    })

    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await expect(source.sendLiveChatMessage('abc', 'hi')).rejects.toThrow('live chat is not open')

    const opened = await source.liveChat('abc')
    const waitingPoll = source.liveChat('abc', opened.cursor)
    await expect(source.sendLiveChatMessage('abc', 'hi')).resolves.toBe(true)
    const sendCall = client.payloads.find((p) => p.endpoint === '/live_chat/send_message')
    expect(sendCall?.args).toMatchObject({ params: 'panel-send-params', richMessage: { textSegments: [{ text: 'hi' }] } })
    const woken = await waitingPoll
    expect(woken.items.map((item) => item.id)).toEqual(['echo-1'])

    await expect(source.sendLiveChatMessage('abc', 'too-fast')).rejects.toThrow('Slow mode enabled')
  })

  it('fetches and parses liveChatLeaderboard via /get_panel', async () => {
    const client = createFakeClient()
    client.setPanelHandler(async () => ({
      content: {
        engagementPanelSectionListRenderer: {
          header: { engagementPanelTitleHeaderRenderer: { title: { runs: [{ text: 'Top fans' }] } } },
          content: {
            sectionListRenderer: {
              contents: [{
                itemSectionRenderer: {
                  contents: [{
                    liveLeaderboardItemViewModel: {
                      rank: { content: '#1' },
                      points: { content: '500 points' },
                      content: {
                        liveLeaderboardItemChannelContentViewModel: {
                          displayName: { content: 'Alice' },
                          badge: { buttonViewModel: { title: '#1', customBackgroundColor: 0xffffd600, customFontColor: 0xff0f0f0f } },
                        },
                      },
                    },
                  }],
                },
              }],
            },
          },
        },
      },
    }))
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    const board = await source.liveChatLeaderboard('PAlive_viewer_leaderboard', encodeURIComponent('raw-params'))
    expect(board.title).toBe('Top fans')
    expect(board.items[0]).toMatchObject({ rank: '#1', displayName: 'Alice', points: '500 points', badgeLabel: '#1' })
    const panelCall = client.payloads.find((p) => p.endpoint === '/get_panel')
    expect(panelCall?.args).toMatchObject({ panelId: 'PAlive_viewer_leaderboard', params: 'raw-params', parse: false })
  })

  it('validates and submits voteLiveChatPoll with optimistic poll update', async () => {
    const client = createFakeClient()
    client.setNextChatToken('abc', 'top-tok')
    client.enqueueChatResponse('top-tok', rawChatResponse({
      cont: 'tok-2',
      actions: [{
        showLiveChatActionPanelAction: {
          panelToShow: {
            liveChatActionPanelRenderer: {
              contents: {
                pollRenderer: {
                  liveChatPollId: 'poll-1',
                  header: { pollHeaderRenderer: { pollQuestion: { simpleText: 'Pick one?' } } },
                  choices: [
                    {
                      text: { simpleText: 'Yes' },
                      serviceEndpoint: {
                        commandMetadata: { webCommandMetadata: { apiUrl: '/youtubei/v1/live_chat/live_chat_action' } },
                        sendLiveChatVoteEndpoint: { params: 'vote-yes-params' },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      }],
    }))
    client.parkChatToken('tok-2')
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await expect(source.voteLiveChatPoll('abc', 'poll-1', 'bad-json')).rejects.toThrow('invalid live poll vote')
    await expect(source.voteLiveChatPoll('abc', 'poll-1', JSON.stringify({ endpoint: '/browse', params: 'x' }))).rejects.toThrow('invalid live poll vote')
    await expect(source.voteLiveChatPoll('abc', 'poll-1', JSON.stringify({ endpoint: '/live_chat/../browse', params: 'x' }))).rejects.toThrow('invalid live poll vote')

    const opened = await source.liveChat('abc')
    const pollPoll = source.liveChat('abc', opened.cursor)
    const votePayload = opened.poll!.choices[0]!.voteParams!
    await expect(source.voteLiveChatPoll('abc', 'poll-1', votePayload)).resolves.toBe(true)
    expect(client.payloads.find((p) => p.endpoint === '/live_chat/live_chat_action')?.args).toMatchObject({ params: 'vote-yes-params', parse: false })
    const updated = await pollPoll
    expect(updated.poll?.choices[0]?.selected).toBe(true)
  })

  it('stops any earlier session when concurrent cursorless opens overlap on the same video', async () => {
    const baseClient = createFakeClient()
    baseClient.setNextChatToken('v-race', 'tok-race')
    let releaseFirstNext: ((value: unknown) => void) | undefined
    let releaseSecondNext: ((value: unknown) => void) | undefined
    let nextCallCount = 0
    const recordedEndpoints: string[] = []
    const raceClient = {
      ...baseClient,
      actions: {
        execute: async (endpoint: string, args?: Record<string, unknown>) => {
          recordedEndpoints.push(endpoint)
          if (endpoint === '/next') {
            nextCallCount += 1
            if (nextCallCount === 1) {
              return new Promise((resolve) => { releaseFirstNext = resolve })
            }
            return new Promise((resolve) => { releaseSecondNext = resolve })
          }
          return baseClient.actions.execute(endpoint as never, args as never)
        },
      },
    }
    baseClient.enqueueChatResponse('tok-race', rawChatResponse({ cont: 'tok-poll-1', actions: [{ addChatItemAction: { item: rawTextMessage('r1', 'first') } }] }))
    baseClient.enqueueChatResponse('tok-race', rawChatResponse({ cont: 'tok-poll-2', actions: [{ addChatItemAction: { item: rawTextMessage('r2', 'second') } }] }))

    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => raceClient as never })
    const p1 = source.liveChat('v-race', undefined, 'TOP')
    const p2 = source.liveChat('v-race', undefined, 'TOP')
    for (let i = 0; i < 50 && nextCallCount < 2; i += 1) {
      await new Promise((r) => setTimeout(r, 0))
    }
    expect(nextCallCount).toBe(2)

    const nextPayload = {
      contents_memo: new Map([
        ['VideoPrimaryInfo', [{}]],
        ['TwoColumnWatchNextResults', [{ secondary_results: [], conversation_bar: { is_replay: false, continuation: 'tok-race' } }]],
      ]),
    }
    releaseFirstNext!(nextPayload)
    await new Promise((r) => setTimeout(r, 20))
    releaseSecondNext!(nextPayload)
    const [firstRes, secondRes] = await Promise.all([p1, p2])
    expect(firstRes.cursor).toBeTruthy()
    expect(secondRes.cursor).toBeTruthy()

    const callsBeforeWait = recordedEndpoints.filter((ep) => ep === 'live_chat/get_live_chat').length
    await new Promise((r) => setTimeout(r, 1_150))
    const callsAfterWait = recordedEndpoints.filter((ep) => ep === 'live_chat/get_live_chat').length
    // Only the winning second session continues polling (+1 poll), never two concurrent loops (+2).
    expect(callsAfterWait - callsBeforeWait).toBeLessThanOrEqual(1)
  })

  it('resolves an @handle into a browse id before browsing a channel', async () => {
    const client = createFakeClient()
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await source.channel('@someone')
    expect(client.calls).toContain('resolveURL:https://www.youtube.com/@someone')

    client.calls.length = 0
    await source.channel('UCdirect')
    expect(client.calls.some((call) => call.startsWith('resolveURL:'))).toBe(false)
  })

  it('resolves youtube.com\'s older /c/ and /user/ channel addresses the same way', async () => {
    const client = createFakeClient()
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await source.channel('c/mkbhd')
    await source.channel('user/marquesbrownlee')
    expect(client.calls.filter((call) => call.startsWith('resolveURL:'))).toEqual([
      'resolveURL:https://www.youtube.com/c/mkbhd',
      'resolveURL:https://www.youtube.com/user/marquesbrownlee',
    ])
  })

  it('keeps continuations opaque and replayable', async () => {
    const client = createFakeClient()
    let continuationCalls = 0
    client.getHomeFeed = async () => feed('first', async () => {
      continuationCalls += 1
      return feed('second')
    })
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => client,
    })
    const first = await source.home()
    expect(first.items[0]?.id).toBe('first')
    expect(first.cursor).toBeTruthy()
    const second = await source.home(undefined, first.cursor)
    expect(second.items[0]?.id).toBe('second')
    // urql re-executes a query on remount and on back-navigation, so replaying a cursor must return the same page
    const replay = await source.home(undefined, first.cursor)
    expect(replay.items[0]?.id).toBe('second')
    expect(continuationCalls).toBe(1)
    await expect(source.home(undefined, 'youtube:home:999')).rejects.toThrow('unknown continuation')
  })

  it('opens the shorts pager on the short a deep link names', async () => {
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => createFakeClient(),
    })
    const page = await source.shorts('abc')
    expect(page.items.map((item) => item.id)).toEqual(['abc', 'reel-1', 'reel-2'])
    expect(page.items[0]?.title).toBe('Seed abc')
    expect(page.items[1]?.poster).toBe('reel-1.jpg')
    expect(page.items[1]?.title).toBe('Prefetched title')
    expect(page.items[2]?.title).toBeUndefined()
  })

  it('pages the shorts sequence even though it continues by mutation', async () => {
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => createFakeClient(),
    })
    const first = await source.shorts('abc')
    expect(first.cursor).toBeTruthy()
    const second = await source.shorts(undefined, first.cursor)
    expect(second.items.map((item) => item.id)).toEqual(['reel-page-1'])
    const third = await source.shorts(undefined, second.cursor)
    expect(third.items.map((item) => item.id)).toEqual(['reel-page-2'])
    expect(third.cursor).toBeUndefined()
  })

  it('reads the reel sequence of the tile the pager was opened from, as youtube.com does', async () => {
    const sent: { endpoint: string, args: { sequenceParams?: string } }[] = []
    const actions = {
      execute: async (endpoint: string, args: { sequenceParams?: string }) => {
        sent.push({ endpoint, args })
        const data = endpoint === '/reel/reel_watch_sequence'
          ? { entries: [{ command: { reelWatchEndpoint: { videoId: 'next-in-channel' } } }] }
          : {}
        return { success: true, status_code: 200, data }
      },
    }
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      // the patched youtubei.js itself, which reads the given sequence instead of building the general feed's
      createClient: async () => new Innertube({ actions } as never) as unknown as YoutubeClient,
    })
    const page = await source.shorts('abc', undefined, 'channel-sequence')
    expect(sent.filter((call) => call.endpoint === '/reel/reel_watch_sequence').map((call) => call.args.sequenceParams))
      .toEqual(['channel-sequence'])
    expect(page.items.map((item) => item.id)).toContain('next-in-channel')
  })

  it('seeds a shorts feed with no id from the home shelf', async () => {
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => createFakeClient(),
    })
    const page = await source.shorts()
    expect(page.items[0]?.id).toBe('short-first')
  })

  it('seeds a signed-out shorts feed where youtube.com\'s own guide entry does', async () => {
    const client = createFakeClient()
    client.session.logged_in = false
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => client,
    })
    const page = await source.shorts()
    expect(page.items.map((item) => item.id)).toEqual(['seedless-short', 'reel-1', 'reel-2'])
    expect(client.payloads).toContainEqual({
      endpoint: '/reel/reel_item_watch',
      args: { params: 'CA8=', inputType: 'REEL_WATCH_INPUT_TYPE_SEEDLESS' },
    })
  })

  it('refuses a cursor issued for a different feed', async () => {
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => createFakeClient(),
    })
    const home = await source.home()
    expect(home.cursor).toBeTruthy()
    await expect(source.search('query', undefined, home.cursor)).rejects.toThrow('unknown continuation')
    await expect(source.subscriptions(home.cursor)).rejects.toThrow('unknown continuation')
    const channel = await source.channel('c')
    expect(channel.videos.cursor).toBeTruthy()
    await expect(source.subscriptions(channel.videos.cursor)).rejects.toThrow('belongs to channel')
  })

  it('lets a failed continuation be retried instead of caching the failure', async () => {
    const client = createFakeClient()
    let attempts = 0
    client.getHomeFeed = async () => feed('first', async () => {
      attempts += 1
      if (attempts === 1) throw new Error('network blip')
      return feed('second')
    })
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => client,
    })
    const first = await source.home()
    await expect(source.home(undefined, first.cursor)).rejects.toThrow('network blip')
    await expect(source.home(undefined, first.cursor)).resolves.toMatchObject({ items: [{ id: 'second' }] })
  })

  it('fetches watch metadata through a single /next call', async () => {
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => createFakeClient(),
    })
    await expect(source.watch('abc')).resolves.toMatchObject({
      id: 'abc',
      viewCountText: '42 views',
      related: [],
    })
  })

  it('pages comments with cursors scoped to their video', async () => {
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => createFakeClient(),
    })
    const first = await source.comments('abc')
    expect(first.items[0]?.id).toBe('top')
    expect(first.cursor).toBeTruthy()
    const second = await source.comments('abc', undefined, first.cursor)
    expect(second.items[0]?.id).toBe('next')
    expect(second.cursor).toBeUndefined()
    await expect(source.comments('abc', undefined, first.cursor)).resolves.toMatchObject({ items: [{ id: 'next' }] })
    await expect(source.comments('other', undefined, first.cursor)).rejects.toThrow('belongs to comments:abc')
    await expect(source.comments('abc', 'NEWEST', first.cursor)).rejects.toThrow('belongs to comments:abc:TOP')
  })

  it('reads a post\'s comments by the post and its channel, with cursors scoped to that post and sort', async () => {
    const client = createFakeClient()
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    const first = await source.postComments('post', 'UC1')
    expect(first).toMatchObject({ items: [{ id: 'post-top' }], countText: '1,045 Comments' })
    await expect(source.postComments('post', 'UC1', undefined, first.cursor)).resolves.toMatchObject({ items: [{ id: 'post-next' }] })
    await expect(source.postComments('other', 'UC1', undefined, first.cursor)).rejects.toThrow('belongs to post-comments:post:TOP')
    await expect(source.comments('post', undefined, first.cursor)).rejects.toThrow('belongs to post-comments:post:TOP')
    await source.postComments('post', 'UC1', 'NEWEST')
    expect(client.calls.filter(call => call.startsWith('getPostComments'))).toEqual([
      'getPostComments:post:UC1:TOP_COMMENTS',
      'getPostComments:post:UC1:NEWEST_FIRST',
    ])
  })

  it('heads comments with the full count, not the rounded one', async () => {
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => createFakeClient(),
    })
    await expect(source.comments('abc')).resolves.toMatchObject({ countText: '2,461,151 Comments' })
  })

  it('pages a playlist with cursors scoped to that playlist', async () => {
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => createFakeClient(),
    })
    const first = await source.playlist('PL1')
    expect(first.items[0]?.video.id).toBe('PL1-first')
    expect(first.items[0]?.setVideoId).toBe('set-PL1-first')
    expect(first.items[0]?.index).toBe(1)
    const second = await source.playlist('PL1', first.cursor)
    expect(second.items[0]?.video.id).toBe('PL1-second')
    expect(second.playlist).toEqual(first.playlist)
    await expect(source.playlist('PL2', first.cursor)).rejects.toThrow('belongs to playlist:PL1')
  })

  it('reads playlist details off the first page and covers it with the first row', async () => {
    const client = createFakeClient()
    client.getPlaylist = async (id: string) => ({
      ...playlist(id),
      memo: new Map<string, unknown[]>([['PlaylistVideo', [
        { id: 'row', title: { text: 'Row' }, thumbnails: [{ url: 'cover', width: 640 }] },
      ]]]),
    })
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await expect(source.playlist('PL1')).resolves.toMatchObject({
      playlist: { id: 'PL1', title: 'My playlist', videoCountText: '2 videos', thumbnail: 'cover' },
    })
  })

  it('opens a playlist signed out and gates only the playlist library', async () => {
    const client = createFakeClient()
    client.session.logged_in = false
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await expect(source.playlists()).rejects.toThrow('sign in to see your playlists')
    await expect(source.playlist('PL1')).resolves.toMatchObject({ playlist: { id: 'PL1' } })
  })

  it('pages the playlist library', async () => {
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => createFakeClient(),
    })
    const first = await source.playlists()
    expect(first.items).toEqual([
      { id: 'PLone', title: 'PLone', thumbnail: undefined, videoCountText: '3 videos', channel: undefined },
    ])
    const second = await source.playlists(first.cursor)
    expect(second.items[0]?.id).toBe('PLtwo')
    expect(second.cursor).toBeUndefined()
  })

  it('reports a signed-out session without hitting the account API', async () => {
    const client = createFakeClient()
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => client,
    })
    await expect(source.session()).resolves.toEqual({ signedIn: false, accounts: [] })
    expect(client.calls).toEqual([])
  })

  it("lists the signed-in Google account's channels from WEB's accounts_list, which carries their page IDs", async () => {
    const client = createFakeClient()
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => client,
      signedIn: () => true,
    })
    await expect(source.session()).resolves.toMatchObject({
      signedIn: true,
      name: 'Viewer',
      handle: '@viewer',
      accounts: [
        { brandPageId: undefined, handle: '@viewer', selected: true },
        { brandPageId: BRAND_PAGE_ID, handle: '@viewer-brand', selected: undefined },
      ],
    })
    expect(client.payloads).toEqual([{ endpoint: '/account/accounts_list', args: { client: 'WEB', parse: true } }])
  })

  // Nothing in the type system ties SOURCE_CURSOR_ARGUMENT's index to the real signature, so these cases pin the position
  // commentReplies and relatedVideos are deliberately absent: their ONLY argument is the cursor, so there are no leading arguments
  const CURSOR_CASES: Record<
    Exclude<keyof typeof SOURCE_CURSOR_ARGUMENT, 'commentReplies' | 'relatedVideos'>,
    string[]
  > = {
    home: [undefined as unknown as string],
    shorts: [undefined as unknown as string],
    subscriptions: [],
    history: [],
    clips: [],
    search: ['query', undefined as unknown as string],
    hashtag: ['asmr', undefined as unknown as string],
    channel: ['c', undefined as unknown as string, undefined as unknown as string, undefined as unknown as string],
    comments: ['abc', undefined as unknown as string],
    postComments: ['post', 'UC1', undefined as unknown as string],
    liveChat: ['abc'],
    liveChatReplay: ['abc', 0 as unknown as string, undefined as unknown as string],
    communityPosts: ['c'],
    channelCommunity: ['c', undefined as unknown as string],
    notifications: [],
    playlists: [],
    playlist: ['PL1'],
  }

  for (const [method, leading] of Object.entries(CURSOR_CASES)) {
    it(`reads the ${method} cursor from the argument runtime.ts retries on`, async () => {
      expect(SOURCE_CURSOR_ARGUMENT[method as keyof typeof SOURCE_CURSOR_ARGUMENT]).toBe(leading.length)
      const source = createYoutubeSource({
        fetch: globalThis.fetch,
        createClient: async () => createFakeClient(),
      })
      const call = source[method as keyof typeof CURSOR_CASES] as (...args: unknown[]) => Promise<unknown>
      await call(...leading)
      await expect(call(...leading, 'youtube:bogus')).rejects.toThrow('unknown continuation')
    })
  }

  it('rates a video on the WEB client rather than through the TV-context manager', async () => {
    const client = createFakeClient()
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await expect(source.rateVideo('abc', 'LIKE')).resolves.toMatchObject({ id: 'abc', likeStatus: 'LIKE' })
    await source.rateVideo('abc', 'DISLIKE')
    await source.rateVideo('abc', 'INDIFFERENT')
    expect(client.calls).toEqual(['/like/like', '/like/dislike', '/like/removelike'])
  })

  it('carries playlist context into the /next call and reads the queue back', async () => {
    const client = createFakeClient()
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    const meta = await source.watch('abc', 'PL1', 0)
    // `playlistIndex` is the key /next reads; `index` is only an alias inside WatchNextEndpoint.buildRequest, which execute never runs
    expect(client.payloads[0]?.args).toMatchObject({ videoId: 'abc', playlistId: 'PL1', playlistIndex: 0 })
    expect(client.payloads[0]?.args).not.toHaveProperty('index')
    expect(meta?.playlist).toMatchObject({ id: 'PL1', title: 'Queue', author: 'Owner', currentIndex: 0, isInfinite: false })
    expect(meta?.playlist?.items.map((video) => video.id)).toEqual(['q1', 'q2'])
    expect(meta?.playlist?.items[0]).toMatchObject({ thumbnail: 'q1.jpg', durationSeconds: 61 })
  })

  it('leaves the playlist keys off a watch with no playlist context', async () => {
    const client = createFakeClient()
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    const meta = await source.watch('abc')
    expect(client.payloads[0]?.args).not.toHaveProperty('playlistId')
    expect(client.payloads[0]?.args).not.toHaveProperty('playlistIndex')
    expect(meta?.playlist).toBeUndefined()
  })

  it('edits playlist rows through one endpoint, addressing entries by set video id', async () => {
    const client = createFakeClient()
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await source.addToPlaylist('PL1', ['a', 'b'])
    await source.removeFromPlaylist('PL1', ['set-a'])
    await source.movePlaylistItem('PL1', 'set-b', 'set-a')
    await source.movePlaylistItem('PL1', 'set-b')
    expect(client.calls).toEqual(Array.from({ length: 4 }, () => 'browse/edit_playlist'))
    expect(client.payloads.map((call) => call.args)).toEqual([
      {
        playlistId: 'PL1',
        actions: [
          { action: 'ACTION_ADD_VIDEO', addedVideoId: 'a' },
          { action: 'ACTION_ADD_VIDEO', addedVideoId: 'b' },
        ],
      },
      { playlistId: 'PL1', actions: [{ action: 'ACTION_REMOVE_VIDEO', setVideoId: 'set-a' }] },
      {
        playlistId: 'PL1',
        actions: [{ action: 'ACTION_MOVE_VIDEO_AFTER', setVideoId: 'set-b', movedSetVideoIdPredecessor: 'set-a' }],
      },
      { playlistId: 'PL1', actions: [{ action: 'ACTION_MOVE_VIDEO_AFTER', setVideoId: 'set-b' }] },
    ])
  })

  it('renames through a payload that actually carries the playlist id', async () => {
    const client = createFakeClient()
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await expect(source.renamePlaylist('PL1', 'New name')).resolves.toMatchObject({ id: 'PL1', title: 'New name' })
    // youtubei.js's setName writes the id as snake_case `playlist_id`, which PlaylistEditEndpoint drops, so it has to go out as camelCase `playlistId`
    expect(client.payloads[0]).toEqual({
      endpoint: 'browse/edit_playlist',
      args: { playlistId: 'PL1', actions: [{ action: 'ACTION_SET_PLAYLIST_NAME', playlistName: 'New name' }] },
    })
  })

  it('sets a description and a privacy through the same edit endpoint', async () => {
    const client = createFakeClient()
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await expect(source.setPlaylistDescription('PL1', 'About')).resolves.toMatchObject({ id: 'PL1', description: 'About' })
    await expect(source.setPlaylistPrivacy('PL1', 'UNLISTED')).resolves.toMatchObject({ id: 'PL1', privacy: 'UNLISTED' })
    expect(client.payloads.map((call) => call.args?.actions)).toEqual([
      [{ action: 'ACTION_SET_PLAYLIST_DESCRIPTION', playlistDescription: 'About' }],
      [{ action: 'ACTION_SET_PLAYLIST_PRIVACY', playlistPrivacy: 'UNLISTED' }],
    ])
  })

  it('creates a playlist through the endpoint so privacy and description survive', async () => {
    const client = createFakeClient()
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await expect(source.createPlaylist('Mix', ['a'], 'PRIVATE', 'Notes')).resolves.toEqual({
      id: 'PLnew',
      title: 'Mix',
      description: 'Notes',
      privacy: 'PRIVATE',
    })
    expect(client.payloads[0]).toEqual({
      endpoint: 'playlist/create',
      args: { title: 'Mix', videoIds: ['a'], privacyStatus: 'PRIVATE', description: 'Notes' },
    })
  })

  it('refuses a created playlist whose id did not come back', async () => {
    const client = createFakeClient()
    client.actions.execute = async () => ({
      success: true,
      data: {} as { playlistId?: string },
      contents_memo: new Map<string, unknown[]>(),
      actions_memo: undefined,
    })
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await expect(source.createPlaylist('Mix')).rejects.toThrow('its id did not come back')
  })

  it('deletes through the path youtubei.js cannot reach', async () => {
    const client = createFakeClient()
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    // client.playlist.delete throws before the network in 18.3.0: it builds a raw key with no registered endpoint class
    await expect(source.deletePlaylist('PL1')).resolves.toBe('PL1')
    expect(client.payloads[0]).toEqual({ endpoint: 'playlist/delete', args: { playlistId: 'PL1' } })
  })

  it('carries a read playlist forward into what a write resolves to', async () => {
    const client = createFakeClient()
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await source.playlist('PL1')
    await expect(source.addToPlaylist('PL1', ['a'])).resolves.toMatchObject({ id: 'PL1', title: 'My playlist' })
  })

  it('extracts addedSetVideoId transiently from addToPlaylist without caching it in knownPlaylists', async () => {
    const client = createFakeClient()
    const baseExecute = client.actions.execute
    client.actions.execute = (async (endpoint: string, args?: Record<string, unknown>) => {
      if (endpoint === 'browse/edit_playlist') {
        client.calls.push(endpoint)
        client.payloads.push({ endpoint, args })
        return {
          success: true,
          data: {
            playlistEditResults: [
              { playlistEditVideoAddedResultData: { videoId: 'a', setVideoId: 'added-set-1' } },
            ],
          },
        }
      }
      return baseExecute(endpoint, args as never)
    }) as typeof client.actions.execute
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await source.playlist('PL1')
    const added = await source.addToPlaylist('PL1', ['a'])
    expect(added).toMatchObject({ id: 'PL1', title: 'My playlist', addedSetVideoId: 'added-set-1' })
    const moved = await source.movePlaylistItem('PL1', 'added-set-1', 'prev-set')
    expect(moved.addedSetVideoId).toBeUndefined()
  })

  it('does not POST an edit for an empty selection', async () => {
    const client = createFakeClient()
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await source.addToPlaylist('PL1', [])
    await source.removeFromPlaylist('PL1', [])
    expect(client.payloads).toEqual([])
  })

  it('refuses playlist writes when signed out', async () => {
    const client = createFakeClient()
    client.session.logged_in = false
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await expect(source.addToPlaylist('PL1', ['a'])).rejects.toThrow('sign in to save to a playlist')
    await expect(source.removeFromPlaylist('PL1', ['set-a'])).rejects.toThrow('sign in to change a playlist')
    await expect(source.renamePlaylist('PL1', 'x')).rejects.toThrow('sign in to rename a playlist')
    await expect(source.setPlaylistDescription('PL1', 'x')).rejects.toThrow('sign in to change a playlist description')
    await expect(source.setPlaylistPrivacy('PL1', 'PRIVATE')).rejects.toThrow('sign in to change a playlist privacy')
    await expect(source.movePlaylistItem('PL1', 'set-a')).rejects.toThrow('sign in to reorder a playlist')
    await expect(source.createPlaylist('Mix')).rejects.toThrow('sign in to create a playlist')
    await expect(source.deletePlaylist('PL1')).rejects.toThrow('sign in to delete a playlist')
    expect(client.payloads).toEqual([])
  })

  it('classifies every playlist write as non-replayable', () => {
    const writes = [
      'addToPlaylist',
      'removeFromPlaylist',
      'createPlaylist',
      'deletePlaylist',
      'renamePlaylist',
      'setPlaylistDescription',
      'setPlaylistPrivacy',
      'movePlaylistItem',
    ] as const
    for (const method of writes) expect(SOURCE_REPLAY[method]).toBe('never')
  })

  it('returns the channel with its new subscription state', async () => {
    const client = createFakeClient()
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await expect(source.setSubscribed('c', true)).resolves.toMatchObject({ id: 'c', isSubscribed: true })
    await expect(source.setSubscribed('c', false)).resolves.toMatchObject({ id: 'c', isSubscribed: false })
    await expect(source.setNotificationLevel('c', 'ALL')).resolves.toMatchObject({ id: 'c', notificationLevel: 'ALL' })
    expect(client.calls).toEqual(['subscribe:c', 'unsubscribe:c', 'notifications:c:ALL'])
  })

  it('keeps a loaded channel in step with a subscription write', async () => {
    const client = createFakeClient()
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await source.channel('c')
    const updated = await source.setSubscribed('c', true)
    expect(updated).toMatchObject({ id: 'c', name: 'Channel', isSubscribed: true })
  })

  it('reads a channel again after a subscription or bell write rather than serving the browse from before it', async () => {
    const client = createFakeClient()
    const state = { subscribed: false, level: 'PERSONALIZED' }
    const inner = client.getChannel
    client.getChannel = async () => Object.assign(await inner(), {
      subscribe_button: { subscribed: state.subscribed, notification_preference_button: { current_state_id: state.level } },
    })
    client.interact.subscribe = async () => {
      state.subscribed = true
    }
    client.interact.setNotificationPreferences = async (_channelId: string, level: string) => {
      state.level = level
    }
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    expect((await source.channel('c')).channel).toMatchObject({ isSubscribed: false, notificationLevel: 'PERSONALIZED' })
    await source.setSubscribed('c', true)
    expect((await source.channel('c', 'PLAYLISTS')).channel.isSubscribed).toBe(true)
    await source.setNotificationLevel('c', 'ALL')
    expect((await source.channel('c', 'COMMUNITY')).channel.notificationLevel).toBe('ALL')
  })

  it('keeps a subscription or bell write on the next page of a channel opened by its handle', async () => {
    for (const opened of ['c', '@someone']) {
      const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => createFakeClient() })
      const first = await source.channel(opened)
      await source.setSubscribed(first.channel.id, true)
      await source.setNotificationLevel(first.channel.id, 'ALL')
      const next = await source.channel(opened, undefined, undefined, undefined, first.videos.cursor)
      expect(next.channel, `opened by ${opened}`).toMatchObject({ isSubscribed: true, notificationLevel: 'ALL' })
    }
  })

  it('refuses writes when signed out instead of emitting an opaque innertube error', async () => {
    const client = createFakeClient()
    client.session.logged_in = false
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await expect(source.rateVideo('abc', 'LIKE')).rejects.toThrow('sign in to rate a video')
    await expect(source.setSubscribed('c', true)).rejects.toThrow('sign in to change a subscription')
    expect(client.calls).toEqual([])
  })

  it('groups history by its section headings', async () => {
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => createFakeClient(),
      signedIn: () => true,
    })
    const page = await source.history()
    expect(page.sections.map((section) => section.title)).toEqual(['Today', 'Yesterday'])
    expect(page.sections[0]?.items[0]?.id).toBe('today')
  })

  it('refuses signed-out reads of the account feeds before any request', async () => {
    const client = createFakeClient()
    client.session.logged_in = false
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await expect(source.subscriptions()).rejects.toThrow('sign in to see your subscriptions')
    await expect(source.history()).rejects.toThrow('sign in to see your history')
    await expect(source.subscribedChannels()).rejects.toThrow('sign in to see your subscriptions')
    expect(client.calls).toEqual([])
  })

  it('normalizes the subscribed channel rail off its author node', async () => {
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => createFakeClient(),
      signedIn: () => true,
    })
    await expect(source.subscribedChannels()).resolves.toEqual([
      { id: 'UC1', name: 'Chan', avatar: 'a', handle: undefined, subscriberCountText: undefined, videoCountText: undefined },
    ])
  })

  it('normalizes full Channel nodes from getChannelsFeed with handle, subscribers, description and subscribe state', async () => {
    const client = createFakeClient()
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => ({
        ...client,
        getChannelsFeed: async () => ({
          channels: [{
            id: 'UCfull',
            author: {
              id: 'UCfull',
              name: 'Full Channel',
              thumbnails: [{ url: 'https://yt3.ggpht.com/a', width: 88 }],
              is_verified: true,
            },
            subscriber_count: { text: '@fullchan' },
            video_count: { text: '1.5M subscribers' },
            description_snippet: { text: 'Weekly science videos' },
            subscribe_button: {
              subscribed: true,
              notification_preference_button: { current_state_id: 'SUBSCRIPTION_NOTIFICATION_STATE_ALL' },
            },
          }],
          has_continuation: false,
        }),
      }) as never,
      signedIn: () => true,
    })
    await expect(source.subscribedChannels(true)).resolves.toEqual([{
      id: 'UCfull',
      name: 'Full Channel',
      avatar: 'https://yt3.ggpht.com/a',
      handle: '@fullchan',
      subscriberCountText: '1.5M subscribers',
      videoCountText: undefined,
      description: 'Weekly science videos',
      isSubscribed: true,
      notificationLevel: 'ALL',
      isVerified: true,
      isVerifiedArtist: undefined,
    }])
  })

  it('pages the subscribed channels only when asked for all of them, and stops at 20 pages', async () => {
    let browses = 0
    const channelsPage = (index: number): { channels: unknown[], has_continuation: boolean, getContinuation(): Promise<unknown> } => {
      browses++
      return {
        channels: [
          { author: { id: `UC${index}`, name: `Chan ${index}` } },
          // continuations overlap, so the previous page's last channel comes back
          ...(index > 0 ? [{ author: { id: `UC${index - 1}`, name: `Chan ${index - 1}` } }] : []),
        ],
        has_continuation: true,
        getContinuation: async () => channelsPage(index + 1),
      }
    }
    const client = createFakeClient()
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => ({ ...client, getChannelsFeed: async () => channelsPage(0) }) as never,
    })

    expect((await source.subscribedChannels()).map(channel => channel.id)).toEqual(['UC0'])
    expect(browses).toBe(1)

    browses = 0
    const all = await source.subscribedChannels(true)
    expect(browses).toBe(20)
    expect(all.map(channel => channel.id)).toEqual(Array.from({ length: 20 }, (_, index) => `UC${index}`))
  })

  it('removes from history without needing the page to be open first', async () => {
    const client = createFakeClient()
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => client,
      signedIn: () => true,
    })
    await expect(source.removeFromHistory('today')).resolves.toBe('today')
    expect(client.calls).toContain('removeHistory:today')
  })

  it('fails a history removal YouTube did not process', async () => {
    const client = createFakeClient()
    client.getHistory = async () => ({
      ...feed('watched'),
      sections: [] as { header: { title: string }, contents: { video_id: string, title: { text: string } }[] }[],
      removeVideo: async () => false,
    })
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client, signedIn: () => true })
    await expect(source.removeFromHistory('kept')).rejects.toThrow('not removed from your history')
  })

  it('asks removeVideo to look past the first page', async () => {
    const client = createFakeClient()
    const requested: (number | undefined)[] = []
    client.getHistory = async () => ({
      ...feed('watched'),
      sections: [] as { header: { title: string }, contents: { video_id: string, title: { text: string } }[] }[],
      removeVideo: async (videoId: string, pagesToLoad?: number) => {
        requested.push(pagesToLoad)
        return void videoId
      },
    })
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => client,
      signedIn: () => true,
    })
    await source.removeFromHistory('deep')
    expect(requested[0]).toBeGreaterThan(1)
  })

  it('reads the Home chip bar as youtubei.js parses it, and filters through a chip', async () => {
    const chipRenderer = (label: string, token: string, isSelected: boolean) => ({
      chipCloudChipRenderer: {
        text: { runs: [{ text: label }] },
        isSelected,
        navigationEndpoint: {
          commandMetadata: { webCommandMetadata: { sendPost: true, apiUrl: '/youtubei/v1/browse' } },
          continuationCommand: { token, request: 'CONTINUATION_REQUEST_TYPE_BROWSE' },
        },
      },
    })
    const response = {
      contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { selected: true, content: { richGridRenderer: {
        contents: [],
        header: { feedFilterChipBarRenderer: { contents: [chipRenderer('All', 'ALL', true), chipRenderer('Music', 'MUSIC', false)] } },
      } } } }] } },
    }
    const client = createFakeClient()
    const sent: unknown[] = []
    const actions = {
      session: client.session,
      execute: async (_path: string, args: Record<string, unknown>) => {
        sent.push(args.continuation)
        return Parser.parseResponse(response as never)
      },
    }
    client.getHomeFeed = async () => new YT.HomeFeed(actions as never, { data: response } as never) as never
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await expect(source.home()).resolves.toMatchObject({
      chips: [{ id: 'ALL', label: 'All', selected: true }, { id: 'MUSIC', label: 'Music', selected: false }],
    })
    await source.home('MUSIC')
    expect(sent).toEqual(['MUSIC'])
  })

  it('reads the items of a dropdown chip as Home chips, and filters through one', async () => {
    const listItem = (label: string, token: string, isSelected: boolean) => ({
      listItemViewModel: {
        title: { content: label },
        isSelected,
        rendererContext: { commandContext: { onTap: { innertubeCommand: {
          commandMetadata: { webCommandMetadata: { sendPost: true, apiUrl: '/youtubei/v1/browse' } },
          continuationCommand: { token, request: 'CONTINUATION_REQUEST_TYPE_BROWSE' },
        } } } },
      },
    })
    const response = {
      contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { selected: true, content: { richGridRenderer: {
        contents: [],
        header: { chipBarViewModel: { chips: [{ chipViewModel: {
          text: 'All',
          displayType: 'CHIP_VIEW_MODEL_DISPLAY_TYPE_DROP_DOWN',
          tapCommand: { innertubeCommand: { showSheetCommand: { panelLoadingStrategy: { inlineContent: { sheetViewModel: {
            content: { listViewModel: { listItems: [listItem('All', 'ALL', true), listItem('Music', 'MUSIC', false)] } },
          } } } } } },
        } }] } },
      } } } }] } },
    }
    const client = createFakeClient()
    const sent: unknown[] = []
    const actions = {
      session: client.session,
      execute: async (_path: string, args: Record<string, unknown>) => {
        sent.push(args.continuation)
        return Parser.parseResponse(response as never)
      },
    }
    client.getHomeFeed = async () => new YT.HomeFeed(actions as never, { data: response } as never) as never
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await expect(source.home()).resolves.toMatchObject({
      chips: [{ id: 'ALL', label: 'All', selected: true }, { id: 'MUSIC', label: 'Music', selected: false }],
    })
    await source.home('MUSIC')
    expect(sent).toEqual(['MUSIC'])
  })

  it('survives a feed whose filter_nodes getter throws', async () => {
    const client = createFakeClient()
    client.getHomeFeed = async () => ({
      ...feed('first'),
      // youtubei.js throws from this getter when the response carries more than one chip bar, so optional chaining does not protect the call site
      get filter_nodes (): never { throw new Error('There are too many feed filter chipbars') },
    })
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await expect(source.home()).resolves.toMatchObject({ items: [{ id: 'first' }], chips: [] })
  })

  it('applies Home filter chips using remembered feed endpoints even when each getHomeFeed rotates chip tokens', async () => {
    const chipRenderer = (label: string, token: string, isSelected: boolean) => ({
      chipCloudChipRenderer: {
        text: { runs: [{ text: label }] },
        isSelected,
        navigationEndpoint: {
          commandMetadata: { webCommandMetadata: { sendPost: true, apiUrl: '/youtubei/v1/browse' } },
          continuationCommand: { token, request: 'CONTINUATION_REQUEST_TYPE_BROWSE' },
        },
      },
    })
    const videoRenderer = (id: string, title: string) => ({
      richItemRenderer: { content: { videoRenderer: { videoId: id, title: { runs: [{ text: title }] } } } },
    })
    const lockupRenderer = (id: string, title: string) => ({
      richItemRenderer: {
        content: {
          lockupViewModel: {
            contentId: id,
            contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
            metadata: { lockupMetadataViewModel: { title: { content: title } } },
          },
        },
      },
    })
    const homeResponse = (suffix: string) => ({
      contents: {
        twoColumnBrowseResultsRenderer: {
          tabs: [{
            tabRenderer: {
              selected: true,
              content: {
                richGridRenderer: {
                  contents: [videoRenderer(`unfiltered-${suffix}`, `Unfiltered ${suffix}`)],
                  header: {
                    feedFilterChipBarRenderer: {
                      contents: [
                        chipRenderer('Tous', `ALL_${suffix}`, true),
                        chipRenderer('Musique', `MUSIQUE_${suffix}`, false),
                        chipRenderer('Podcasts', `PODCASTS_${suffix}`, false),
                      ],
                    },
                  },
                },
              },
            },
          }],
        },
      },
    })
    const reloadResponse = (items: unknown[], nextToken?: string) => ({
      onResponseReceivedActions: [{
        reloadContinuationItemsCommand: {
          targetId: 'home-page-grid',
          slot: 'RELOAD_CONTINUATION_SLOT_BODY',
          continuationItems: [
            ...items,
            ...(nextToken
              ? [{
                  continuationItemRenderer: {
                    trigger: 'CONTINUATION_TRIGGER_ON_ITEM_SHOWN',
                    continuationEndpoint: {
                      commandMetadata: { webCommandMetadata: { sendPost: true, apiUrl: '/youtubei/v1/browse' } },
                      continuationCommand: { token: nextToken, request: 'CONTINUATION_REQUEST_TYPE_BROWSE' },
                    },
                  },
                }]
              : []),
          ],
        },
      }],
    })

    const client = createFakeClient()
    let homeCalls = 0
    const sentContinuations: unknown[] = []
    const actions = {
      session: client.session,
      execute: async (_path: string, args: Record<string, unknown>) => {
        sentContinuations.push(args.continuation)
        if (args.continuation === 'MUSIQUE_1') {
          return Parser.parseResponse(reloadResponse([
            videoRenderer('music-video-1', 'Music Video 1'),
            lockupRenderer('music-lockup-2', 'Music Lockup 2'),
          ], 'MUSIQUE_PAGE_2') as never)
        }
        if (args.continuation === 'MUSIQUE_PAGE_2') {
          return Parser.parseResponse({
            onResponseReceivedActions: [{
              appendContinuationItemsAction: {
                targetId: 'home-page-grid',
                continuationItems: [videoRenderer('music-video-3', 'Music Video 3')],
              },
            }],
          } as never)
        }
        if (args.continuation === 'PODCASTS_1') {
          return Parser.parseResponse(reloadResponse([
            videoRenderer('podcast-video-1', 'Podcast Video 1'),
          ]) as never)
        }
        return Parser.parseResponse(reloadResponse([]) as never)
      },
    }
    client.getHomeFeed = async () => {
      homeCalls += 1
      return new YT.HomeFeed(actions as never, { data: homeResponse(String(homeCalls)) } as never) as never
    }

    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    const initial = await source.home()
    expect(homeCalls).toBe(1)
    expect(initial.items.map((item) => item.id)).toEqual(['unfiltered-1'])
    expect(initial.chips).toEqual([
      { id: 'ALL_1', label: 'Tous', selected: true },
      { id: 'MUSIQUE_1', label: 'Musique', selected: false },
      { id: 'PODCASTS_1', label: 'Podcasts', selected: false },
    ])

    const musique = await source.home('MUSIQUE_1')
    expect(homeCalls).toBe(1)
    expect(sentContinuations).toEqual(['MUSIQUE_1'])
    expect(musique.items.map((item) => item.id)).toEqual(['music-video-1', 'music-lockup-2'])
    expect(musique.chips).toEqual([
      { id: 'ALL_1', label: 'Tous', selected: false },
      { id: 'MUSIQUE_1', label: 'Musique', selected: true },
      { id: 'PODCASTS_1', label: 'Podcasts', selected: false },
    ])
    expect(musique.cursor).toBeTruthy()

    const musiquePage2 = await source.home('MUSIQUE_1', musique.cursor)
    expect(musiquePage2.items.map((item) => item.id)).toEqual(['music-video-3'])
    expect(musiquePage2.chips).toEqual([])

    const podcasts = await source.home('PODCASTS_1')
    expect(homeCalls).toBe(1)
    expect(sentContinuations).toEqual(['MUSIQUE_1', 'MUSIQUE_PAGE_2', 'PODCASTS_1'])
    expect(podcasts.items.map((item) => item.id)).toEqual(['podcast-video-1'])
    expect(podcasts.chips).toEqual([
      { id: 'ALL_1', label: 'Tous', selected: false },
      { id: 'MUSIQUE_1', label: 'Musique', selected: false },
      { id: 'PODCASTS_1', label: 'Podcasts', selected: true },
    ])

    const backAll = await source.home()
    expect(homeCalls).toBe(2)
    expect(backAll.items.map((item) => item.id)).toEqual(['unfiltered-2'])
    expect(backAll.chips).toEqual([
      { id: 'ALL_2', label: 'Tous', selected: true },
      { id: 'MUSIQUE_2', label: 'Musique', selected: false },
      { id: 'PODCASTS_2', label: 'Podcasts', selected: false },
    ])
  })

  it('filters ChipView Home bars without calling getHomeFeed a second time', async () => {
    const chipView = (text: string, token: string, selected: boolean) => ({
      chipViewModel: {
        text,
        selected,
        displayType: 'CHIP_VIEW_MODEL_DISPLAY_TYPE_UNSPECIFIED',
        tapCommand: {
          innertubeCommand: {
            commandMetadata: { webCommandMetadata: { sendPost: true, apiUrl: '/youtubei/v1/browse' } },
            continuationCommand: { token, request: 'CONTINUATION_REQUEST_TYPE_BROWSE' },
          },
        },
      },
    })
    const homeResponse = (suffix: string) => ({
      contents: {
        twoColumnBrowseResultsRenderer: {
          tabs: [{
            tabRenderer: {
              selected: true,
              content: {
                richGridRenderer: {
                  contents: [{ richItemRenderer: { content: { videoRenderer: { videoId: `cv-base-${suffix}`, title: { runs: [{ text: 'Base' }] } } } } }],
                  header: {
                    chipBarViewModel: {
                      chips: [
                        chipView('All', `CV_ALL_${suffix}`, true),
                        chipView('Music', `CV_MUSIC_${suffix}`, false),
                      ],
                    },
                  },
                },
              },
            },
          }],
        },
      },
    })
    const client = createFakeClient()
    let homeCalls = 0
    const sent: unknown[] = []
    const actions = {
      session: client.session,
      execute: async (_path: string, args: Record<string, unknown>) => {
        sent.push(args.continuation)
        return Parser.parseResponse({
          onResponseReceivedActions: [{
            reloadContinuationItemsCommand: {
              targetId: 'home-page-grid',
              continuationItems: [
                { richItemRenderer: { content: { videoRenderer: { videoId: 'cv-music-1', title: { runs: [{ text: 'CV Music' }] } } } } },
              ],
            },
          }],
        } as never)
      },
    }
    client.getHomeFeed = async () => {
      homeCalls += 1
      return new YT.HomeFeed(actions as never, { data: homeResponse(String(homeCalls)) } as never) as never
    }
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    await source.home()
    const filtered = await source.home('CV_MUSIC_1')
    expect(homeCalls).toBe(1)
    expect(sent).toEqual(['CV_MUSIC_1'])
    expect(filtered.items.map((item) => item.id)).toEqual(['cv-music-1'])
    expect(filtered.chips).toEqual([
      { id: 'CV_ALL_1', label: 'All', selected: false },
      { id: 'CV_MUSIC_1', label: 'Music', selected: true },
    ])
  })

  it('recovers from stale Home filter feeds and clears cached filters on sign-in changes', async () => {
    const client = createFakeClient()
    let homeCalls = 0
    let failFirstFilter = true
    let isSignedIn = false
    const appliedFromFeed: number[] = []
    client.getHomeFeed = async () => {
      const feedIndex = ++homeCalls
      const chips = [
        { text: 'All', is_selected: true, endpoint: { payload: { token: 'ALL' } } },
        { text: 'Music', is_selected: false, endpoint: { payload: { token: 'MUSIC' } } },
      ]
      return {
        ...feed(`base-${feedIndex}`),
        filter_nodes: { primary_filters: chips },
        memo: new Map<string, unknown[]>(),
        applyFilter: async () => {
          appliedFromFeed.push(feedIndex)
          if (feedIndex === 1 && failFirstFilter) {
            failFirstFilter = false
            throw new Error('expired filter continuation')
          }
          return feed(`music-${feedIndex}`)
        },
      } as never
    }

    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => client,
      signedIn: () => isSignedIn,
    })

    await source.home()
    const recovered = await source.home('MUSIC')
    expect(homeCalls).toBe(2)
    expect(appliedFromFeed).toEqual([1, 2])
    expect(recovered.items.map((item) => item.id)).toEqual(['music-2'])

    const cached = await source.home('MUSIC')
    expect(homeCalls).toBe(2)
    expect(appliedFromFeed).toEqual([1, 2, 2])
    expect(cached.items.map((item) => item.id)).toEqual(['music-2'])

    isSignedIn = true
    const afterSignIn = await source.home('MUSIC')
    expect(homeCalls).toBe(3)
    expect(appliedFromFeed).toEqual([1, 2, 2, 3])
    expect(afterSignIn.items.map((item) => item.id)).toEqual(['music-3'])
  })

  it('covers every cursored method declared to runtime.ts', () => {
    const covered = [...Object.keys(CURSOR_CASES), 'commentReplies', 'relatedVideos']
    expect(covered.sort()).toEqual(Object.keys(SOURCE_CURSOR_ARGUMENT).sort())
  })

  it('pages the watch sidebar from its own continuation', async () => {
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => createFakeClient(),
    })
    const meta = await source.watch('abc')
    expect(meta?.relatedCursor).toBeTruthy()
    const more = await source.relatedVideos(meta!.relatedCursor!)
    expect(more.items[0]?.id).toBe('related-next')
    await expect(source.relatedVideos('youtube:bogus')).rejects.toThrow('unknown continuation')
    const channel = await source.channel('c')
    await expect(source.relatedVideos(channel.videos.cursor!)).rejects.toThrow('not a watch sidebar')
  })

  it('takes only a replies cursor, and says so when handed another feed\'s', async () => {
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => createFakeClient(),
    })
    await expect(source.commentReplies('youtube:bogus')).rejects.toThrow('unknown continuation')
    const list = await source.comments('abc')
    expect(list.cursor).toBeTruthy()
    await expect(source.commentReplies(list.cursor!)).rejects.toThrow('not a reply thread')
  })

  it('opens the replies of a thread whose continuation sits under subThreads', async () => {
    const client = createFakeClient()
    // parsed by youtubei.js itself, which keeps `subThreads` apart from `contents` since 18.0.0
    const thread = new YTNodes.CommentThread({
      commentViewModel: { commentViewModel: { commentId: 'threaded' } },
      replies: {
        commentRepliesRenderer: {
          subThreads: [{
            continuationItemRenderer: {
              continuationEndpoint: {
                commandMetadata: { webCommandMetadata: { sendPost: true, apiUrl: '/youtubei/v1/next' } },
                continuationCommand: { token: 'REPLY_TOKEN', request: 'CONTINUATION_REQUEST_TYPE_WATCH_NEXT' },
              },
            },
          }],
        },
      },
    })
    client.getComments = async () => ({ contents: [thread], has_continuation: false, getContinuation: async () => { throw new Error('no continuation') } }) as never
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    const list = await source.comments('abc')
    expect(list.items[0]?.id).toBe('threaded')
    expect(list.items[0]?.repliesCursor).toBeTruthy()
    await source.commentReplies(list.items[0]!.repliesCursor!)
    expect(client.payloads.at(-1)?.args).toMatchObject({ continuation: 'REPLY_TOKEN' })
  })

  it('preserves nested comment replies and nested cursors inside commentReplies', async () => {
    const client = createFakeClient()
    const baseExecute = client.actions.execute
    client.actions.execute = async (endpoint: string, args?: Record<string, unknown>) => {
      if ((endpoint === 'next' || endpoint.endsWith('/next')) && args?.continuation === 'OUTER_REPLIES_TOKEN') {
        client.payloads.push({ endpoint, args })
        return Parser.parseResponse({
          frameworkUpdates: { entityBatchUpdate: { mutations: [] } },
          onResponseReceivedEndpoints: [{
            appendContinuationItemsAction: {
              continuationItems: [
                {
                  commentThreadRenderer: {
                    commentViewModel: { commentViewModel: { commentId: 'reply-lvl-1' } },
                    replies: {
                      commentRepliesRenderer: {
                        subThreads: [
                          {
                            commentThreadRenderer: {
                              commentViewModel: { commentViewModel: { commentId: 'reply-lvl-2' } },
                            },
                          },
                          {
                            continuationItemRenderer: {
                              continuationEndpoint: {
                                commandMetadata: { webCommandMetadata: { sendPost: true, apiUrl: '/youtubei/v1/next' } },
                                continuationCommand: { token: 'NESTED_REPLIES_TOKEN', request: 'CONTINUATION_REQUEST_TYPE_WATCH_NEXT' },
                              },
                            },
                          },
                        ],
                      },
                    },
                  },
                },
                {
                  continuationItemRenderer: {
                    button: {
                      buttonRenderer: {
                        command: {
                          commandMetadata: { webCommandMetadata: { sendPost: true, apiUrl: '/youtubei/v1/next' } },
                          continuationCommand: { token: 'MORE_OUTER_REPLIES_TOKEN', request: 'CONTINUATION_REQUEST_TYPE_WATCH_NEXT' },
                        },
                      },
                    },
                  },
                },
              ],
            },
          }],
        } as never) as never
      }
      if ((endpoint === 'next' || endpoint.endsWith('/next')) && (args?.continuation === 'NESTED_REPLIES_TOKEN' || args?.continuation === 'MORE_OUTER_REPLIES_TOKEN')) {
        client.payloads.push({ endpoint, args })
        return Parser.parseResponse({
          frameworkUpdates: { entityBatchUpdate: { mutations: [] } },
          onResponseReceivedEndpoints: [{
            appendContinuationItemsAction: {
              continuationItems: [
                {
                  commentThreadRenderer: {
                    commentViewModel: { commentViewModel: { commentId: `from-${String(args.continuation)}` } },
                  },
                },
              ],
            },
          }],
        } as never) as never
      }
      return baseExecute(endpoint, args)
    }
    const thread = new YTNodes.CommentThread({
      commentViewModel: { commentViewModel: { commentId: 'top-thread' } },
      replies: {
        commentRepliesRenderer: {
          subThreads: [{
            continuationItemRenderer: {
              continuationEndpoint: {
                commandMetadata: { webCommandMetadata: { sendPost: true, apiUrl: '/youtubei/v1/next' } },
                continuationCommand: { token: 'OUTER_REPLIES_TOKEN', request: 'CONTINUATION_REQUEST_TYPE_WATCH_NEXT' },
              },
            },
          }],
        },
      },
    })
    client.getComments = async () => ({ contents: [thread], has_continuation: false, getContinuation: async () => { throw new Error('no continuation') } }) as never
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client })
    const list = await source.comments('abc')
    const page = await source.commentReplies(list.items[0]!.repliesCursor!)

    expect(page.items.map(item => item.id)).toEqual(['reply-lvl-1'])
    expect(page.items[0]?.replies?.map(item => item.id)).toEqual(['reply-lvl-2'])
    expect(page.items[0]?.repliesCursor).toBeTruthy()
    expect(page.cursor).toBeTruthy()

    const nestedPage = await source.commentReplies(page.items[0]!.repliesCursor!)
    expect(client.payloads.at(-1)?.args).toMatchObject({ continuation: 'NESTED_REPLIES_TOKEN' })
    expect(nestedPage.items.map(item => item.id)).toEqual(['from-NESTED_REPLIES_TOKEN'])

    const nextOuterPage = await source.commentReplies(page.cursor!)
    expect(client.payloads.at(-1)?.args).toMatchObject({ continuation: 'MORE_OUTER_REPLIES_TOKEN' })
    expect(nextOuterPage.items.map(item => item.id)).toEqual(['from-MORE_OUTER_REPLIES_TOKEN'])
  })

  it('only lets a cursored read opt out of replay through a cursor argument', () => {
    for (const [method, policy] of Object.entries(SOURCE_REPLAY)) {
      if (policy === 'unless-cursor') {
        expect(SOURCE_CURSOR_ARGUMENT).toHaveProperty(method)
      } else {
        expect(SOURCE_CURSOR_ARGUMENT).not.toHaveProperty(method)
      }
    }
  })

  it('stays signed in when the account lookup fails', async () => {
    const client = createFakeClient()
    client.actions.execute = async () => {
      throw new Error('account fetch failed')
    }
    const source = createYoutubeSource({
      fetch: globalThis.fetch,
      createClient: async () => client,
      signedIn: () => true,
    })
    await expect(source.session()).resolves.toEqual({ signedIn: true, accounts: [] })
  })

  it('searches and clears watch history cleanly', async () => {
    const client = createFakeClient()
    let cleared = false
    client.getHistory = async () => ({
      ...feed('watched'),
      sections: [{ header: { title: 'Today' }, contents: [{ video_id: 'v1', title: { text: 'Default' } }] }],
      search: async (query: string) => ({
        ...feed('searched'),
        sections: [{ header: { title: 'Results' }, contents: [{ video_id: 'v2', title: { text: `Match ${query}` } }] }],
      }),
      clearWatchHistory: async () => {
        cleared = true
        return true
      },
    }) as never
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client, signedIn: () => true })
    const searched = await source.history(undefined, 'rust')
    expect(searched.sections[0]?.items[0]?.title).toBe('Match rust')
    await expect(source.clearHistory()).resolves.toBe(true)
    expect(cleared).toBe(true)

    client.getHistory = async () => ({
      ...feed('watched'),
      sections: [],
      clearWatchHistory: async () => false,
    }) as never
    await expect(source.clearHistory()).rejects.toThrow('watch history was not cleared')
  })

  it('submits recommendation feedback tokens through /feedback', async () => {
    const client = createFakeClient()
    client.actions.execute = async (endpoint: string, args: unknown) => {
      client.calls.push(endpoint)
      client.payloads.push({ endpoint, args: (args ?? {}) as Record<string, unknown> })
      return { data: { feedbackResponses: [{ isProcessed: true }] } } as never
    }
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client, signedIn: () => true })
    await expect(source.submitFeedback('fb-token-1')).resolves.toBe(true)
    expect(client.payloads.at(-1)).toEqual({
      endpoint: '/feedback',
      args: {
        feedbackTokens: ['fb-token-1'],
        shouldMerge: false,
        isFeedbackTokenUnencrypted: false,
        parse: false,
      },
    })

    client.actions.execute = async () => ({ data: { feedbackResponses: [{ isProcessed: false }] } }) as never
    await expect(source.submitFeedback('fb-token-2')).rejects.toThrow('could not update your recommendations')
  })

  it('deduplicates clips feed entries across node types and pages via continuation_contents_memo', async () => {
    const client = createFakeClient()
    let execCalls = 0
    let contCalls = 0
    client.actions.execute = async (endpoint: string, args: unknown) => {
      execCalls += 1
      expect(endpoint).toBe('/browse')
      expect(args).toMatchObject({ browseId: 'FEclips', parse: true })
      return {
        contents_memo: new Map<string, unknown[]>([
          ['Video', [{ video_id: 'clip-1', title: { text: 'Clip One' } }]],
          ['GridVideo', [
            { id: 'clip-1', title: { text: 'Duplicate Clip One' } },
            { id: 'clip-2', title: { text: 'Clip Two' } },
          ]],
          ['LockupView', [
            { content_id: 'clip-2', content_type: 'VIDEO', metadata: { title: { text: 'Duplicate Clip Two' } } },
            { content_id: 'clip-3', content_type: 'VIDEO', metadata: { title: { text: 'Clip Three' } } },
          ]],
          ['ContinuationItem', [{
            endpoint: {
              call: async () => {
                contCalls += 1
                return {
                  continuation_contents_memo: new Map<string, unknown[]>([
                    ['Video', [{ video_id: 'clip-4', title: { text: 'Clip Page Two' } }]],
                  ]),
                }
              },
            },
          }]],
        ]),
      } as never
    }
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client, signedIn: () => true })
    const first = await source.clips()
    expect(execCalls).toBe(1)
    expect(first.items.map((item) => item.id)).toEqual(['clip-1', 'clip-2', 'clip-3'])
    expect(first.cursor).toBeTruthy()
    const second = await source.clips(first.cursor)
    expect(contCalls).toBe(1)
    expect(second.items.map((item) => item.id)).toEqual(['clip-4'])
    expect(second.cursor).toBeUndefined()
  })

  it('dismisses notifications via hide menu endpoint while never firing mute/unlabelled items, and returns partial successes', async () => {
    const client = createFakeClient()
    const called: string[] = []
    const emptyPage: FakeNotifications = { contents: [], getContinuation: async () => emptyPage }
    client.getNotifications = async () => ({
      contents: [
        {
          notification_id: 'n-hide',
          short_message: { text: 'Upload 1' },
          sent_time: { text: '1m ago' },
          endpoint: { payload: { videoId: 'v1' } },
          record_click_endpoint: { call: async () => { called.push('click:n-hide') } },
          menu: {
            items: [
              {
                text: 'Turn off all from Channel',
                endpoint: {
                  metadata: { apiUrl: '/youtubei/v1/notification/modify_channel_preference' },
                  call: async () => { called.push('mute:n-hide') },
                },
              },
              {
                icon_type: 'NOTIFICATIONS_OFF',
                endpoint: {
                  payload: { serializedRecordNotificationInteractionsRequest: 'abc' },
                  metadata: { apiUrl: '/youtubei/v1/notification/record_interactions' },
                  call: async () => { called.push('icon-off:n-hide') },
                },
              },
              {
                endpoint: {
                  payload: { serializedRecordNotificationInteractionsRequest: 'xyz' },
                  metadata: { apiUrl: '/youtubei/v1/notification/record_interactions' },
                  call: async () => { called.push('unlabelled:n-hide') },
                },
              },
              {
                text: 'Hide this notification',
                icon_type: 'EYE_OFF',
                endpoint: {
                  metadata: { apiUrl: '/youtubei/v1/notification/record_interactions' },
                  call: async () => { called.push('hide:n-hide') },
                },
              },
            ],
          },
          read: false,
        },
        {
          notification_id: 'n-click-only',
          short_message: { text: 'Upload 2' },
          sent_time: { text: '2m ago' },
          endpoint: { payload: { videoId: 'v2' } },
          record_click_endpoint: { call: async () => { called.push('click:n-click-only') } },
          read: false,
        },
        {
          notification_id: 'n-partial-err',
          short_message: { text: 'Upload 3' },
          sent_time: { text: '3m ago' },
          endpoint: { payload: { videoId: 'v3' } },
          record_click_endpoint: { call: async () => { throw new Error('boom') } },
          read: false,
        },
      ],
      getContinuation: async () => emptyPage,
    })
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client, signedIn: () => true })
    await source.notifications()
    await expect(source.dismissNotifications(['n-hide', 'n-click-only', 'n-partial-err', 'n-hide'])).resolves.toEqual([
      'n-hide',
      'n-click-only',
    ])
    expect(called.sort()).toEqual(['click:n-click-only', 'hide:n-hide'])

    // When every id in a batch fails, reject with the underlying error.
    await expect(source.dismissNotifications(['n-partial-err'])).rejects.toThrow('boom')

    client.session.logged_in = false
    await expect(source.dismissNotifications(['n-hide'])).rejects.toThrow('sign in to dismiss notifications')
  })

  it('handles real NavigationEndpoint snake_case metadata, non-English hide labels, CommandExecutorCommand, and empty recordClickEndpoint', async () => {
    const client = createFakeClient()
    const executed: { path: string, args: unknown }[] = []
    client.actions = {
      execute: async (path: string, args?: unknown) => {
        executed.push({ path, args })
        return { success: true, data: {} }
      },
    } as never

    const frHideEndpoint = new YTNodes.NavigationEndpoint({
      recordNotificationInteractionsEndpoint: { serializedInteractionEntity: 'tok-fr' },
      commandMetadata: { webCommandMetadata: { apiUrl: '/youtubei/v1/notification/record_interactions', sendPost: true } },
    })
    const prefEndpoint = new YTNodes.NavigationEndpoint({
      modifyChannelNotificationPreferenceEndpoint: { params: 'mute-ch' },
      commandMetadata: { webCommandMetadata: { apiUrl: '/youtubei/v1/notification/modify_channel_preference', sendPost: true } },
    })
    const feedbackCmd = { getApiPath: () => 'feedback', buildRequest: () => ({ feedbackTokens: ['fb-1'], isFeedbackTokenUnencrypted: false }) }
    const uiOnlyCmd = { type: 'RemoveFromSection' }
    const cmdExecEndpoint = {
      type: 'NavigationEndpoint',
      command: new YTNodes.CommandExecutorCommand({ commands: [] }),
      call: async () => { throw new Error('must unwrap command.commands instead of calling last element') },
    }
    ;(cmdExecEndpoint.command as unknown as { commands: unknown[] }).commands = [feedbackCmd, uiOnlyCmd]

    const emptyNavNotification = new YTNodes.Notification({
      notificationId: 'n-empty',
      shortMessage: { simpleText: 'No click endpoint upload' },
      sentTimeText: { simpleText: '5m ago' },
    })

    const emptyPage: FakeNotifications = { contents: [], getContinuation: async () => emptyPage }
    client.getNotifications = async () => ({
      contents: [
        {
          notification_id: 'n-fr',
          short_message: { text: 'Upload FR' },
          sent_time: { text: '1m ago' },
          record_click_endpoint: new YTNodes.NavigationEndpoint(undefined as never),
          menu: {
            items: [
              { text: 'Masquer les notifications de cette chaine', endpoint: prefEndpoint },
              { text: 'Masquer cette notification', endpoint: frHideEndpoint },
            ],
          },
        },
        {
          notification_id: 'n-cmd',
          short_message: { text: 'Upload CMD' },
          sent_time: { text: '2m ago' },
          menu: {
            items: [
              { text: 'Hide this notification', endpoint: cmdExecEndpoint },
            ],
          },
        },
        emptyNavNotification,
        {
          notification_id: 'n-pref-only',
          short_message: { text: 'Only channel pref item' },
          sent_time: { text: '6m ago' },
          record_click_endpoint: new YTNodes.NavigationEndpoint(undefined as never),
          menu: {
            items: [
              { text: 'Mute channel', endpoint: prefEndpoint },
            ],
          },
        },
      ],
      getContinuation: async () => emptyPage,
    })

    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client, signedIn: () => true })
    await source.notifications()
    await expect(source.dismissNotifications(['n-fr', 'n-cmd', 'n-empty', 'n-pref-only'])).resolves.toEqual(['n-fr', 'n-cmd', 'n-empty', 'n-pref-only'])
    expect(executed).toEqual([
      { path: 'notification/record_interactions', args: { serializedInteractionEntity: 'tok-fr' } },
      { path: 'feedback', args: { feedbackTokens: ['fb-1'], isFeedbackTokenUnencrypted: false } },
    ])
  })
})
