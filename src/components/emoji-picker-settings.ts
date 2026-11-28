export type EmojiCategory =
  | 'Smileys'
  | 'Gestures'
  | 'Hearts'
  | 'Nature'
  | 'Food'
  | 'Travel'
  | 'Activities'
  | 'Objects'

export const EMOJI_CATEGORIES: readonly EmojiCategory[] = [
  'Smileys',
  'Gestures',
  'Hearts',
  'Nature',
  'Food',
  'Travel',
  'Activities',
  'Objects',
]

export type SkinToneModifier =
  | ''
  | '\u{1F3FB}'
  | '\u{1F3FC}'
  | '\u{1F3FD}'
  | '\u{1F3FE}'
  | '\u{1F3FF}'

export type SkinToneOption = {
  modifier: SkinToneModifier
  label: string
  shortLabel: string
  color: string
}

export const SKIN_TONES: readonly SkinToneOption[] = [
  { modifier: '', label: 'Default skin tone', shortLabel: 'Default', color: '#ffc83d' },
  { modifier: '\u{1F3FB}', label: 'Light skin tone', shortLabel: 'Light', color: '#f7d7c4' },
  { modifier: '\u{1F3FC}', label: 'Medium-light skin tone', shortLabel: 'Medium-light', color: '#d8b094' },
  { modifier: '\u{1F3FD}', label: 'Medium skin tone', shortLabel: 'Medium', color: '#bb9167' },
  { modifier: '\u{1F3FE}', label: 'Medium-dark skin tone', shortLabel: 'Medium-dark', color: '#8e562e' },
  { modifier: '\u{1F3FF}', label: 'Dark skin tone', shortLabel: 'Dark', color: '#613d30' },
]

export type EmojiPickerSize = 'compact' | 'medium' | 'large'
export type EmojiPickerHeight = 'compact' | 'medium' | 'tall'

/** Persisted layout, behavior, and default state options for the emoji picker. */
export type EmojiPickerSettings = {
  defaultSkinTone: SkinToneModifier
  emojiSize: EmojiPickerSize
  columns: number
  pickerHeight: EmojiPickerHeight
  defaultCategory: EmojiCategory
  showSearch: boolean
  showSkinTone: boolean
  showCategories: boolean
  showSectionHeaders: boolean
  closeOnPick: boolean
}

export const EMOJI_PICKER_SIZES: readonly { value: EmojiPickerSize, label: string }[] = [
  { value: 'compact', label: 'Compact' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
]

export const EMOJI_PICKER_HEIGHTS: readonly { value: EmojiPickerHeight, label: string }[] = [
  { value: 'compact', label: 'Compact' },
  { value: 'medium', label: 'Medium' },
  { value: 'tall', label: 'Tall' },
]

export const EMOJI_PICKER_COLUMNS = [6, 7, 8, 9, 10] as const

export const DEFAULT_EMOJI_PICKER_SETTINGS: EmojiPickerSettings = {
  defaultSkinTone: '',
  emojiSize: 'medium',
  columns: 8,
  pickerHeight: 'medium',
  defaultCategory: 'Smileys',
  showSearch: true,
  showSkinTone: true,
  showCategories: true,
  showSectionHeaders: true,
  closeOnPick: false,
}

const SKIN_TONE_SET = new Set<string>(SKIN_TONES.map(tone => tone.modifier))
const SIZE_SET = new Set<string>(EMOJI_PICKER_SIZES.map(size => size.value))
const HEIGHT_SET = new Set<string>(EMOJI_PICKER_HEIGHTS.map(height => height.value))
const CATEGORY_SET = new Set<string>(EMOJI_CATEGORIES)

/** Returns a fresh copy of the default emoji picker settings. */
export const cloneDefaultEmojiPickerSettings = (): EmojiPickerSettings => ({
  ...DEFAULT_EMOJI_PICKER_SETTINGS,
})

/** Normalizes persisted or partial emoji picker settings to safe bounds and valid enum values. */
export const coerceEmojiPickerSettings = (raw: unknown): EmojiPickerSettings => {
  if (!raw || typeof raw !== 'object') return cloneDefaultEmojiPickerSettings()
  const record = raw as Partial<Record<keyof EmojiPickerSettings, unknown>>
  const columns = typeof record.columns === 'number' && Number.isFinite(record.columns)
    ? Math.min(10, Math.max(6, Math.round(record.columns)))
    : DEFAULT_EMOJI_PICKER_SETTINGS.columns
  return {
    defaultSkinTone: typeof record.defaultSkinTone === 'string' && SKIN_TONE_SET.has(record.defaultSkinTone)
      ? record.defaultSkinTone as SkinToneModifier
      : DEFAULT_EMOJI_PICKER_SETTINGS.defaultSkinTone,
    emojiSize: typeof record.emojiSize === 'string' && SIZE_SET.has(record.emojiSize)
      ? record.emojiSize as EmojiPickerSize
      : DEFAULT_EMOJI_PICKER_SETTINGS.emojiSize,
    columns,
    pickerHeight: typeof record.pickerHeight === 'string' && HEIGHT_SET.has(record.pickerHeight)
      ? record.pickerHeight as EmojiPickerHeight
      : DEFAULT_EMOJI_PICKER_SETTINGS.pickerHeight,
    defaultCategory: typeof record.defaultCategory === 'string' && CATEGORY_SET.has(record.defaultCategory)
      ? record.defaultCategory as EmojiCategory
      : DEFAULT_EMOJI_PICKER_SETTINGS.defaultCategory,
    showSearch: typeof record.showSearch === 'boolean'
      ? record.showSearch
      : DEFAULT_EMOJI_PICKER_SETTINGS.showSearch,
    showSkinTone: typeof record.showSkinTone === 'boolean'
      ? record.showSkinTone
      : DEFAULT_EMOJI_PICKER_SETTINGS.showSkinTone,
    showCategories: typeof record.showCategories === 'boolean'
      ? record.showCategories
      : DEFAULT_EMOJI_PICKER_SETTINGS.showCategories,
    showSectionHeaders: typeof record.showSectionHeaders === 'boolean'
      ? record.showSectionHeaders
      : DEFAULT_EMOJI_PICKER_SETTINGS.showSectionHeaders,
    closeOnPick: typeof record.closeOnPick === 'boolean'
      ? record.closeOnPick
      : DEFAULT_EMOJI_PICKER_SETTINGS.closeOnPick,
  }
}

const SIZE_METRICS: Record<EmojiPickerSize, { cellHeightRem: number, fontSizeRem: number, customImgRem: number }> = {
  compact: { cellHeightRem: 3, fontSizeRem: 1.75, customImgRem: 1.9 },
  medium: { cellHeightRem: 3.4, fontSizeRem: 2, customImgRem: 2.2 },
  large: { cellHeightRem: 4.2, fontSizeRem: 2.5, customImgRem: 2.8 },
}

const HEIGHT_METRICS: Record<EmojiPickerHeight, { popoverHeightRem: number, inlineHeightRem: number }> = {
  compact: { popoverHeightRem: 17, inlineHeightRem: 16 },
  medium: { popoverHeightRem: 24, inlineHeightRem: 22 },
  tall: { popoverHeightRem: 32, inlineHeightRem: 28 },
}

/** Computes rem layout metrics and clamped popover width for a given emoji picker configuration. */
export const emojiPickerMetrics = (
  settings: Pick<EmojiPickerSettings, 'emojiSize' | 'columns' | 'pickerHeight'>,
) => {
  const size = SIZE_METRICS[settings.emojiSize]
  const height = HEIGHT_METRICS[settings.pickerHeight]
  const rawWidth = settings.columns * size.cellHeightRem + (settings.columns - 1) * 0.2 + 5.4
  const popoverWidthRem = Math.min(44, Math.max(30, Math.round(rawWidth * 10) / 10))
  return {
    ...size,
    ...height,
    popoverWidthRem,
  }
}
