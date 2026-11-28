import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import {
  cloneDefaultEmojiPickerSettings,
  coerceEmojiPickerSettings,
  DEFAULT_EMOJI_PICKER_SETTINGS,
  emojiPickerMetrics,
} from '../../../src/components/emoji-picker-settings'

const loadSettings = async (stored?: unknown) => {
  vi.resetModules()
  vi.stubGlobal('localStorage', {
    getItem: () => (stored === undefined ? null : JSON.stringify(stored)),
    setItem: () => {},
  })
  return import('../../../src/settings')
}

describe('emoji picker settings coercion and metrics', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('normalizes invalid values safely and clamps columns to [6, 10]', () => {
    expect(coerceEmojiPickerSettings(null)).toEqual(DEFAULT_EMOJI_PICKER_SETTINGS)
    expect(coerceEmojiPickerSettings('invalid')).toEqual(DEFAULT_EMOJI_PICKER_SETTINGS)

    expect(coerceEmojiPickerSettings({
      defaultSkinTone: 'invalid-tone',
      emojiSize: 'huge',
      columns: Number.NaN,
      pickerHeight: 'enormous',
      defaultCategory: 'Unknown',
      showSearch: 'no',
      showSkinTone: 0,
      showCategories: 'yes',
      showSectionHeaders: null,
      closeOnPick: 1,
    })).toEqual(DEFAULT_EMOJI_PICKER_SETTINGS)

    expect(coerceEmojiPickerSettings({ columns: 99 }).columns).toBe(10)
    expect(coerceEmojiPickerSettings({ columns: 2 }).columns).toBe(6)
    expect(coerceEmojiPickerSettings({ columns: 7.6 }).columns).toBe(8)
    expect(coerceEmojiPickerSettings({
      defaultSkinTone: '\u{1F3FD}',
      emojiSize: 'large',
      columns: 9,
      pickerHeight: 'tall',
      defaultCategory: 'Hearts',
      showSearch: false,
      showSkinTone: false,
      showCategories: false,
      showSectionHeaders: false,
      closeOnPick: true,
    })).toEqual({
      defaultSkinTone: '\u{1F3FD}',
      emojiSize: 'large',
      columns: 9,
      pickerHeight: 'tall',
      defaultCategory: 'Hearts',
      showSearch: false,
      showSkinTone: false,
      showCategories: false,
      showSectionHeaders: false,
      closeOnPick: true,
    })
  })

  it('computes rem metrics and preserves default 34rem width', () => {
    expect(emojiPickerMetrics(cloneDefaultEmojiPickerSettings())).toEqual({
      cellHeightRem: 3.4,
      fontSizeRem: 2,
      customImgRem: 2.2,
      popoverHeightRem: 24,
      inlineHeightRem: 22,
      popoverWidthRem: 34,
    })

    const compactNarrow = emojiPickerMetrics({ emojiSize: 'compact', columns: 6, pickerHeight: 'compact' })
    expect(compactNarrow.popoverWidthRem).toBe(30)
    expect(compactNarrow.popoverHeightRem).toBe(17)

    const largeWide = emojiPickerMetrics({ emojiSize: 'large', columns: 10, pickerHeight: 'tall' })
    expect(largeWide.popoverWidthRem).toBe(44)
    expect(largeWide.popoverHeightRem).toBe(32)
  })

  it('persists emojiPicker updates in settings store and resets to defaults', async () => {
    const initial = (await loadSettings()).getSettings().emojiPicker
    expect(initial).toEqual(DEFAULT_EMOJI_PICKER_SETTINGS)

    const written: string[] = []
    vi.resetModules()
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: (_key: string, value: string) => written.push(value) })
    const { updateSettings, resetEmojiPickerCustomization } = await import('../../../src/settings')

    const updated = updateSettings({
      emojiPicker: {
        ...DEFAULT_EMOJI_PICKER_SETTINGS,
        defaultSkinTone: '\u{1F3FF}',
        emojiSize: 'large',
        columns: 6,
        pickerHeight: 'tall',
        defaultCategory: 'Hearts',
        showSectionHeaders: false,
        closeOnPick: true,
      },
    })
    expect(updated.emojiPicker.defaultCategory).toBe('Hearts')
    const savedUpdated = JSON.parse(written.at(-1)!)

    const reset = resetEmojiPickerCustomization()
    expect(reset.emojiPicker).toEqual(DEFAULT_EMOJI_PICKER_SETTINGS)
    const savedReset = JSON.parse(written.at(-1)!)

    expect((await loadSettings(savedUpdated)).getSettings().emojiPicker).toEqual(updated.emojiPicker)
    expect((await loadSettings(savedReset)).getSettings().emojiPicker).toEqual(DEFAULT_EMOJI_PICKER_SETTINGS)
  })
})
