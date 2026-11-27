import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import {
  addBlockedChannel,
  addBlockedKeyword,
  addCustomFeedFilter,
  DEFAULT_GRID_CARD_STYLE,
  DEFAULT_LIST_CARD_STYLE,
  feedCardCssVars,
  getFeedViewSettings,
  reloadFeedViewSettings,
  removeBlockedChannel,
  removeBlockedKeyword,
  removeCustomFeedFilter,
  resetFeedCardStyle,
  resetFeedViewSettings,
  setFeedLayout,
  toggleCustomFeedFilter,
  updateFeedCardStyle,
} from '../../../src/feeds/settings'

describe('feed view settings store', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value) },
      removeItem: (key: string) => { store.delete(key) },
      clear: () => { store.clear() },
    })
    resetFeedViewSettings()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stores separate Grid and List layouts for Subscriptions, Channel Videos, and Home', () => {
    expect(getFeedViewSettings().layouts).toEqual({
      subscriptions: 'grid',
      channel: 'grid',
      home: 'grid',
      other: 'grid',
    })

    setFeedLayout('subscriptions', 'list')
    expect(getFeedViewSettings().layouts.subscriptions).toBe('list')
    expect(getFeedViewSettings().layouts.channel).toBe('grid')

    setFeedLayout('channel', 'list')
    expect(getFeedViewSettings().layouts.channel).toBe('list')

    setFeedLayout('subscriptions', 'grid')
    expect(getFeedViewSettings().layouts.subscriptions).toBe('grid')
    expect(getFeedViewSettings().layouts.channel).toBe('list')

    reloadFeedViewSettings()
    expect(getFeedViewSettings().layouts).toMatchObject({ subscriptions: 'grid', channel: 'list' })
  })

  it('edits and resets Grid and List card styles independently', () => {
    updateFeedCardStyle('list', {
      thumbSize: 300,
      thumbPosition: 'end',
      cardWidth: 960,
      titleSize: 20,
      titleColor: '#3ea6ff',
      boldTitle: true,
      font: 'serif',
      metaColor: '#cccccc',
      descriptionLines: 3,
      rowGap: 24,
      cornerRadius: 4,
    })

    const listVars = feedCardCssVars('list', getFeedViewSettings().cardStyles.list)
    expect(listVars).toEqual({
      '--feed-list-thumb-width': '300px',
      '--feed-list-max-width': '960px',
      '--feed-row-gap': '24px',
      '--feed-title-size': '20px',
      '--feed-title-weight': '700',
      '--feed-title-color': '#3ea6ff',
      '--feed-meta-color': '#cccccc',
      '--feed-font-family': "Georgia, Cambria, 'Times New Roman', serif",
      '--feed-thumb-radius': '4px',
    })

    // Default Grid remains untouched so existing grid card geometry does not shift.
    expect(feedCardCssVars('grid', DEFAULT_GRID_CARD_STYLE)).toEqual({})

    resetFeedCardStyle('list')
    expect(getFeedViewSettings().cardStyles.list).toEqual(DEFAULT_LIST_CARD_STYLE)
  })

  it('manages blocked keywords, blocked channels, and custom filter buttons cleanly', () => {
    addBlockedKeyword('Clickbait')
    addBlockedKeyword('clickbait')
    expect(getFeedViewSettings().blockedKeywords).toEqual(['Clickbait'])
    removeBlockedKeyword('CLICKBAIT')
    expect(getFeedViewSettings().blockedKeywords).toEqual([])

    addBlockedChannel('@noisy')
    expect(getFeedViewSettings().blockedChannels).toEqual(['@noisy'])
    removeBlockedChannel('@noisy')
    expect(getFeedViewSettings().blockedChannels).toEqual([])

    const afterAdd = addCustomFeedFilter({
      name: 'Short Podcasts',
      keyword: 'podcast',
      durationPreset: 'under4',
      uploadDate: 'week',
    })
    expect(afterAdd.customFilters).toHaveLength(1)
    const id = afterAdd.customFilters[0]!.id

    toggleCustomFeedFilter(id)
    expect(getFeedViewSettings().activeCustomFilterIds).toEqual([id])
    removeCustomFeedFilter(id)
    expect(getFeedViewSettings().customFilters).toEqual([])
    expect(getFeedViewSettings().activeCustomFilterIds).toEqual([])

    const reversedCustom = addCustomFeedFilter({
      name: 'Mid Length',
      keyword: '',
      durationPreset: 'custom',
      minMinutes: 20,
      maxMinutes: 5,
      uploadDate: 'any',
    })
    expect(reversedCustom.customFilters[0]).toMatchObject({ minMinutes: 5, maxMinutes: 20 })
  })

  it('coerces corrupted localStorage values without throwing', () => {
    localStorage.setItem('yt-client:feed-view', '{"layouts":{"subscriptions":"bogus"},"cardStyles":{"list":{"thumbSize":9999,"titleColor":"not-a-hex"}}}')
    const recovered = reloadFeedViewSettings()
    expect(recovered.layouts.subscriptions).toBe('grid')
    expect(recovered.cardStyles.list.thumbSize).toBe(420)
    expect(recovered.cardStyles.list.titleColor).toBe('')
  })
})
