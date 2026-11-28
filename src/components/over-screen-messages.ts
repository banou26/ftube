import { useEffect, useState } from 'preact/hooks'

export type OverlayTextAnimation = 'scroll' | 'shake' | 'pop' | 'bounce' | 'fade'
export type OverlayEmojiAnimation = 'burst' | 'shatter' | 'bounce' | 'scroll' | 'fade'
export type OverlayFontFamily = 'system' | 'rounded' | 'mono' | 'serif' | 'display'
export type OverlayMessageKind = 'emoji-only' | 'caps' | 'question' | 'exclamation' | 'normal'

export type OverScreenSettings = {
  enabled: boolean
  textAnimation: OverlayTextAnimation
  emojiAnimation: OverlayEmojiAnimation
  capsAnimation: OverlayTextAnimation
  questionAnimation: OverlayTextAnimation
  exclamationAnimation: OverlayTextAnimation
  fontFamily: OverlayFontFamily
  fontSizePx: number
  speed: number
  opacity: number
  showAvatar: boolean
  showAuthor: boolean
  emojiOnlyEnlarged: boolean
  styleByType: boolean
  slowModeMs: number
  maxOnScreen: number
}

export const OVERLAY_TEXT_ANIMATIONS: { value: OverlayTextAnimation, label: string }[] = [
  { value: 'scroll', label: 'Scroll across' },
  { value: 'shake', label: 'Shake' },
  { value: 'pop', label: 'Pop in' },
  { value: 'bounce', label: 'Bounce' },
  { value: 'fade', label: 'Fade' },
]

export const OVERLAY_EMOJI_ANIMATIONS: { value: OverlayEmojiAnimation, label: string }[] = [
  { value: 'burst', label: 'Burst' },
  { value: 'shatter', label: 'Shatter' },
  { value: 'bounce', label: 'Bounce' },
  { value: 'scroll', label: 'Scroll across' },
  { value: 'fade', label: 'Fade' },
]

export const OVERLAY_TYPE_ANIMATION_FIELDS: readonly {
  kind: Exclude<OverlayMessageKind, 'emoji-only' | 'normal'>
  key: 'capsAnimation' | 'questionAnimation' | 'exclamationAnimation'
  label: string
}[] = [
  { kind: 'caps', key: 'capsAnimation', label: 'ALL CAPS animation' },
  { kind: 'question', key: 'questionAnimation', label: 'Question animation' },
  { kind: 'exclamation', key: 'exclamationAnimation', label: 'Exclamation animation' },
]

export const OVERLAY_FONT_FAMILIES: { value: OverlayFontFamily, label: string }[] = [
  { value: 'system', label: 'Default sans' },
  { value: 'rounded', label: 'Rounded' },
  { value: 'mono', label: 'Monospace' },
  { value: 'serif', label: 'Serif' },
  { value: 'display', label: 'Display bold' },
]

export const OVERLAY_FONT_STACKS: Record<OverlayFontFamily, string> = {
  system: "'Roboto', system-ui, -apple-system, sans-serif",
  rounded: "'ui-rounded', 'Hiragino Maru Gothic ProN', 'Quicksand', 'Roboto', sans-serif",
  mono: "ui-monospace, 'SFMono-Regular', 'Menlo', monospace",
  serif: "'Georgia', 'Times New Roman', serif",
  display: "'Impact', 'Arial Black', 'Roboto', sans-serif",
}

export const DEFAULT_OVER_SCREEN_SETTINGS: OverScreenSettings = {
  enabled: false,
  textAnimation: 'scroll',
  emojiAnimation: 'burst',
  capsAnimation: 'pop',
  questionAnimation: 'bounce',
  exclamationAnimation: 'pop',
  fontFamily: 'system',
  fontSizePx: 28,
  speed: 1,
  opacity: 0.92,
  showAvatar: true,
  showAuthor: true,
  emojiOnlyEnlarged: true,
  styleByType: true,
  slowModeMs: 0,
  maxOnScreen: 16,
}

const STORAGE_KEY = 'yt-client:over-screen-messages'
const TEXT_ANIMATION_SET = new Set<string>(OVERLAY_TEXT_ANIMATIONS.map(item => item.value))
const EMOJI_ANIMATION_SET = new Set<string>(OVERLAY_EMOJI_ANIMATIONS.map(item => item.value))
const FONT_FAMILY_SET = new Set<string>(OVERLAY_FONT_FAMILIES.map(item => item.value))

const TYPE_ANIMATION_KEYS = {
  caps: 'capsAnimation',
  question: 'questionAnimation',
  exclamation: 'exclamationAnimation',
} as const

const coerceTextAnimation = (value: unknown, fallback: OverlayTextAnimation): OverlayTextAnimation => (
  typeof value === 'string' && TEXT_ANIMATION_SET.has(value)
    ? value as OverlayTextAnimation
    : fallback
)

const clampNumber = (value: unknown, fallback: number, min: number, max: number, round = true): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const bounded = Math.min(max, Math.max(min, value))
  return round ? Math.round(bounded) : bounded
}

/** Normalizes persisted or partial over-screen chat settings to safe defaults and bounds. */
export const coerceOverScreenSettings = (
  raw: Partial<Record<keyof OverScreenSettings, unknown>> | null | undefined,
): OverScreenSettings => {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_OVER_SCREEN_SETTINGS }
  const showAuthor = typeof raw.showAuthor === 'boolean' ? raw.showAuthor : DEFAULT_OVER_SCREEN_SETTINGS.showAuthor
  // Legacy persisted state only stored showAuthor; mirror it into showAvatar until explicitly customized.
  const showAvatar = typeof raw.showAvatar === 'boolean'
    ? raw.showAvatar
    : typeof raw.showAuthor === 'boolean'
      ? raw.showAuthor
      : DEFAULT_OVER_SCREEN_SETTINGS.showAvatar
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_OVER_SCREEN_SETTINGS.enabled,
    textAnimation: coerceTextAnimation(raw.textAnimation, DEFAULT_OVER_SCREEN_SETTINGS.textAnimation),
    emojiAnimation: typeof raw.emojiAnimation === 'string' && EMOJI_ANIMATION_SET.has(raw.emojiAnimation)
      ? raw.emojiAnimation as OverlayEmojiAnimation
      : DEFAULT_OVER_SCREEN_SETTINGS.emojiAnimation,
    capsAnimation: coerceTextAnimation(raw.capsAnimation, DEFAULT_OVER_SCREEN_SETTINGS.capsAnimation),
    questionAnimation: coerceTextAnimation(raw.questionAnimation, DEFAULT_OVER_SCREEN_SETTINGS.questionAnimation),
    exclamationAnimation: coerceTextAnimation(
      raw.exclamationAnimation,
      DEFAULT_OVER_SCREEN_SETTINGS.exclamationAnimation,
    ),
    fontFamily: typeof raw.fontFamily === 'string' && FONT_FAMILY_SET.has(raw.fontFamily)
      ? raw.fontFamily as OverlayFontFamily
      : DEFAULT_OVER_SCREEN_SETTINGS.fontFamily,
    fontSizePx: clampNumber(raw.fontSizePx, DEFAULT_OVER_SCREEN_SETTINGS.fontSizePx, 16, 56),
    speed: clampNumber(raw.speed, DEFAULT_OVER_SCREEN_SETTINGS.speed, 0.5, 2.5, false),
    opacity: clampNumber(raw.opacity, DEFAULT_OVER_SCREEN_SETTINGS.opacity, 0.2, 1, false),
    showAvatar,
    showAuthor,
    emojiOnlyEnlarged: typeof raw.emojiOnlyEnlarged === 'boolean'
      ? raw.emojiOnlyEnlarged
      : DEFAULT_OVER_SCREEN_SETTINGS.emojiOnlyEnlarged,
    styleByType: typeof raw.styleByType === 'boolean' ? raw.styleByType : DEFAULT_OVER_SCREEN_SETTINGS.styleByType,
    slowModeMs: clampNumber(raw.slowModeMs, DEFAULT_OVER_SCREEN_SETTINGS.slowModeMs, 0, 5_000),
    maxOnScreen: clampNumber(raw.maxOnScreen, DEFAULT_OVER_SCREEN_SETTINGS.maxOnScreen, 1, 40),
  }
}

const readStored = (): OverScreenSettings => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_OVER_SCREEN_SETTINGS }
    return coerceOverScreenSettings(JSON.parse(raw) as Partial<Record<keyof OverScreenSettings, unknown>>)
  } catch {
    return { ...DEFAULT_OVER_SCREEN_SETTINGS }
  }
}

let currentSettings = readStored()
const listeners = new Set<(next: OverScreenSettings) => void>()

export const getOverScreenSettings = (): OverScreenSettings => currentSettings

export const updateOverScreenSettings = (patch: Partial<OverScreenSettings>): OverScreenSettings => {
  const next = coerceOverScreenSettings({ ...currentSettings, ...patch })
  currentSettings = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // storage unavailable (private mode or quota)
  }
  for (const listener of listeners) listener(next)
  return next
}

export const resetOverScreenSettings = (): OverScreenSettings =>
  updateOverScreenSettings({
    ...DEFAULT_OVER_SCREEN_SETTINGS,
    enabled: currentSettings.enabled,
  })

export const subscribeOverScreenSettings = (listener: (next: OverScreenSettings) => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Reactive subscription to persisted over-screen live chat settings. */
export const useOverScreenSettings = (): OverScreenSettings => {
  const [value, setValue] = useState<OverScreenSettings>(() => currentSettings)
  useEffect(() => {
    setValue(currentSettings)
    return subscribeOverScreenSettings(setValue)
  }, [])
  return value
}

export type OverlayRunInput = {
  text?: string | null
  emojiUrl?: string | null
  emojiLabel?: string | null
}

export type OverlayEmojiToken =
  | { type: 'text', value: string }
  | { type: 'custom', url: string, label: string }

export type ClassifiedChatMessage = {
  kind: OverlayMessageKind
  emojis: OverlayEmojiToken[]
}

const EMOJI_TOKEN_RE = /(?:[#*0-9]\uFE0F?\u20E3|[\u{1F1E6}-\u{1F1FF}]{2}|(?:[\u00A9\u00AE\u2122]\uFE0F|(?![\u00A9\u00AE\u2122](?!\uFE0F))\p{Extended_Pictographic})(?:(?:\uFE0F|\u200D|\p{Emoji_Modifier})\p{Extended_Pictographic}?)*)/gu

/** Extracts Unicode + custom emoji runs and detects message punctuation/casing categories. */
export const classifyChatMessage = (
  text: string,
  runs?: readonly OverlayRunInput[] | null,
): ClassifiedChatMessage => {
  const emojis: OverlayEmojiToken[] = []
  let remainingText = ''

  if (runs && runs.length > 0) {
    for (const run of runs) {
      if (run.emojiUrl) {
        emojis.push({ type: 'custom', url: run.emojiUrl, label: run.emojiLabel || run.text || 'emoji' })
      } else if (run.text) {
        const matches = run.text.match(EMOJI_TOKEN_RE)
        if (matches) {
          for (const token of matches) emojis.push({ type: 'text', value: token })
        }
        remainingText += run.text.replace(EMOJI_TOKEN_RE, '')
      }
    }
  } else {
    const matches = text.match(EMOJI_TOKEN_RE)
    if (matches) {
      for (const token of matches) emojis.push({ type: 'text', value: token })
    }
    remainingText = text.replace(EMOJI_TOKEN_RE, '')
  }

  const residual = remainingText.replace(/[\s\uFE0E\uFE0F\u200D]+/g, '')
  if (emojis.length > 0 && residual.length === 0) {
    return { kind: 'emoji-only', emojis }
  }

  const trimmed = text.trim()
  if (trimmed.endsWith('?')) {
    return { kind: 'question', emojis }
  }
  const letters = trimmed.match(/[A-Za-z]/g)
  if (letters && letters.length >= 4 && !/[a-z]/.test(trimmed)) {
    return { kind: 'caps', emojis }
  }
  if (trimmed.endsWith('!')) {
    return { kind: 'exclamation', emojis }
  }
  return { kind: 'normal', emojis }
}

/** Enforces client-side over-screen throttling based on elapsed milliseconds since last spawn. */
export const shouldAcceptOverlayMessage = (
  lastSpawnedAtMs: number | undefined,
  nowMs: number,
  slowModeMs: number,
): boolean => {
  if (slowModeMs <= 0 || lastSpawnedAtMs === undefined) return true
  return nowMs - lastSpawnedAtMs >= slowModeMs
}

/** Chooses the animation preset to apply for a classified message. */
export const resolveOverlayAnimation = (
  kind: OverlayMessageKind,
  settings: Pick<OverScreenSettings, 'textAnimation' | 'emojiAnimation' | 'styleByType'>
    & Partial<Pick<OverScreenSettings, 'capsAnimation' | 'questionAnimation' | 'exclamationAnimation'>>,
): OverlayTextAnimation | OverlayEmojiAnimation => {
  if (kind === 'emoji-only') return settings.emojiAnimation
  if (settings.styleByType && kind in TYPE_ANIMATION_KEYS) {
    const key = TYPE_ANIMATION_KEYS[kind as keyof typeof TYPE_ANIMATION_KEYS]
    return settings[key] ?? DEFAULT_OVER_SCREEN_SETTINGS[key]
  }
  return settings.textAnimation
}

/** Clamps a contained overlay bubble inside `[gutterPx, container - item - gutterPx]` bounds. */
export const clampContainedOverlayPosition = ({
  containerWidth,
  containerHeight,
  itemWidth,
  itemHeight,
  leftPct,
  topPct,
  gutterPx = 12,
}: {
  containerWidth: number
  containerHeight: number
  itemWidth: number
  itemHeight: number
  leftPct: number
  topPct: number
  gutterPx?: number
}): { leftPx: number, topPx: number } => {
  const safeWidth = Number.isFinite(containerWidth) && containerWidth > 0 ? containerWidth : 0
  const safeHeight = Number.isFinite(containerHeight) && containerHeight > 0 ? containerHeight : 0
  const safeItemWidth = Number.isFinite(itemWidth) && itemWidth > 0 ? itemWidth : 0
  const safeItemHeight = Number.isFinite(itemHeight) && itemHeight > 0 ? itemHeight : 0
  const safeGutter = Number.isFinite(gutterPx) && gutterPx >= 0 ? gutterPx : 0

  const effGutterX = Math.min(safeGutter, Math.max(0, (safeWidth - safeItemWidth) / 2))
  const effGutterY = Math.min(safeGutter, Math.max(0, (safeHeight - safeItemHeight) / 2))
  const minLeft = effGutterX
  const maxLeft = Math.max(minLeft, safeWidth - safeItemWidth - effGutterX)
  const minTop = effGutterY
  const maxTop = Math.max(minTop, safeHeight - safeItemHeight - effGutterY)

  const desiredLeft = (safeWidth * leftPct) / 100
  const desiredTop = (safeHeight * topPct) / 100

  return {
    leftPx: Math.round(Math.max(minLeft, Math.min(desiredLeft, maxLeft))),
    topPx: Math.round(Math.max(minTop, Math.min(desiredTop, maxTop))),
  }
}
