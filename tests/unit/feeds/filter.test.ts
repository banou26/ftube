import { describe, expect, it } from 'vite-plus/test'

import {
  EMPTY_PAGES_LIMIT,
  isMostRelevantShelfTitle,
  isPastStreamVideo,
  isPremiereVideo,
  isUpcomingVideo,
  isWatchedVideo,
  matchesBlockedChannels,
  matchesBlockedKeywords,
  matchesCustomFilter,
  matchesDurationFilter,
  matchesFeedViewFilter,
  matchesGlobalFeedRules,
  matchesUploadDateRule,
  parseRelativeAgeMs,
  trailingEmptyPages,
} from '../../../src/feeds/filter'
import { DEFAULT_FEED_VIEW_SETTINGS } from '../../../src/feeds/settings'
import { visibleChannelShelves } from '../../../src/routes/channel-rows'
import { visibleSearchRows } from '../../../src/routes/search-results'

const baseSettings = () => structuredClone(DEFAULT_FEED_VIEW_SETTINGS)

describe('feed filtering engine', () => {
  it('parses relative dates across English, French, and ISO timestamps', () => {
    const now = Date.UTC(2026, 10, 27, 12, 0, 0)
    expect(parseRelativeAgeMs('just now', undefined, now)).toBe(0)
    expect(parseRelativeAgeMs("à l'instant", undefined, now)).toBe(0)
    expect(parseRelativeAgeMs('il y a 1 h', undefined, now)).toBe(3_600_000)
    expect(parseRelativeAgeMs('Diffusé il y a 1 j', undefined, now)).toBe(86_400_000)
    expect(parseRelativeAgeMs('il y a 2 sem.', undefined, now)).toBe(2 * 7 * 86_400_000)
    expect(parseRelativeAgeMs('il y a 3 mois', undefined, now)).toBe(3 * 31 * 86_400_000)
    expect(parseRelativeAgeMs('il y a 1 an', undefined, now)).toBe(366 * 86_400_000)
    expect(parseRelativeAgeMs('3 hours ago', undefined, now)).toBe(3 * 3_600_000)
    expect(parseRelativeAgeMs('Streamed 2 days ago', undefined, now)).toBe(2 * 86_400_000)
    expect(parseRelativeAgeMs('5 minutes ago', undefined, now)).toBe(5 * 60_000)
    expect(parseRelativeAgeMs(undefined, '2026-11-27T06:00:00.000Z', now)).toBe(6 * 3_600_000)
  })

  it('detects premieres, upcoming items, past streams, watched progress, and most relevant shelves', () => {
    expect(isPremiereVideo({ badges: ['Premiere'] })).toBe(true)
    expect(isPremiereVideo({ thumbnailBadge: 'Première' })).toBe(true)
    expect(isPremiereVideo({ badges: ['4K'] })).toBe(false)

    expect(isUpcomingVideo({ isUpcoming: true })).toBe(true)
    expect(isUpcomingVideo({ badges: ['Upcoming'] })).toBe(true)
    expect(isUpcomingVideo({ isUpcoming: false, badges: [] })).toBe(false)

    expect(isPastStreamVideo({ isLive: false, publishedText: 'Streamed 3 hours ago' })).toBe(true)
    expect(isPastStreamVideo({ isLive: false, publishedText: 'Diffusé il y a 1 j' })).toBe(true)
    expect(isPastStreamVideo({ isLive: true, publishedText: 'Diffusé il y a 1 j' })).toBe(false)

    expect(isWatchedVideo({ progressPercent: 95 })).toBe(true)
    expect(isWatchedVideo({ progressPercent: 40 })).toBe(false)

    expect(isMostRelevantShelfTitle('Most relevant')).toBe(true)
    expect(isMostRelevantShelfTitle('Les plus pertinents')).toBe(true)
    expect(isMostRelevantShelfTitle('Latest')).toBe(false)
  })

  it('applies duration presets, custom ranges, and upload date presets', () => {
    expect(matchesDurationFilter({ durationSeconds: 180 }, { preset: 'under4' })).toBe(true)
    expect(matchesDurationFilter({ durationSeconds: 600 }, { preset: 'under4' })).toBe(false)
    expect(matchesDurationFilter({ durationSeconds: 600 }, { preset: '4to20' })).toBe(true)
    expect(matchesDurationFilter({ durationSeconds: 1500 }, { preset: 'over20' })).toBe(true)
    expect(matchesDurationFilter({ durationSeconds: 900 }, { preset: 'custom', minMinutes: 10, maxMinutes: 20 })).toBe(true)
    expect(matchesDurationFilter({ durationSeconds: 300 }, { preset: 'custom', minMinutes: 10 })).toBe(false)
    expect(matchesDurationFilter({ durationSeconds: null }, { preset: 'under4' })).toBe(false)

    const now = Date.UTC(2026, 10, 27, 12, 0, 0)
    expect(matchesUploadDateRule({ publishedText: 'il y a 10 h' }, 'today', now)).toBe(true)
    expect(matchesUploadDateRule({ publishedText: 'il y a 3 j' }, 'today', now)).toBe(false)
    expect(matchesUploadDateRule({ publishedText: 'il y a 3 j' }, 'week', now)).toBe(true)
    expect(matchesUploadDateRule({ publishedText: 'il y a 2 sem.' }, 'month', now)).toBe(true)
    expect(matchesUploadDateRule({ publishedText: '2 years ago' }, 'year', now)).toBe(false)
  })

  it('matches blocked keywords and blocked channels across handles, ids, and names', () => {
    const video = {
      title: 'React Compiler Deep Dive',
      descriptionSnippet: 'Sponsored by ExampleCorp',
      channel: { id: 'UC_EXAMPLE', name: 'Tech Cafe', handle: '@techcafe' },
    }
    expect(matchesBlockedKeywords(video, ['compiler'])).toBe(true)
    expect(matchesBlockedKeywords(video, ['examplecorp'])).toBe(true)
    expect(matchesBlockedKeywords(video, ['rust'])).toBe(false)

    expect(matchesBlockedChannels(video, ['UC_EXAMPLE'])).toBe(true)
    expect(matchesBlockedChannels(video, ['@techcafe'])).toBe(true)
    expect(matchesBlockedChannels(video, ['tech cafe'])).toBe(true)
    expect(matchesBlockedChannels(video, ['other'])).toBe(false)
  })

  it('combines hide rules, blocklists, and custom filter buttons cleanly', () => {
    const settings = baseSettings()
    settings.hide.live = true
    settings.hide.premieres = true
    settings.hide.upcoming = true
    settings.hide.pastStreams = true
    settings.hide.watched = true
    settings.hide.mostRelevant = true
    settings.blockedKeywords = ['spoiler']
    settings.blockedChannels = ['@blocked']
    settings.customFilters = [
      {
        id: 'long-rust',
        name: 'Long Rust',
        keyword: 'rust',
        durationPreset: 'over20',
        uploadDate: 'week',
      },
    ]
    settings.activeCustomFilterIds = ['long-rust']

    const match = {
      title: 'Writing Rust Async Runtimes',
      durationSeconds: 1800,
      publishedText: '2 days ago',
      channel: { id: 'UC1', name: 'Systems' },
    }
    expect(matchesFeedViewFilter(match, settings, true)).toBe(true)
    expect(matchesFeedViewFilter({ ...match, isLive: true }, settings, true)).toBe(false)
    expect(matchesFeedViewFilter({ ...match, isShort: true }, settings, true)).toBe(false)
    expect(matchesFeedViewFilter({ ...match, badges: ['Premiere'] }, settings, true)).toBe(false)
    expect(matchesFeedViewFilter({ ...match, isUpcoming: true }, settings, true)).toBe(false)
    expect(matchesFeedViewFilter({ ...match, publishedText: 'Diffusé il y a 1 j' }, settings, true)).toBe(false)
    expect(matchesFeedViewFilter({ ...match, progressPercent: 95 }, settings, true)).toBe(false)
    expect(matchesFeedViewFilter({ ...match, isMostRelevant: true }, settings, true)).toBe(false)
    expect(matchesFeedViewFilter({ ...match, title: 'Rust Spoiler' }, settings, true)).toBe(false)
    expect(matchesFeedViewFilter({ ...match, channel: { id: 'UC2', name: 'X', handle: '@blocked' } }, settings, true)).toBe(false)
    expect(matchesFeedViewFilter({ ...match, durationSeconds: 600 }, settings, true)).toBe(false)
    expect(matchesCustomFilter({ ...match, durationSeconds: 2000 }, settings.customFilters[0]!)).toBe(true)
  })

  it('filters Search rows and Channel shelves for blocked items and Most relevant', () => {
    const settings = baseSettings()
    settings.hide.mostRelevant = true
    settings.blockedKeywords = ['bannedword']
    settings.blockedChannels = ['Spam Channel']

    const shelves = visibleChannelShelves([
      {
        title: 'Most relevant',
        videos: [{ id: 'mr1', title: 'Kept otherwise' }],
        shorts: [],
        playlists: [],
        channels: [],
        games: [],
        posts: [],
      },
      {
        title: 'Videos',
        videos: [
          { id: 'v1', title: 'Normal video' },
          { id: 'v2', title: 'Contains bannedword here' },
        ],
        shorts: [],
        playlists: [],
        channels: [],
        games: [],
        posts: [],
      },
    ], false, settings)
    expect(shelves).toEqual([
      {
        title: 'Videos',
        videos: [{ id: 'v1', title: 'Normal video' }],
        shorts: [],
        playlists: [],
        channels: [],
        games: [],
        posts: [],
      },
    ])

    const searchRows = visibleSearchRows([
      { __typename: 'Video', id: 'sv1', title: 'Normal match' },
      { __typename: 'Video', id: 'sv2', title: 'Bannedword match' },
      { __typename: 'Channel', id: 'UC_SPAM', name: 'Spam Channel' },
      { __typename: 'SearchShelf', title: 'Most relevant', videos: [{ id: 'mr2', title: 'Shelf item' }], shorts: [] },
    ], false, settings)
    expect(searchRows).toEqual([{ __typename: 'Video', id: 'sv1', title: 'Normal match' }])
    expect(matchesGlobalFeedRules({ title: 'Watched in history', progressPercent: 100 }, settings, false, { ignoreWatched: true })).toBe(true)
  })

  it('counts trailing empty pages, honors ignoreBlockedChannels, and keeps upload/duration/block rules safe', () => {
    const pages = [
      { items: [{ id: 'keep-0' }] },
      { items: [{ id: 'skip-1' }] },
      { items: [{ id: 'skip-2' }] },
      { items: [{ id: 'skip-3' }] },
      { items: [{ id: 'skip-4' }] },
      { items: [{ id: 'skip-5' }] },
    ]
    expect(EMPTY_PAGES_LIMIT).toBe(5)
    expect(trailingEmptyPages(pages, item => item.id.startsWith('keep'))).toBe(5)
    expect(trailingEmptyPages(pages.slice(0, 2), item => item.id.startsWith('keep'))).toBe(1)

    // Exact channel name / handle / id matching: short substrings like "TV" or "ai" must not match unrelated names.
    expect(matchesBlockedChannels({ channel: { id: 'UC_A', name: 'Tech Review TV' } }, ['TV'])).toBe(false)
    expect(matchesBlockedChannels({ byline: [{ text: 'Daily AI' }] }, ['ai'])).toBe(false)
    expect(matchesBlockedChannels({ channel: { id: 'UC_B', name: 'Tech Cafe' } }, ['Tech Cafe'])).toBe(true)

    // Live items and unknown upload ages pass upload-date presets; Japanese relative strings parse accurately.
    const now = Date.UTC(2026, 10, 27, 12, 0, 0)
    expect(matchesUploadDateRule({ isLive: true }, 'today', now)).toBe(true)
    expect(matchesUploadDateRule({ publishedText: '3日前' }, 'today', now)).toBe(false)
    expect(matchesUploadDateRule({ publishedText: '3日前' }, 'week', now)).toBe(true)
    expect(matchesUploadDateRule({}, 'today', now)).toBe(true)

    // Reversed custom duration bounds normalize instead of filtering out everything.
    expect(matchesDurationFilter({ durationSeconds: 600 }, { preset: 'custom', minMinutes: 20, maxMinutes: 5 })).toBe(true)
    expect(matchesDurationFilter({ durationSeconds: 120 }, { preset: 'custom', minMinutes: 20, maxMinutes: 5 })).toBe(false)
    expect(matchesDurationFilter({ durationSeconds: 1500 }, { preset: 'custom', minMinutes: 20, maxMinutes: 5 })).toBe(false)

    const settings = baseSettings()
    settings.blockedChannels = ['Spam Channel']
    const ownChannelVideo = {
      title: 'Own Channel Upload',
      progressPercent: 100,
      channel: { id: 'UC_SPAM', name: 'Spam Channel' },
    }
    expect(matchesGlobalFeedRules(ownChannelVideo, settings, false, { ignoreBlockedChannels: true, ignoreWatched: true })).toBe(true)
    expect(matchesFeedViewFilter(ownChannelVideo, settings, false, now, { ignoreBlockedChannels: true })).toBe(true)
  })
})
