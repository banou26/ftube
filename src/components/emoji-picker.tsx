import type { TargetedEvent } from 'preact'
import type { LiveChatEmoji } from '../generated/graphql'
import type { EmojiCategory, EmojiPickerSettings, SkinToneModifier, SkinToneOption } from './emoji-picker-settings'

import { css } from '@emotion/react'
import { Cake, Car, Flower2, Hand, Heart, Lightbulb, Lock, Search, Smile, Sparkles, Trophy, Tv } from 'lucide-react'
import { createPortal } from 'preact/compat'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks'

import { getFullscreenElement } from '../player/fullscreen'
import { useSetting } from '../settings'
import { EMOJI_CATEGORIES, emojiPickerMetrics, SKIN_TONES } from './emoji-picker-settings'
import { useDismiss } from './ui/popup'

export type { EmojiCategory, EmojiPickerSettings, SkinToneModifier, SkinToneOption }
export { EMOJI_CATEGORIES, SKIN_TONES }

export type EmojiEntry = {
  emoji: string
  name: string
  category: EmojiCategory
  keywords: readonly string[]
  skinTone?: boolean
}

export type CustomEmoji = LiveChatEmoji

type PickerTab = 'Channel' | 'YouTube' | EmojiCategory
type CssCustomVars = Record<`--${string}`, string>

const SECTION_LABELS: Record<PickerTab, string> = {
  Channel: 'Channel emojis',
  YouTube: 'YouTube emojis',
  Smileys: 'Smileys',
  Gestures: 'Gestures',
  Hearts: 'Hearts & symbols',
  Nature: 'Animals & nature',
  Food: 'Food & drink',
  Travel: 'Travel & places',
  Activities: 'Activities',
  Objects: 'Objects',
}

const CATEGORY_ICONS: Record<EmojiCategory, typeof Smile> = {
  Smileys: Smile,
  Gestures: Hand,
  Hearts: Heart,
  Nature: Flower2,
  Food: Cake,
  Travel: Car,
  Activities: Trophy,
  Objects: Lightbulb,
}

export const EMOJIS: readonly EmojiEntry[] = [
  { emoji: '😀', name: 'Grinning face', category: 'Smileys', keywords: ['smile', 'happy', 'grin'] },
  { emoji: '😃', name: 'Grinning face with big eyes', category: 'Smileys', keywords: ['smile', 'happy'] },
  { emoji: '😄', name: 'Grinning face with smiling eyes', category: 'Smileys', keywords: ['happy', 'laugh'] },
  { emoji: '😁', name: 'Beaming face', category: 'Smileys', keywords: ['grin', 'teeth'] },
  { emoji: '😆', name: 'Grinning squinting face', category: 'Smileys', keywords: ['laugh', 'xd', 'haha'] },
  { emoji: '😅', name: 'Grinning face with sweat', category: 'Smileys', keywords: ['nervous', 'relief'] },
  { emoji: '🤣', name: 'Rolling on the floor laughing', category: 'Smileys', keywords: ['rofl', 'lol', 'funny'] },
  { emoji: '😂', name: 'Face with tears of joy', category: 'Smileys', keywords: ['lol', 'cry', 'laugh', 'funny'] },
  { emoji: '🙂', name: 'Slightly smiling face', category: 'Smileys', keywords: ['smile', 'mild'] },
  { emoji: '😉', name: 'Winking face', category: 'Smileys', keywords: ['wink'] },
  { emoji: '😊', name: 'Smiling face with smiling eyes', category: 'Smileys', keywords: ['blush', 'warm'] },
  { emoji: '😇', name: 'Smiling face with halo', category: 'Smileys', keywords: ['angel', 'innocent'] },
  { emoji: '🥰', name: 'Smiling face with hearts', category: 'Smileys', keywords: ['love', 'adore'] },
  { emoji: '😍', name: 'Heart eyes', category: 'Smileys', keywords: ['love', 'crush'] },
  { emoji: '🤩', name: 'Star struck', category: 'Smileys', keywords: ['wow', 'excited', 'amazing'] },
  { emoji: '😘', name: 'Face blowing a kiss', category: 'Smileys', keywords: ['kiss', 'love'] },
  { emoji: '😋', name: 'Face savoring food', category: 'Smileys', keywords: ['yum', 'delicious'] },
  { emoji: '😜', name: 'Winking face with tongue', category: 'Smileys', keywords: ['silly', 'playful'] },
  { emoji: '🤔', name: 'Thinking face', category: 'Smileys', keywords: ['think', 'hmm', 'wonder'] },
  { emoji: '🤨', name: 'Face with raised eyebrow', category: 'Smileys', keywords: ['skeptical', 'sus'] },
  { emoji: '😐', name: 'Neutral face', category: 'Smileys', keywords: ['meh', 'blank'] },
  { emoji: '😏', name: 'Smirking face', category: 'Smileys', keywords: ['smirk'] },
  { emoji: '🙄', name: 'Face with rolling eyes', category: 'Smileys', keywords: ['eyeroll', 'whatever'] },
  { emoji: '😴', name: 'Sleeping face', category: 'Smileys', keywords: ['sleep', 'tired', 'zzz'] },
  { emoji: '🥳', name: 'Partying face', category: 'Smileys', keywords: ['party', 'celebrate', 'birthday'] },
  { emoji: '😎', name: 'Smiling face with sunglasses', category: 'Smileys', keywords: ['cool', 'shades'] },
  { emoji: '🤓', name: 'Nerd face', category: 'Smileys', keywords: ['nerd', 'glasses', 'geek'] },
  { emoji: '🤯', name: 'Exploding head', category: 'Smileys', keywords: ['mindblown', 'shock', 'whoa'] },
  { emoji: '😮', name: 'Face with open mouth', category: 'Smileys', keywords: ['wow', 'surprised'] },
  { emoji: '😲', name: 'Astonished face', category: 'Smileys', keywords: ['shocked', 'omg'] },
  { emoji: '😳', name: 'Flushed face', category: 'Smileys', keywords: ['blush', 'embarrassed'] },
  { emoji: '🥺', name: 'Pleading face', category: 'Smileys', keywords: ['please', 'puppy', 'sad'] },
  { emoji: '😭', name: 'Loudly crying face', category: 'Smileys', keywords: ['cry', 'sob', 'sad'] },
  { emoji: '😢', name: 'Crying face', category: 'Smileys', keywords: ['tear', 'sad'] },
  { emoji: '😤', name: 'Face with steam from nose', category: 'Smileys', keywords: ['proud', 'frustrated'] },
  { emoji: '😡', name: 'Enraged face', category: 'Smileys', keywords: ['angry', 'mad'] },
  { emoji: '💀', name: 'Skull', category: 'Smileys', keywords: ['dead', 'funny', 'skeleton'] },
  { emoji: '👻', name: 'Ghost', category: 'Smileys', keywords: ['spooky', 'halloween'] },
  { emoji: '🤖', name: 'Robot', category: 'Smileys', keywords: ['bot', 'ai', 'tech'] },
  { emoji: '👽', name: 'Alien', category: 'Smileys', keywords: ['ufo', 'space'] },

  { emoji: '👍', name: 'Thumbs up', category: 'Gestures', keywords: ['like', 'yes', 'good', 'approve'], skinTone: true },
  { emoji: '👎', name: 'Thumbs down', category: 'Gestures', keywords: ['dislike', 'no', 'bad'], skinTone: true },
  { emoji: '👏', name: 'Clapping hands', category: 'Gestures', keywords: ['applause', 'bravo', 'clap'], skinTone: true },
  { emoji: '🙌', name: 'Raising hands', category: 'Gestures', keywords: ['hooray', 'praise', 'celebrate'], skinTone: true },
  { emoji: '🙏', name: 'Folded hands', category: 'Gestures', keywords: ['please', 'thanks', 'pray'], skinTone: true },
  { emoji: '🤝', name: 'Handshake', category: 'Gestures', keywords: ['deal', 'agree'] },
  { emoji: '✌️', name: 'Victory hand', category: 'Gestures', keywords: ['peace', 'two'], skinTone: true },
  { emoji: '🤞', name: 'Crossed fingers', category: 'Gestures', keywords: ['luck', 'hope'], skinTone: true },
  { emoji: '🫶', name: 'Heart hands', category: 'Gestures', keywords: ['love', 'support'], skinTone: true },
  { emoji: '👌', name: 'OK hand', category: 'Gestures', keywords: ['ok', 'nice', 'perfect'], skinTone: true },
  { emoji: '👋', name: 'Waving hand', category: 'Gestures', keywords: ['hi', 'hello', 'bye'], skinTone: true },
  { emoji: '🤙', name: 'Call me hand', category: 'Gestures', keywords: ['hang', 'loose'], skinTone: true },
  { emoji: '💪', name: 'Flexed biceps', category: 'Gestures', keywords: ['strong', 'muscle', 'gym'], skinTone: true },
  { emoji: '👀', name: 'Eyes', category: 'Gestures', keywords: ['look', 'watch', 'see'] },
  { emoji: '🫡', name: 'Saluting face', category: 'Gestures', keywords: ['salute', 'respect'] },
  { emoji: '🤷', name: 'Person shrugging', category: 'Gestures', keywords: ['shrug', 'idk'], skinTone: true },

  { emoji: '❤️', name: 'Red heart', category: 'Hearts', keywords: ['love', 'heart'] },
  { emoji: '🧡', name: 'Orange heart', category: 'Hearts', keywords: ['love', 'heart'] },
  { emoji: '💛', name: 'Yellow heart', category: 'Hearts', keywords: ['love', 'heart'] },
  { emoji: '💚', name: 'Green heart', category: 'Hearts', keywords: ['love', 'heart'] },
  { emoji: '💙', name: 'Blue heart', category: 'Hearts', keywords: ['love', 'heart'] },
  { emoji: '💜', name: 'Purple heart', category: 'Hearts', keywords: ['love', 'heart'] },
  { emoji: '🩷', name: 'Pink heart', category: 'Hearts', keywords: ['love', 'heart'] },
  { emoji: '🤍', name: 'White heart', category: 'Hearts', keywords: ['love', 'heart'] },
  { emoji: '💔', name: 'Broken heart', category: 'Hearts', keywords: ['sad', 'heartbreak'] },
  { emoji: '💖', name: 'Sparkling heart', category: 'Hearts', keywords: ['love', 'sparkle'] },
  { emoji: '💯', name: 'Hundred points', category: 'Hearts', keywords: ['100', 'perfect', 'agree'] },
  { emoji: '✨', name: 'Sparkles', category: 'Hearts', keywords: ['magic', 'shine', 'star'] },
  { emoji: '🔥', name: 'Fire', category: 'Hearts', keywords: ['lit', 'hot', 'flame'] },
  { emoji: '⚡', name: 'High voltage', category: 'Hearts', keywords: ['lightning', 'fast', 'energy'] },
  { emoji: '✅', name: 'Check mark button', category: 'Hearts', keywords: ['check', 'done', 'yes'] },
  { emoji: '❌', name: 'Cross mark', category: 'Hearts', keywords: ['no', 'wrong', 'close'] },

  { emoji: '🌟', name: 'Glowing star', category: 'Nature', keywords: ['star', 'shine'] },
  { emoji: '⭐', name: 'Star', category: 'Nature', keywords: ['star', 'favorite'] },
  { emoji: '🌈', name: 'Rainbow', category: 'Nature', keywords: ['color', 'pride'] },
  { emoji: '☀️', name: 'Sun', category: 'Nature', keywords: ['sunny', 'bright'] },
  { emoji: '🌙', name: 'Crescent moon', category: 'Nature', keywords: ['night', 'moon'] },
  { emoji: '🌸', name: 'Cherry blossom', category: 'Nature', keywords: ['flower', 'spring'] },
  { emoji: '🌿', name: 'Herb', category: 'Nature', keywords: ['leaf', 'plant', 'green'] },
  { emoji: '🍀', name: 'Four leaf clover', category: 'Nature', keywords: ['luck', 'plant'] },
  { emoji: '🐶', name: 'Dog face', category: 'Nature', keywords: ['dog', 'puppy', 'pet'] },
  { emoji: '🐱', name: 'Cat face', category: 'Nature', keywords: ['cat', 'kitty', 'pet'] },
  { emoji: '🦊', name: 'Fox', category: 'Nature', keywords: ['fox', 'animal'] },
  { emoji: '🐧', name: 'Penguin', category: 'Nature', keywords: ['linux', 'bird'] },
  { emoji: '🐸', name: 'Frog', category: 'Nature', keywords: ['frog', 'toad'] },
  { emoji: '🦋', name: 'Butterfly', category: 'Nature', keywords: ['bug', 'insect'] },
  { emoji: '🌊', name: 'Water wave', category: 'Nature', keywords: ['ocean', 'sea', 'surf'] },
  { emoji: '❄️', name: 'Snowflake', category: 'Nature', keywords: ['snow', 'cold', 'winter'] },

  { emoji: '☕', name: 'Hot beverage', category: 'Food', keywords: ['coffee', 'tea', 'morning'] },
  { emoji: '🍵', name: 'Teacup without handle', category: 'Food', keywords: ['tea', 'matcha'] },
  { emoji: '🍕', name: 'Pizza', category: 'Food', keywords: ['food', 'slice'] },
  { emoji: '🍔', name: 'Hamburger', category: 'Food', keywords: ['burger', 'fast food'] },
  { emoji: '🍟', name: 'French fries', category: 'Food', keywords: ['fries', 'snack'] },
  { emoji: '🍿', name: 'Popcorn', category: 'Food', keywords: ['movie', 'snack', 'drama'] },
  { emoji: '🍣', name: 'Sushi', category: 'Food', keywords: ['food', 'japanese'] },
  { emoji: '🍜', name: 'Steaming bowl', category: 'Food', keywords: ['ramen', 'noodles'] },
  { emoji: '🍪', name: 'Cookie', category: 'Food', keywords: ['sweet', 'dessert'] },
  { emoji: '🍰', name: 'Shortcake', category: 'Food', keywords: ['cake', 'birthday', 'dessert'] },
  { emoji: '🍓', name: 'Strawberry', category: 'Food', keywords: ['fruit', 'berry'] },
  { emoji: '🍉', name: 'Watermelon', category: 'Food', keywords: ['fruit', 'summer'] },
  { emoji: '🍺', name: 'Beer mug', category: 'Food', keywords: ['drink', 'cheers'] },
  { emoji: '🥂', name: 'Clinking glasses', category: 'Food', keywords: ['cheers', 'toast'] },
  { emoji: '🌶️', name: 'Hot pepper', category: 'Food', keywords: ['spicy', 'hot'] },
  { emoji: '🍫', name: 'Chocolate bar', category: 'Food', keywords: ['sweet', 'candy'] },

  { emoji: '🚀', name: 'Rocket', category: 'Travel', keywords: ['launch', 'fast', 'space'] },
  { emoji: '✈️', name: 'Airplane', category: 'Travel', keywords: ['flight', 'trip', 'travel'] },
  { emoji: '🚗', name: 'Automobile', category: 'Travel', keywords: ['car', 'drive', 'road'] },
  { emoji: '🚕', name: 'Taxi', category: 'Travel', keywords: ['cab', 'ride'] },
  { emoji: '🚌', name: 'Bus', category: 'Travel', keywords: ['transit', 'ride'] },
  { emoji: '🚆', name: 'Train', category: 'Travel', keywords: ['rail', 'commute'] },
  { emoji: '🚲', name: 'Bicycle', category: 'Travel', keywords: ['bike', 'cycle'] },
  { emoji: '🛸', name: 'Flying saucer', category: 'Travel', keywords: ['ufo', 'space'] },
  { emoji: '⛵', name: 'Sailboat', category: 'Travel', keywords: ['boat', 'sea', 'sail'] },
  { emoji: '🏖️', name: 'Beach with umbrella', category: 'Travel', keywords: ['vacation', 'beach'] },
  { emoji: '🏔️', name: 'Snow-capped mountain', category: 'Travel', keywords: ['mountain', 'hike'] },
  { emoji: '🗺️', name: 'World map', category: 'Travel', keywords: ['map', 'explore'] },
  { emoji: '🧭', name: 'Compass', category: 'Travel', keywords: ['navigate', 'direction'] },
  { emoji: '🌍', name: 'Globe showing Europe-Africa', category: 'Travel', keywords: ['earth', 'world'] },
  { emoji: '🏙️', name: 'Cityscape', category: 'Travel', keywords: ['city', 'buildings'] },
  { emoji: '⛺', name: 'Tent', category: 'Travel', keywords: ['camp', 'outdoors'] },

  { emoji: '🎉', name: 'Party popper', category: 'Activities', keywords: ['celebrate', 'congrats', 'party'] },
  { emoji: '🏆', name: 'Trophy', category: 'Activities', keywords: ['win', 'champion', 'award'] },
  { emoji: '🎮', name: 'Video game', category: 'Activities', keywords: ['game', 'controller', 'gaming'] },
  { emoji: '⚽', name: 'Soccer ball', category: 'Activities', keywords: ['soccer', 'football', 'sport'] },
  { emoji: '🏀', name: 'Basketball', category: 'Activities', keywords: ['hoops', 'sport'] },
  { emoji: '🏈', name: 'American football', category: 'Activities', keywords: ['football', 'sport'] },
  { emoji: '⚾', name: 'Baseball', category: 'Activities', keywords: ['ball', 'sport'] },
  { emoji: '🎾', name: 'Tennis', category: 'Activities', keywords: ['racket', 'sport'] },
  { emoji: '🎸', name: 'Guitar', category: 'Activities', keywords: ['rock', 'music', 'instrument'] },
  { emoji: '🎤', name: 'Microphone', category: 'Activities', keywords: ['sing', 'karaoke', 'mic'] },
  { emoji: '🎧', name: 'Headphone', category: 'Activities', keywords: ['audio', 'music', 'listen'] },
  { emoji: '🎨', name: 'Artist palette', category: 'Activities', keywords: ['art', 'paint', 'draw'] },
  { emoji: '🎭', name: 'Performing arts', category: 'Activities', keywords: ['theater', 'drama'] },
  { emoji: '🎯', name: 'Bullseye', category: 'Activities', keywords: ['target', 'dart', 'goal'] },
  { emoji: '🎲', name: 'Game die', category: 'Activities', keywords: ['dice', 'luck', 'boardgame'] },
  { emoji: '🎳', name: 'Bowling', category: 'Activities', keywords: ['strike', 'game'] },

  { emoji: '🎵', name: 'Musical note', category: 'Objects', keywords: ['music', 'song'] },
  { emoji: '🎶', name: 'Musical notes', category: 'Objects', keywords: ['music', 'melody'] },
  { emoji: '🎬', name: 'Clapper board', category: 'Objects', keywords: ['video', 'film', 'cinema'] },
  { emoji: '📸', name: 'Camera with flash', category: 'Objects', keywords: ['photo', 'camera'] },
  { emoji: '💡', name: 'Light bulb', category: 'Objects', keywords: ['idea', 'bright'] },
  { emoji: '💻', name: 'Laptop', category: 'Objects', keywords: ['code', 'computer', 'tech'] },
  { emoji: '📚', name: 'Books', category: 'Objects', keywords: ['study', 'read', 'learn'] },
  { emoji: '⏳', name: 'Hourglass', category: 'Objects', keywords: ['time', 'wait'] },
  { emoji: '🔔', name: 'Bell', category: 'Objects', keywords: ['notify', 'subscribe', 'alert'] },
  { emoji: '📌', name: 'Pushpin', category: 'Objects', keywords: ['pin', 'note'] },
  { emoji: '🏁', name: 'Chequered flag', category: 'Objects', keywords: ['finish', 'race', 'done'] },
  { emoji: '🔧', name: 'Wrench', category: 'Objects', keywords: ['tool', 'fix'] },
  { emoji: '🛠️', name: 'Hammer and wrench', category: 'Objects', keywords: ['tools', 'build'] },
  { emoji: '🔑', name: 'Key', category: 'Objects', keywords: ['lock', 'unlock'] },
  { emoji: '🎁', name: 'Wrapped gift', category: 'Objects', keywords: ['present', 'gift'] },
  { emoji: '💼', name: 'Briefcase', category: 'Objects', keywords: ['work', 'bag', 'business'] },
]

/** Applies `modifier` to an emoji entry when `entry.skinTone` is true, stripping trailing VS16 (`U+FE0F`) first. */
export const applySkinTone = (
  entry: Pick<EmojiEntry, 'emoji' | 'skinTone'>,
  modifier: SkinToneModifier,
): string => {
  if (!modifier || !entry.skinTone) return entry.emoji
  return `${entry.emoji.replace(/\uFE0F$/, '')}${modifier}`
}

/** Inserts `insert` into `text` across the clamped `[start, end]` range and returns the updated text and caret offset. */
export const insertAtCursor = (
  text: string,
  start: number,
  end: number,
  insert: string,
): { value: string, cursor: number } => {
  const from = Math.max(0, Math.min(start, end, text.length))
  const to = Math.max(from, Math.min(Math.max(start, end), text.length))
  return {
    value: `${text.slice(0, from)}${insert}${text.slice(to)}`,
    cursor: from + insert.length,
  }
}

/** Filters built-in Unicode emojis by search `query` (or returns all entries in `category` when `query` is empty). */
export const filterEmojis = (query: string, category?: EmojiCategory): readonly EmojiEntry[] => {
  const term = query.trim().toLowerCase()
  if (!term) return category ? EMOJIS.filter(entry => entry.category === category) : EMOJIS
  return EMOJIS.filter(entry =>
    entry.name.toLowerCase().includes(term)
    || entry.emoji.includes(term)
    || entry.keywords.some(keyword => keyword.includes(term)),
  )
}

/** Filters custom channel or YouTube emojis by shortcut when a search `query` is non-empty. */
export const filterCustomEmojis = (
  customEmojis: readonly CustomEmoji[],
  query: string,
): readonly CustomEmoji[] => {
  const term = query.trim().toLowerCase()
  if (!term) return customEmojis
  return customEmojis.filter(entry => entry.shortcut.toLowerCase().includes(term))
}

/** Partitions custom emojis into channel membership emojis and YouTube global emojis (unclassified custom emojis default to Channel). */
export const splitCustomEmojis = (customEmojis: readonly CustomEmoji[]) => {
  const channel: CustomEmoji[] = []
  const youtube: CustomEmoji[] = []
  for (const entry of customEmojis) {
    if (entry.group === 'youtube') youtube.push(entry)
    else channel.push(entry)
  }
  return { channel, youtube }
}

const triggerStyle = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 3.6rem;
  height: 3.6rem;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;

  &:hover:not(:disabled),
  &[aria-expanded='true'] {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
`

const panelStyle = css`
  --picker-bg: var(--bg-menu);
  display: flex;
  flex-direction: column;
  background: var(--picker-bg);
  color: var(--text-primary);

  &.inline {
    --picker-bg: var(--bg-subtle);
    border: 1px solid var(--border);
    border-radius: 1.2rem;
    overflow: hidden;
  }

  .emoji-top {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 1rem 1.2rem 0.6rem;
  }

  .emoji-top.no-search {
    justify-content: flex-end;
  }

  .emoji-search-wrap {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.8rem;
    height: 3.6rem;
    padding: 0 1.2rem;
    border: 1px solid var(--border);
    border-radius: 1.8rem;
    background: var(--bg-input);
    color: var(--text-secondary);
  }

  .emoji-search-wrap:focus-within {
    border-color: var(--text-primary);
    color: var(--text-primary);
  }

  .emoji-search-icon {
    flex: none;
    pointer-events: none;
  }

  .emoji-search {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: 1.3rem;
  }

  .emoji-search:focus {
    outline: none;
  }

  .emoji-search::placeholder {
    color: var(--text-secondary);
  }

  .skin-tone-trigger {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 3.4rem;
    height: 3.4rem;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 0.8rem;
    background: var(--bg-input);
    cursor: pointer;
  }

  .skin-tone-trigger:hover,
  .skin-tone-trigger:focus-visible,
  .skin-tone-trigger[aria-expanded='true'] {
    border-color: var(--text-primary);
  }

  .skin-tone-swatch {
    display: block;
    width: 1.8rem;
    height: 1.8rem;
    border-radius: 0.4rem;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.25);
  }

  .skin-tone-tray {
    position: absolute;
    top: calc(100% + 0.2rem);
    right: 1.2rem;
    z-index: 3;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.6rem;
    border: 1px solid var(--border-strong);
    border-radius: 0.8rem;
    background: var(--bg-menu);
    box-shadow: var(--shadow-menu);
  }

  .skin-tone-option {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.8rem;
    height: 2.8rem;
    padding: 0;
    border: 1.5px solid transparent;
    border-radius: 0.6rem;
    background: transparent;
    cursor: pointer;
  }

  .skin-tone-option:hover,
  .skin-tone-option:focus-visible {
    background: var(--bg-hover);
  }

  .skin-tone-option[aria-selected='true'] {
    border-color: var(--text-primary);
    background: var(--bg-hover);
  }

  .emoji-tabs {
    display: flex;
    justify-content: center;
    gap: 0.2rem;
    padding: 0 0.8rem;
    border-bottom: 1px solid var(--border-subtle);
    overflow-x: auto;
    scrollbar-width: none;
  }

  .emoji-tab {
    position: relative;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 3.4rem;
    height: 3.4rem;
    padding: 0;
    border: none;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .emoji-tab:hover,
  .emoji-tab:focus-visible {
    color: var(--text-primary);
  }

  .emoji-tab[aria-selected='true'] {
    color: var(--text-primary);
    border-bottom-color: var(--text-primary);
  }

  .emoji-grid {
    position: relative;
    height: var(--emoji-grid-height, 24rem);
    overflow-y: auto;
    padding: 0 1.2rem 1rem;
  }

  .emoji-section-title {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    padding: 0.8rem 0 0.4rem;
    background: var(--picker-bg);
    font-size: 1.1rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-secondary);
  }

  .emoji-section-lock {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 1rem;
    font-weight: 500;
    letter-spacing: 0;
    text-transform: none;
  }

  .emoji-section-grid {
    display: grid;
    grid-template-columns: repeat(var(--emoji-columns, 8), minmax(0, 1fr));
    gap: 0.2rem;
  }

  .emoji-cell {
    position: relative;
    min-width: 0;
    overflow: hidden;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: var(--emoji-cell-size, 3.4rem);
    padding: 0;
    border: 1px solid transparent;
    border-radius: 0.6rem;
    background: transparent;
    font-size: var(--emoji-font-size, 2rem);
    line-height: 1;
    cursor: pointer;
  }

  .emoji-cell:hover,
  .emoji-cell:focus-visible {
    background: var(--bg-hover-strong);
  }

  .emoji-cell.locked {
    opacity: 0.58;
    cursor: not-allowed;
  }

  .emoji-cell.locked:hover {
    background: transparent;
  }

  .emoji-cell.locked img {
    filter: grayscale(0.4);
  }

  .emoji-lock {
    position: absolute;
    right: 0.2rem;
    bottom: 0.2rem;
    display: grid;
    place-items: center;
    width: 1.4rem;
    height: 1.4rem;
    border-radius: 50%;
    background: var(--bg-base, #0f0f0f);
    color: var(--text-primary);
    box-shadow: 0 0 0 1px var(--border);
    pointer-events: none;
  }

  .emoji-cell.selected {
    background: var(--bg-chip);
    border-color: var(--accent, var(--text-primary));
  }

  .emoji-cell img {
    width: var(--emoji-img-size, 2.2rem);
    height: var(--emoji-img-size, 2.2rem);
    object-fit: contain;
  }

  .emoji-empty {
    padding: 2rem 0;
    text-align: center;
    font-size: 1.3rem;
    color: var(--text-secondary);
  }
`

const popoverStyle = css`
  position: fixed;
  width: min(var(--emoji-popover-width, 34rem), calc(100vw - 1.6rem));
  border: 1px solid var(--border);
  border-radius: 1.2rem;
  background: var(--bg-menu);
  box-shadow: var(--shadow-menu);
  overflow: hidden;
  z-index: calc(var(--z-dialog) + 1);
`

const GAP = 8

const placePanel = (panel: HTMLElement, trigger: HTMLElement) => {
  const anchor = trigger.getBoundingClientRect()
  const { clientWidth: width, clientHeight: height } = document.documentElement
  const roomBelow = height - anchor.bottom - GAP
  const roomAbove = anchor.top - GAP
  const wanted = panel.offsetHeight || 340
  const below = wanted <= roomBelow || roomBelow >= roomAbove
  panel.style.top = below ? `${anchor.bottom + GAP}px` : 'auto'
  panel.style.bottom = below ? 'auto' : `${height - anchor.top + GAP}px`
  const maxLeft = Math.max(GAP, width - panel.offsetWidth - GAP)
  panel.style.left = `${Math.max(GAP, Math.min(anchor.left, maxLeft))}px`
}

/** YouTube-style searchable emoji picker with skin-tone selector, category icon bar, and continuous scrolling sections. */
export const EmojiPickerPanel = ({
  variant = 'popover',
  onPick,
  customEmojis = [],
  selected,
  autoFocus = false,
  searchPlaceholder = 'Search emoji',
  searchLabel = 'Search emoji',
  pickerSettings,
}: {
  variant?: 'popover' | 'inline'
  onPick: (emoji: string) => void
  customEmojis?: readonly CustomEmoji[]
  selected?: string
  autoFocus?: boolean
  searchPlaceholder?: string
  searchLabel?: string
  pickerSettings?: EmojiPickerSettings
}) => {
  const storedSettings = useSetting('emojiPicker')
  const activeSettings = pickerSettings ?? storedSettings
  const [query, setQuery] = useState('')
  const [skinTone, setSkinTone] = useState<SkinToneModifier>(() => activeSettings.defaultSkinTone)
  const [toneOpen, setToneOpen] = useState(false)
  const { channel: channelEmojis, youtube: youtubeEmojis } = splitCustomEmojis(customEmojis)
  const hasChannel = channelEmojis.length > 0
  const hasYoutube = youtubeEmojis.length > 0
  const tabs: readonly PickerTab[] = [
    ...(hasChannel ? ['Channel' as const] : []),
    ...(hasYoutube ? ['YouTube' as const] : []),
    ...EMOJI_CATEGORIES,
  ]
  const [activeTab, setActiveTab] = useState<PickerTab>(() =>
    hasChannel ? 'Channel' : hasYoutube ? 'YouTube' : activeSettings.defaultCategory,
  )
  const searchRef = useRef<HTMLInputElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const sectionRefs = useRef<Partial<Record<PickerTab, HTMLElement | null>>>({})
  const prevDefaultCategoryRef = useRef(activeSettings.defaultCategory)
  const gridId = useId()

  useEffect(() => {
    setSkinTone(activeSettings.defaultSkinTone)
  }, [activeSettings.defaultSkinTone])

  useEffect(() => {
    if (!activeSettings.showSearch && query) setQuery('')
  }, [activeSettings.showSearch, query])

  useEffect(() => {
    if (!activeSettings.showSkinTone && toneOpen) setToneOpen(false)
  }, [activeSettings.showSkinTone, toneOpen])

  useEffect(() => {
    if (!tabs.includes(activeTab)) {
      setActiveTab(tabs[0] ?? 'Smileys')
    }
  }, [hasChannel, hasYoutube, activeTab])

  useEffect(() => {
    if (autoFocus && activeSettings.showSearch) searchRef.current?.focus()
  }, [autoFocus, activeSettings.showSearch])

  const setSectionRef = (tab: PickerTab) => (el: HTMLElement | null) => {
    sectionRefs.current[tab] = el
  }

  const jumpToTab = (tab: PickerTab) => {
    setActiveTab(tab)
    const grid = gridRef.current
    const section = sectionRefs.current[tab]
    if (grid && section) {
      grid.scrollTop = section.offsetTop
    }
  }

  useLayoutEffect(() => {
    if (hasChannel || hasYoutube || activeSettings.defaultCategory === 'Smileys') return
    const grid = gridRef.current
    const section = sectionRefs.current[activeSettings.defaultCategory]
    if (grid && section) grid.scrollTop = section.offsetTop
  }, [])

  useEffect(() => {
    if (prevDefaultCategoryRef.current === activeSettings.defaultCategory) return
    prevDefaultCategoryRef.current = activeSettings.defaultCategory
    if (tabs.includes(activeSettings.defaultCategory)) {
      jumpToTab(activeSettings.defaultCategory)
    }
  }, [activeSettings.defaultCategory, hasChannel, hasYoutube])

  const onTabKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const focused = (event.target as HTMLElement | null)?.getAttribute('data-tab') as PickerTab | null
    const baseTab = focused && tabs.includes(focused) ? focused : activeTab
    const index = Math.max(0, tabs.indexOf(baseTab))
    const step = event.key === 'ArrowRight' ? 1 : -1
    const nextIndex = (index + step + tabs.length) % tabs.length
    const nextTab = tabs[nextIndex]!
    jumpToTab(nextTab)
    ;(tabsRef.current?.children[nextIndex] as HTMLElement | undefined)?.focus()
  }

  const metrics = emojiPickerMetrics(activeSettings)
  const gridHeightRem = variant === 'inline' ? metrics.inlineHeightRem : metrics.popoverHeightRem
  const panelCssVars: CssCustomVars = {
    '--emoji-columns': String(activeSettings.columns),
    '--emoji-cell-size': `${metrics.cellHeightRem}rem`,
    '--emoji-font-size': `${metrics.fontSizeRem}rem`,
    '--emoji-img-size': `${metrics.customImgRem}rem`,
    '--emoji-grid-height': `${gridHeightRem}rem`,
  }
  const showTop = activeSettings.showSearch || activeSettings.showSkinTone

  const currentTone = SKIN_TONES.find(tone => tone.modifier === skinTone) ?? SKIN_TONES[0]!
  const searching = activeSettings.showSearch && query.trim().length > 0
  const matchingChannel = hasChannel ? filterCustomEmojis(channelEmojis, query) : []
  const matchingYoutube = hasYoutube ? filterCustomEmojis(youtubeEmojis, query) : []
  const matchingStandard = searching ? filterEmojis(query) : []

  const renderCustomEmoji = (entry: CustomEmoji) => {
    const locked = entry.locked === true
    const label = locked ? `${entry.shortcut} (Members only)` : entry.shortcut
    const tip = locked ? (entry.lockReason || label) : entry.shortcut
    return (
      <button
        key={entry.id}
        type='button'
        className={locked ? 'emoji-cell locked' : 'emoji-cell'}
        aria-label={label}
        aria-disabled={locked ? 'true' : undefined}
        data-locked={locked ? 'true' : undefined}
        title={tip}
        onClick={locked ? undefined : () => onPick(`${entry.shortcut} `)}
      >
        <img src={entry.url} alt={entry.shortcut} loading='lazy' />
        {locked ? <span className='emoji-lock' aria-hidden='true'><Lock size={9} strokeWidth={2.2} /></span> : undefined}
      </button>
    )
  }

  const renderCustomSection = (tab: 'Channel' | 'YouTube', entries: readonly CustomEmoji[], withRef: boolean) => (
    <div ref={withRef ? setSectionRef(tab) : undefined}>
      {activeSettings.showSectionHeaders
        ? (
          <div className='emoji-section-title'>
            <span>{SECTION_LABELS[tab]}</span>
            {tab === 'Channel' && entries.some(entry => entry.locked === true)
              ? <span className='emoji-section-lock'><Lock size={11} strokeWidth={2.2} aria-hidden='true' />Members only</span>
              : undefined}
          </div>
        )
        : undefined}
      <div className='emoji-section-grid'>
        {entries.map(renderCustomEmoji)}
      </div>
    </div>
  )

  return (
    <div
      css={panelStyle}
      className={variant === 'inline' ? 'inline' : undefined}
      data-emoji-size={activeSettings.emojiSize}
      data-emoji-columns={String(activeSettings.columns)}
      data-picker-height={activeSettings.pickerHeight}
      style={panelCssVars}
    >
      {showTop
        ? (
          <div className={activeSettings.showSearch ? 'emoji-top' : 'emoji-top no-search'}>
            {activeSettings.showSearch
              ? (
                <label className='emoji-search-wrap'>
                  <Search size={16} strokeWidth={1.75} className='emoji-search-icon' aria-hidden='true' />
                  <input
                    ref={searchRef}
                    type='search'
                    className='emoji-search'
                    value={query}
                    placeholder={searchPlaceholder}
                    aria-label={searchLabel}
                    onInput={(event: TargetedEvent<HTMLInputElement>) => setQuery(event.currentTarget.value)}
                  />
                </label>
              )
              : undefined}
            {activeSettings.showSkinTone
              ? (
                <>
                  <button
                    type='button'
                    className='skin-tone-trigger'
                    aria-label='Choose skin tone'
                    aria-haspopup='listbox'
                    aria-expanded={toneOpen}
                    title={currentTone.label}
                    onClick={() => setToneOpen(open => !open)}
                  >
                    <span className='skin-tone-swatch' style={{ backgroundColor: currentTone.color }} aria-hidden='true' />
                  </button>
                  {toneOpen
                    ? (
                      <div className='skin-tone-tray' role='listbox' aria-label='Skin tone'>
                        {SKIN_TONES.map(tone => (
                          <button
                            key={tone.label}
                            type='button'
                            role='option'
                            className='skin-tone-option'
                            aria-label={tone.label}
                            aria-selected={tone.modifier === skinTone}
                            title={tone.label}
                            onClick={() => {
                              setSkinTone(tone.modifier)
                              setToneOpen(false)
                            }}
                          >
                            <span className='skin-tone-swatch' style={{ backgroundColor: tone.color }} aria-hidden='true' />
                          </button>
                        ))}
                      </div>
                    )
                    : undefined}
                </>
              )
              : undefined}
          </div>
        )
        : undefined}

      {!searching && activeSettings.showCategories
        ? (
          <div ref={tabsRef} className='emoji-tabs' role='tablist' aria-label='Emoji categories' onKeyDown={onTabKeyDown}>
            {tabs.map((tab) => {
              const Icon = tab === 'Channel' ? Tv : tab === 'YouTube' ? Sparkles : CATEGORY_ICONS[tab]
              return (
                <button
                  key={tab}
                  type='button'
                  role='tab'
                  data-tab={tab}
                  className='emoji-tab'
                  aria-controls={gridId}
                  aria-selected={tab === activeTab}
                  aria-label={tab}
                  title={tab}
                  onClick={() => jumpToTab(tab)}
                >
                  <Icon size={17} strokeWidth={1.75} aria-hidden='true' />
                </button>
              )
            })}
          </div>
        )
        : undefined}

      <div id={gridId} ref={gridRef} className='emoji-grid'>
        {searching
          ? (
            <>
              {matchingChannel.length > 0 ? renderCustomSection('Channel', matchingChannel, false) : undefined}
              {matchingYoutube.length > 0 ? renderCustomSection('YouTube', matchingYoutube, false) : undefined}
              {matchingStandard.length > 0
                ? (
                  <div className='emoji-section-grid'>
                    {matchingStandard.map((entry) => {
                      const resolved = applySkinTone(entry, skinTone)
                      const isSelected = selected === resolved
                      return (
                        <button
                          key={entry.emoji}
                          type='button'
                          className={isSelected ? 'emoji-cell selected' : 'emoji-cell'}
                          aria-label={entry.name}
                          aria-pressed={selected !== undefined ? isSelected : undefined}
                          title={entry.name}
                          onClick={() => onPick(resolved)}
                        >
                          {resolved}
                        </button>
                      )
                    })}
                  </div>
                )
                : matchingChannel.length === 0 && matchingYoutube.length === 0
                ? <div className='emoji-empty'>No matching emojis</div>
                : undefined}
            </>
          )
          : (
            <>
              {hasChannel ? renderCustomSection('Channel', channelEmojis, true) : undefined}
              {hasYoutube ? renderCustomSection('YouTube', youtubeEmojis, true) : undefined}
              {EMOJI_CATEGORIES.map((category) => {
                const items = filterEmojis('', category)
                return (
                  <div key={category} ref={setSectionRef(category)}>
                    {activeSettings.showSectionHeaders
                      ? <div className='emoji-section-title'>{SECTION_LABELS[category]}</div>
                      : undefined}
                    <div className='emoji-section-grid'>
                      {items.map((entry) => {
                        const resolved = applySkinTone(entry, skinTone)
                        const isSelected = selected === resolved
                        return (
                          <button
                            key={entry.emoji}
                            type='button'
                            className={isSelected ? 'emoji-cell selected' : 'emoji-cell'}
                            aria-label={entry.name}
                            aria-pressed={selected !== undefined ? isSelected : undefined}
                            title={entry.name}
                            onClick={() => onPick(resolved)}
                          >
                            {resolved}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </>
          )}
      </div>
    </div>
  )
}

/** Button opening a portalled YouTube-style Unicode and optional channel custom emoji picker beside the trigger. */
export const EmojiButton = ({
  onPick,
  disabled = false,
  customEmojis = [],
  label = 'Insert emoji',
  closeOnPick,
}: {
  onPick: (emoji: string) => void
  disabled?: boolean
  customEmojis?: readonly CustomEmoji[]
  label?: string
  closeOnPick?: boolean
}) => {
  const pickerSettings = useSetting('emojiPicker')
  const metrics = emojiPickerMetrics(pickerSettings)
  const shouldCloseOnPick = closeOnPick ?? pickerSettings.closeOnPick
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])

  useDismiss({ open, onClose: close, rootRef, panelRef, triggerRef })

  // Capture Escape synchronously before paint ahead of parent Dialog listeners so only this floating picker closes
  useLayoutEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open])

  useLayoutEffect(() => {
    const panel = panelRef.current
    const trigger = triggerRef.current
    if (!open || !panel || !trigger) return
    const position = () => placePanel(panel, trigger)
    position()
    let frame: number | undefined
    const schedule = () => {
      if (frame !== undefined) return
      frame = requestAnimationFrame(() => {
        frame = undefined
        position()
      })
    }
    window.addEventListener('scroll', schedule, { capture: true, passive: true })
    window.addEventListener('resize', schedule)
    const observer = new ResizeObserver(schedule)
    observer.observe(panel)
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule, { capture: true })
      window.removeEventListener('resize', schedule)
      observer.disconnect()
    }
  }, [open, customEmojis.length, metrics.popoverWidthRem, metrics.popoverHeightRem])

  const handlePick = (emoji: string) => {
    onPick(emoji)
    if (shouldCloseOnPick) setOpen(false)
  }

  return (
    <div ref={rootRef}>
      <button
        ref={triggerRef}
        type='button'
        css={triggerStyle}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup='dialog'
        disabled={disabled}
        onClick={() => setOpen(value => !value)}
      >
        <Smile size={18} strokeWidth={1.5} />
      </button>
      {open
        ? createPortal(
          <div
            ref={panelRef}
            css={popoverStyle}
            style={{ '--emoji-popover-width': `${metrics.popoverWidthRem}rem` } as CssCustomVars}
            role='dialog'
            aria-label='Emoji picker'
          >
            <EmojiPickerPanel
              variant='popover'
              autoFocus
              customEmojis={customEmojis}
              pickerSettings={pickerSettings}
              onPick={handlePick}
            />
          </div>,
          getFullscreenElement() ?? document.body,
        )
        : undefined}
    </div>
  )
}
