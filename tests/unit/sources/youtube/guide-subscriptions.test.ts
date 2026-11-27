import { describe, expect, it } from 'vite-plus/test'

import { createYoutubeSource } from '../../../../src/sources/youtube'
import { parseGuideSubscriptions, sortGuideSubscriptions } from '../../../../src/sources/youtube/normalize'

describe('parseGuideSubscriptions', () => {
  it('extracts direct and collapsible subscription channel entries while ignoring guide navigation items', () => {
    const raw = {
      items: [
        { guideSectionRenderer: { items: [{ guideEntryRenderer: { navigationEndpoint: { browseEndpoint: { browseId: 'FEwhat_to_watch' } }, formattedTitle: { simpleText: 'Home' } } }] } },
        {
          guideSubscriptionsSectionRenderer: {
            items: [
              {
                guideEntryRenderer: {
                  navigationEndpoint: { browseEndpoint: { browseId: 'FEchannels' } },
                  formattedTitle: { simpleText: 'All subscriptions' },
                },
              },
              {
                guideEntryRenderer: {
                  navigationEndpoint: { browseEndpoint: { browseId: 'UCnormal1' } },
                  formattedTitle: { simpleText: 'Normal One' },
                  thumbnail: { thumbnails: [{ url: '//yt3.ggpht.com/n1.jpg', width: 88 }] },
                },
              },
              {
                guideEntryRenderer: {
                  navigationEndpoint: { browseEndpoint: { browseId: 'UClive1' } },
                  formattedTitle: { runs: [{ text: 'Live Streamer' }] },
                  thumbnail: { thumbnails: [{ url: 'https://yt3.ggpht.com/l1.jpg', width: 88 }] },
                  presentationStyle: 'GUIDE_ENTRY_PRESENTATION_STYLE_NEW_CONTENT',
                  badges: { liveBroadcasting: true },
                },
              },
              {
                guideCollapsibleEntryRenderer: {
                  expandableItems: [
                    {
                      guideEntryRenderer: {
                        navigationEndpoint: { browseEndpoint: { browseId: 'UCfresh1' } },
                        formattedTitle: { simpleText: 'Fresh Creator' },
                        thumbnail: { thumbnails: [{ url: 'https://yt3.ggpht.com/f1.jpg', width: 88 }] },
                        presentationStyle: 'GUIDE_ENTRY_PRESENTATION_STYLE_NEW_CONTENT',
                      },
                    },
                    {
                      guideEntryRenderer: {
                        navigationEndpoint: { browseEndpoint: { browseId: 'FEguide_builder' } },
                        formattedTitle: { simpleText: 'Browse channels' },
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    }

    expect(parseGuideSubscriptions(raw)).toEqual([
      { id: 'UCnormal1', name: 'Normal One', avatar: 'https://yt3.ggpht.com/n1.jpg' },
      { id: 'UClive1', name: 'Live Streamer', avatar: 'https://yt3.ggpht.com/l1.jpg', isLive: true },
      { id: 'UCfresh1', name: 'Fresh Creator', avatar: 'https://yt3.ggpht.com/f1.jpg', hasNewContent: true },
    ])
  })
})

describe('sortGuideSubscriptions', () => {
  it('places live channels first, new-content second, and keeps relative order within each group', () => {
    const input = [
      { id: '1', name: 'Plain A' },
      { id: '2', name: 'New A', hasNewContent: true },
      { id: '3', name: 'Live A', isLive: true },
      { id: '4', name: 'Plain B' },
      { id: '5', name: 'Live B', isLive: true, hasNewContent: true },
      { id: '6', name: 'New B', hasNewContent: true },
    ]
    expect(sortGuideSubscriptions(input).map(ch => ch.id)).toEqual(['3', '5', '2', '6', '1', '4'])
  })
})

describe('subscribedChannels guide vs channels feed', () => {
  it('uses /guide when available for sidebar subscriptions and falls back to getChannelsFeed on empty or error', async () => {
    const client = {
      session: { logged_in: true, context: { client: { hl: 'en', gl: 'US' } } },
      actions: {
        execute: async (endpoint: string) => {
          if (endpoint !== '/guide') throw new Error('unexpected endpoint')
          return {
            data: {
              items: [{
                guideSubscriptionsSectionRenderer: {
                  items: [
                    {
                      guideEntryRenderer: {
                        navigationEndpoint: { browseEndpoint: { browseId: 'UCplain' } },
                        formattedTitle: { simpleText: 'Plain Guide' },
                      },
                    },
                    {
                      guideEntryRenderer: {
                        navigationEndpoint: { browseEndpoint: { browseId: 'UClive' } },
                        formattedTitle: { simpleText: 'Live Guide' },
                        badges: { liveBroadcasting: true },
                      },
                    },
                  ],
                },
              }],
            },
          }
        },
      },
      getChannelsFeed: async () => ({
        channels: [{ id: 'UCfeed', author: { id: 'UCfeed', name: 'Feed Channel' } }],
        has_continuation: false,
      }),
    }
    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client as never })
    expect(await source.subscribedChannels()).toEqual([
      { id: 'UClive', name: 'Live Guide', avatar: undefined, isLive: true },
      { id: 'UCplain', name: 'Plain Guide', avatar: undefined },
    ])
    expect(await source.subscribedChannels(true)).toEqual([
      {
        id: 'UCfeed',
        name: 'Feed Channel',
        avatar: undefined,
        handle: undefined,
        isVerified: undefined,
        isVerifiedArtist: undefined,
        subscriberCountText: undefined,
        description: undefined,
        isSubscribed: undefined,
        notificationLevel: undefined,
      },
    ])

    client.actions.execute = async () => {
      throw new Error('guide unavailable')
    }
    expect((await source.subscribedChannels()).map(ch => ch.id)).toEqual(['UCfeed'])
  })
})

describe('channelLiveVideo', () => {
  it('resolves /live directly to a videoId for channel IDs and handle paths, with getChannel fallback', async () => {
    const resolvedUrls: string[] = []
    let getChannelCalls = 0
    let resolveResult: unknown = { payload: { videoId: 'live-direct-1' } }
    let channelResult: unknown = {
      metadata: { external_id: 'UC_OFF' },
      header: {},
      has_live_streams: false,
    }

    const client = {
      session: { logged_in: false, context: { client: { hl: 'en', gl: 'US' } } },
      resolveURL: async (url: string) => {
        resolvedUrls.push(url)
        return resolveResult
      },
      getChannel: async () => {
        getChannelCalls += 1
        return channelResult
      },
    }

    const source = createYoutubeSource({ fetch: globalThis.fetch, createClient: async () => client as never })
    expect(await source.channelLiveVideo('UC_LIVE')).toBe('live-direct-1')
    expect(await source.channelLiveVideo('@LiveHandle')).toBe('live-direct-1')
    expect(resolvedUrls).toEqual([
      'https://www.youtube.com/channel/UC_LIVE/live',
      'https://www.youtube.com/@LiveHandle/live',
    ])
    expect(getChannelCalls).toBe(0)

    // When resolveURL returns a channel browseEndpoint instead of a watch videoId, fall back to channel metadata/Live tab.
    resolveResult = { payload: { browseId: 'UC_HEADER' } }
    channelResult = {
      metadata: { external_id: 'UC_HEADER' },
      header: {
        content: {
          image: {
            renderer_context: { command_context: { on_tap: { payload: { videoId: 'live-header-2' } } } },
          },
        },
      },
    }
    expect(await source.channelLiveVideo('UC_HEADER')).toBe('live-header-2')
    expect(getChannelCalls).toBe(1)

    // Offline channels return undefined cleanly even when resolveURL errors.
    client.resolveURL = async () => {
      throw new Error('404')
    }
    channelResult = {
      metadata: { external_id: 'UC_OFF' },
      header: {},
      has_live_streams: false,
    }
    expect(await source.channelLiveVideo('UC_OFF')).toBeUndefined()
  })
})
