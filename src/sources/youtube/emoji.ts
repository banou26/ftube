import type { SourceLiveChatEmoji } from '../types'

/** Channel ID YouTube uses in InnerTube responses for built-in global custom emojis. */
export const YOUTUBE_GLOBAL_EMOJI_CHANNEL_ID = 'UCkszU2WH9gy1mb0dV-11UJg'

export type EmojiCategoryMeta = {
  group: 'channel' | 'youtube'
  locked?: true
  lockReason?: string
}

type RawPickerCategory = {
  emojiPickerCategoryRenderer?: {
    categoryId?: string
    categoryType?: string
    emojiIds?: string[]
  }
  emojiPickerUpsellCategoryRenderer?: {
    categoryId?: string
    upsell?: unknown
    emojiTooltip?: string
    emojiIds?: string[]
  }
  type?: string
  category_id?: string
  category_type?: string
  emoji_ids?: string[]
  upsell?: unknown
  emoji_tooltip?: string
}

const textOf = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value.trim() || undefined
  if (!value || typeof value !== 'object') return undefined
  const node = value as { simpleText?: unknown, text?: unknown, runs?: { text?: unknown }[] }
  if (typeof node.text === 'string') return node.text.trim() || undefined
  if (typeof node.simpleText === 'string') return node.simpleText.trim() || undefined
  if (Array.isArray(node.runs)) {
    const joined = node.runs.map(run => (typeof run.text === 'string' ? run.text : '')).join('').trim()
    return joined || undefined
  }
  return undefined
}

/**
 * Extracts per-emoji category group (`channel` vs `youtube`) and lock metadata from
 * YouTube `emojiPickerRenderer.categories` (raw InnerTube or parsed `EmojiPicker` nodes).
 */
export const collectEmojiCategoryMeta = (
  categories: readonly unknown[] | undefined,
): Map<string, EmojiCategoryMeta> => {
  const map = new Map<string, EmojiCategoryMeta>()
  if (!Array.isArray(categories)) return map
  for (const raw of categories) {
    if (!raw || typeof raw !== 'object') continue
    const node = raw as RawPickerCategory
    const upsell = node.emojiPickerUpsellCategoryRenderer
      ?? (node.type === 'EmojiPickerUpsellCategory' ? node : undefined)
    if (upsell) {
      const ids = upsell.emojiIds ?? node.emoji_ids ?? []
      const lockReason = (typeof upsell.emojiTooltip === 'string' ? upsell.emojiTooltip : undefined)
        ?? (typeof node.emoji_tooltip === 'string' ? node.emoji_tooltip : undefined)
        ?? textOf(upsell.upsell)
        ?? 'Join this channel to use custom emojis'
      for (const id of ids) {
        if (typeof id === 'string' && id) {
          map.set(id, { group: 'channel', locked: true, lockReason })
        }
      }
      continue
    }
    const category = node.emojiPickerCategoryRenderer
      ?? (node.type === 'EmojiPickerCategory' ? node : undefined)
    if (!category) continue
    const categoryType = category.categoryType ?? node.category_type
    const categoryId = category.categoryId ?? node.category_id ?? ''
    if (categoryType === 'CATEGORY_TYPE_UNICODE') continue
    const group: 'channel' | 'youtube' | undefined = categoryType === 'CATEGORY_TYPE_GLOBAL' || categoryId === YOUTUBE_GLOBAL_EMOJI_CHANNEL_ID
      ? 'youtube'
      : categoryType === 'CATEGORY_TYPE_CUSTOM' || categoryId.startsWith('UC')
        ? 'channel'
        : undefined
    if (!group) continue
    const ids = category.emojiIds ?? node.emoji_ids ?? []
    for (const id of ids) {
      if (typeof id === 'string' && id && !map.has(id)) {
        map.set(id, { group })
      }
    }
  }
  return map
}

/** Classifies a custom emoji entry into `channel` vs `youtube` and locked status using picker metadata or global channel prefix. */
export const classifyCustomEmoji = (
  id: string,
  metaMap?: ReadonlyMap<string, EmojiCategoryMeta>,
  explicitLocked?: boolean,
): Pick<SourceLiveChatEmoji, 'group' | 'locked' | 'lockReason'> => {
  const meta = metaMap?.get(id)
  if (meta) {
    return {
      group: meta.group,
      ...(meta.locked || explicitLocked ? { locked: true as const } : {}),
      ...(meta.lockReason ? { lockReason: meta.lockReason } : {}),
    }
  }
  if (id.startsWith(`${YOUTUBE_GLOBAL_EMOJI_CHANNEL_ID}/`)) {
    return { group: 'youtube' }
  }
  if (explicitLocked) {
    return { group: 'channel', locked: true }
  }
  return {}
}
