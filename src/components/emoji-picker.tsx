import type { TargetedEvent } from 'preact'

import { css } from '@emotion/react'
import { Smile } from 'lucide-react'
import { createPortal } from 'preact/compat'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks'

import { useDismiss } from './ui/popup'

export type EmojiCategory = 'Smileys' | 'Gestures' | 'Hearts' | 'Nature' | 'Food' | 'Objects'

export type EmojiEntry = {
  emoji: string
  name: string
  category: EmojiCategory
  keywords: readonly string[]
}

export const EMOJI_CATEGORIES: readonly EmojiCategory[] = [
  'Smileys',
  'Gestures',
  'Hearts',
  'Nature',
  'Food',
  'Objects',
]

const EMOJIS: readonly EmojiEntry[] = [
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

  { emoji: '👍', name: 'Thumbs up', category: 'Gestures', keywords: ['like', 'yes', 'good', 'approve'] },
  { emoji: '👎', name: 'Thumbs down', category: 'Gestures', keywords: ['dislike', 'no', 'bad'] },
  { emoji: '👏', name: 'Clapping hands', category: 'Gestures', keywords: ['applause', 'bravo', 'clap'] },
  { emoji: '🙌', name: 'Raising hands', category: 'Gestures', keywords: ['hooray', 'praise', 'celebrate'] },
  { emoji: '🙏', name: 'Folded hands', category: 'Gestures', keywords: ['please', 'thanks', 'pray'] },
  { emoji: '🤝', name: 'Handshake', category: 'Gestures', keywords: ['deal', 'agree'] },
  { emoji: '✌️', name: 'Victory hand', category: 'Gestures', keywords: ['peace', 'two'] },
  { emoji: '🤞', name: 'Crossed fingers', category: 'Gestures', keywords: ['luck', 'hope'] },
  { emoji: '🫶', name: 'Heart hands', category: 'Gestures', keywords: ['love', 'support'] },
  { emoji: '👌', name: 'OK hand', category: 'Gestures', keywords: ['ok', 'nice', 'perfect'] },
  { emoji: '👋', name: 'Waving hand', category: 'Gestures', keywords: ['hi', 'hello', 'bye'] },
  { emoji: '🤙', name: 'Call me hand', category: 'Gestures', keywords: ['hang', 'loose'] },
  { emoji: '💪', name: 'Flexed biceps', category: 'Gestures', keywords: ['strong', 'muscle', 'gym'] },
  { emoji: '👀', name: 'Eyes', category: 'Gestures', keywords: ['look', 'watch', 'see'] },
  { emoji: '🫡', name: 'Saluting face', category: 'Gestures', keywords: ['salute', 'respect'] },
  { emoji: '🤷', name: 'Person shrugging', category: 'Gestures', keywords: ['shrug', 'idk'] },

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

  { emoji: '🎉', name: 'Party popper', category: 'Objects', keywords: ['celebrate', 'congrats', 'party'] },
  { emoji: '🏆', name: 'Trophy', category: 'Objects', keywords: ['win', 'champion', 'award'] },
  { emoji: '🎮', name: 'Video game', category: 'Objects', keywords: ['game', 'controller', 'gaming'] },
  { emoji: '🎧', name: 'Headphone', category: 'Objects', keywords: ['audio', 'music', 'listen'] },
  { emoji: '🎵', name: 'Musical note', category: 'Objects', keywords: ['music', 'song'] },
  { emoji: '🎶', name: 'Musical notes', category: 'Objects', keywords: ['music', 'melody'] },
  { emoji: '🎬', name: 'Clapper board', category: 'Objects', keywords: ['video', 'film', 'cinema'] },
  { emoji: '📸', name: 'Camera with flash', category: 'Objects', keywords: ['photo', 'camera'] },
  { emoji: '💡', name: 'Light bulb', category: 'Objects', keywords: ['idea', 'bright'] },
  { emoji: '🚀', name: 'Rocket', category: 'Objects', keywords: ['launch', 'fast', 'space'] },
  { emoji: '💻', name: 'Laptop', category: 'Objects', keywords: ['code', 'computer', 'tech'] },
  { emoji: '📚', name: 'Books', category: 'Objects', keywords: ['study', 'read', 'learn'] },
  { emoji: '⏳', name: 'Hourglass', category: 'Objects', keywords: ['time', 'wait'] },
  { emoji: '🔔', name: 'Bell', category: 'Objects', keywords: ['notify', 'subscribe', 'alert'] },
  { emoji: '📌', name: 'Pushpin', category: 'Objects', keywords: ['pin', 'note'] },
  { emoji: '🏁', name: 'Chequered flag', category: 'Objects', keywords: ['finish', 'race', 'done'] },
]

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
  position: fixed;
  width: min(30.4rem, calc(100vw - 1.6rem));
  padding: 1rem;
  border: 1px solid var(--border);
  border-radius: 1.2rem;
  background: var(--bg-menu);
  box-shadow: var(--shadow-menu);
  z-index: var(--z-popup);

  .emoji-search {
    display: block;
    width: 100%;
    height: 3.2rem;
    padding: 0 1rem;
    border: 1px solid var(--border);
    border-radius: 1.6rem;
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: 1.3rem;
  }

  .emoji-search:focus {
    outline: none;
    border-color: var(--text-primary);
  }

  .emoji-tabs {
    display: flex;
    gap: 0.4rem;
    margin-top: 0.8rem;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .emoji-tab {
    flex: none;
    height: 2.6rem;
    padding: 0 0.8rem;
    border: none;
    border-radius: 1.3rem;
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: 1.2rem;
    font-weight: 500;
    cursor: pointer;
  }

  .emoji-tab:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .emoji-tab[aria-selected='true'] {
    background: var(--bg-chip);
    color: var(--text-primary);
  }

  .emoji-grid {
    display: grid;
    grid-template-columns: repeat(8, minmax(0, 1fr));
    gap: 0.2rem;
    max-height: 18rem;
    overflow-y: auto;
    margin-top: 0.8rem;
  }

  .emoji-cell {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 3.2rem;
    padding: 0;
    border: none;
    border-radius: 0.6rem;
    background: transparent;
    font-size: 1.9rem;
    line-height: 1;
    cursor: pointer;
  }

  .emoji-cell:hover,
  .emoji-cell:focus-visible {
    background: var(--bg-hover-strong);
  }

  .emoji-empty {
    grid-column: 1 / -1;
    padding: 1.6rem 0;
    text-align: center;
    font-size: 1.3rem;
    color: var(--text-secondary);
  }
`

const GAP = 8

const placePanel = (panel: HTMLElement, trigger: HTMLElement) => {
  const anchor = trigger.getBoundingClientRect()
  const { clientWidth: width, clientHeight: height } = document.documentElement
  const roomBelow = height - anchor.bottom - GAP
  const roomAbove = anchor.top - GAP
  const wanted = panel.offsetHeight || 280
  const below = wanted <= roomBelow || roomBelow >= roomAbove
  panel.style.top = below ? `${anchor.bottom + GAP}px` : 'auto'
  panel.style.bottom = below ? 'auto' : `${height - anchor.top + GAP}px`
  const maxLeft = Math.max(GAP, width - panel.offsetWidth - GAP)
  panel.style.left = `${Math.max(GAP, Math.min(anchor.left, maxLeft))}px`
}

/** Button opening a local searchable Unicode emoji picker anchored beside the trigger. */
export const EmojiButton = ({ onPick, disabled = false }: {
  onPick: (emoji: string) => void
  disabled?: boolean
}) => {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<EmojiCategory>('Smileys')
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  const gridId = useId()
  const close = useCallback(() => setOpen(false), [])

  useDismiss({ open, onClose: close, rootRef, panelRef, triggerRef })

  useEffect(() => {
    if (open) searchRef.current?.focus()
  }, [open])

  const onTabKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const index = EMOJI_CATEGORIES.indexOf(category)
    const step = event.key === 'ArrowRight' ? 1 : -1
    const nextIndex = (index + step + EMOJI_CATEGORIES.length) % EMOJI_CATEGORIES.length
    setCategory(EMOJI_CATEGORIES[nextIndex]!)
    ;(tabsRef.current?.children[nextIndex] as HTMLElement | undefined)?.focus()
  }

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
  }, [open, query, category])

  const entries = filterEmojis(query, category)

  return (
    <div ref={rootRef}>
      <button
        ref={triggerRef}
        type='button'
        css={triggerStyle}
        aria-label='Insert emoji'
        aria-expanded={open}
        aria-haspopup='dialog'
        disabled={disabled}
        onClick={() => setOpen(value => !value)}
      >
        <Smile size={18} strokeWidth={1.5} />
      </button>
      {open
        ? createPortal(
          <div ref={panelRef} css={panelStyle} role='dialog' aria-label='Emoji picker'>
            <input
              ref={searchRef}
              type='search'
              className='emoji-search'
              value={query}
              placeholder='Search emoji'
              aria-label='Search emoji'
              onInput={(event: TargetedEvent<HTMLInputElement>) => setQuery(event.currentTarget.value)}
            />
            {query.trim().length === 0
              ? (
                <div ref={tabsRef} className='emoji-tabs' role='tablist' aria-label='Emoji categories' onKeyDown={onTabKeyDown}>
                  {EMOJI_CATEGORIES.map(tab => (
                    <button
                      key={tab}
                      type='button'
                      role='tab'
                      className='emoji-tab'
                      aria-controls={gridId}
                      aria-selected={tab === category}
                      onClick={() => setCategory(tab)}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
              )
              : undefined}
            <div id={gridId} className='emoji-grid'>
              {entries.length > 0
                ? entries.map(entry => (
                  <button
                    key={entry.emoji}
                    type='button'
                    className='emoji-cell'
                    aria-label={entry.name}
                    title={entry.name}
                    onClick={() => onPick(entry.emoji)}
                  >
                    {entry.emoji}
                  </button>
                ))
                : <div className='emoji-empty'>No matching emojis</div>}
            </div>
          </div>,
          document.fullscreenElement ?? document.body,
        )
        : undefined}
    </div>
  )
}
