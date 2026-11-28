import type {
  ClassifiedChatMessage,
  OverScreenSettings,
} from './over-screen-messages'
import type { ChatRow, OverlayChatEvent } from './use-live-chat-session'

import { css, keyframes } from '@emotion/react'
import { createPortal } from 'preact/compat'
import { useEffect, useRef, useState } from 'preact/hooks'

import { subscribeFullscreen } from '../player/fullscreen'
import {
  classifyChatMessage,
  OVERLAY_FONT_STACKS,
  resolveOverlayAnimation,
  shouldAcceptOverlayMessage,
} from './over-screen-messages'

const scrollAcross = keyframes`
  0% {
    opacity: 0;
    transform: translate3d(100vw, 0, 0);
  }
  8% {
    opacity: 1;
  }
  92% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translate3d(-110%, 0, 0);
  }
`

const shakeIn = keyframes`
  0% { opacity: 0; transform: scale(0.85) translate3d(0, 0, 0); }
  12% { opacity: 1; transform: scale(1.04) translate3d(-6px, -2px, 0); }
  22% { transform: scale(1.02) translate3d(6px, 2px, 0); }
  32% { transform: scale(1) translate3d(-4px, 1px, 0); }
  42% { transform: translate3d(4px, -1px, 0); }
  55% { transform: translate3d(0, 0, 0); opacity: 1; }
  85% { opacity: 1; }
  100% { opacity: 0; transform: translate3d(0, -10px, 0); }
`

const popIn = keyframes`
  0% { opacity: 0; transform: scale(0.45); }
  16% { opacity: 1; transform: scale(1.12); }
  28% { transform: scale(0.96); }
  38% { opacity: 1; transform: scale(1); }
  85% { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(0.92); }
`

const bounceFloat = keyframes`
  0% { opacity: 0; transform: translate3d(0, 22px, 0) scale(0.8); }
  18% { opacity: 1; transform: translate3d(0, -14px, 0) scale(1.05); }
  36% { transform: translate3d(0, 5px, 0) scale(0.98); }
  54% { transform: translate3d(0, -8px, 0) scale(1.01); }
  72% { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
  100% { opacity: 0; transform: translate3d(0, -18px, 0) scale(0.96); }
`

const softFade = keyframes`
  0% { opacity: 0; transform: translate3d(0, 6px, 0); }
  16% { opacity: 1; transform: translate3d(0, 0, 0); }
  82% { opacity: 1; transform: translate3d(0, 0, 0); }
  100% { opacity: 0; transform: translate3d(0, -6px, 0); }
`

const emojiBurst = keyframes`
  0% { opacity: 0; transform: scale(0.25) rotate(-10deg); }
  20% { opacity: 1; transform: scale(1.32) rotate(6deg); }
  38% { transform: scale(0.98) rotate(-3deg); }
  78% { opacity: 1; transform: scale(1.08) translate3d(0, -24px, 0); }
  100% { opacity: 0; transform: scale(1.45) translate3d(0, -56px, 0); }
`

const emojiShatter = keyframes`
  0% { opacity: 0; transform: scale(1.45) translate3d(0, 0, 0) rotate(0deg); }
  18% { opacity: 1; transform: scale(1.1) translate3d(-4px, -6px, 0) rotate(-6deg); }
  45% { opacity: 1; transform: scale(1.02) translate3d(8px, 8px, 0) rotate(7deg); }
  75% { opacity: 0.75; transform: scale(0.9) translate3d(-12px, 24px, 0) rotate(-14deg); }
  100% { opacity: 0; transform: scale(0.6) translate3d(18px, 46px, 0) rotate(22deg); }
`

const overlayCss = css`
  position: fixed;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  user-select: none;
  z-index: calc(var(--z-popup, 2200) - 10);

  .overlay-item {
    position: absolute;
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    max-width: min(72vw, 68rem);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.25;
    animation-fill-mode: forwards;
    animation-timing-function: ease-out;
    will-change: transform, opacity;
  }

  .overlay-item.text-bubble {
    padding: 0.35em 0.7em;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    background: rgba(15, 15, 15, 0.62);
    color: #ffffff;
    font-weight: 600;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.85);
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.32);
  }

  .overlay-item.kind-caps {
    border-color: rgba(255, 202, 40, 0.55);
    color: #ffdf70;
    font-weight: 800;
    letter-spacing: 0.03em;
  }

  .overlay-item.kind-question {
    border-color: rgba(62, 166, 255, 0.58);
    color: #9dd4ff;
  }

  .overlay-item.kind-exclamation {
    border-color: rgba(255, 138, 101, 0.58);
    color: #ffb89e;
  }

  .overlay-item.emoji-only {
    gap: 0.35em;
    filter: drop-shadow(0 3px 10px rgba(0, 0, 0, 0.55));
  }

  .overlay-author {
    font-size: 0.72em;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.78);
  }

  .overlay-inline-emoji {
    width: 1.2em;
    height: 1.2em;
    vertical-align: -0.2em;
    object-fit: contain;
    margin: 0 0.08em;
  }

  .overlay-custom-emoji {
    width: 1.35em;
    height: 1.35em;
    object-fit: contain;
  }

  .overlay-item.anim-scroll {
    left: 0;
    animation-name: ${scrollAcross};
    animation-timing-function: linear;
  }

  .overlay-item.anim-shake {
    animation-name: ${shakeIn};
  }

  .overlay-item.anim-pop {
    animation-name: ${popIn};
  }

  .overlay-item.anim-bounce {
    animation-name: ${bounceFloat};
  }

  .overlay-item.anim-fade {
    animation-name: ${softFade};
  }

  .overlay-item.anim-burst {
    animation-name: ${emojiBurst};
  }

  .overlay-item.anim-shatter {
    animation-name: ${emojiShatter};
  }

  @media (prefers-reduced-motion: reduce) {
    .overlay-item {
      animation-name: ${softFade};
      animation-timing-function: ease-out;
    }

    .overlay-item.anim-scroll {
      left: auto;
      right: 6vw;
    }
  }
`

type ActiveOverlayItem = {
  key: number
  messageId: string
  authorId: string | undefined
  authorName: string | undefined
  text: string
  runs: ChatRow['runs']
  classified: ClassifiedChatMessage
  lanePct: number
  leftPct: number
  animation: ReturnType<typeof resolveOverlayAnimation>
  durationMs: number
}

const PREVIEW_SAMPLES: ChatRow[] = [
  {
    __typename: 'LiveChatMessage',
    id: 'preview-text',
    kind: 'TEXT',
    text: 'Over-screen live chat preview!',
    runs: [{ __typename: 'LiveChatRun', text: 'Over-screen live chat preview!', url: null, videoId: null, startSeconds: null, browseId: null, emojiUrl: null, emojiLabel: null }],
    timestampText: null,
    isOwner: false,
    isModerator: false,
    isMember: false,
    badges: null,
    purchaseAmountText: null,
    headerBackgroundColor: null,
    bodyBackgroundColor: null,
    headerPrimaryText: null,
    headerSubtext: null,
    stickerUrl: null,
    stickerLabel: null,
    iconType: null,
    author: { __typename: 'Author', id: 'preview-1', name: 'Viewer', avatar: null, handle: '@viewer' },
  },
  {
    __typename: 'LiveChatMessage',
    id: 'preview-emoji',
    kind: 'TEXT',
    text: '🎉🔥🚀',
    runs: [{ __typename: 'LiveChatRun', text: '🎉🔥🚀', url: null, videoId: null, startSeconds: null, browseId: null, emojiUrl: null, emojiLabel: null }],
    timestampText: null,
    isOwner: false,
    isModerator: false,
    isMember: false,
    badges: null,
    purchaseAmountText: null,
    headerBackgroundColor: null,
    bodyBackgroundColor: null,
    headerPrimaryText: null,
    headerSubtext: null,
    stickerUrl: null,
    stickerLabel: null,
    iconType: null,
    author: { __typename: 'Author', id: 'preview-2', name: 'Chat', avatar: null, handle: '@chat' },
  },
]

const getFullscreenTarget = (): Element | null => {
  if (typeof document === 'undefined') return null
  const webkitDoc = document as Document & { webkitFullscreenElement?: Element | null }
  return document.fullscreenElement ?? webkitDoc.webkitFullscreenElement ?? null
}

/** Portaled non-interactive overlay projecting live chat messages across the screen. */
export const OverScreenOverlay = (
  { settings, event, resetSeq, previewSeq }: {
    settings: OverScreenSettings
    event: OverlayChatEvent | undefined
    resetSeq: number
    previewSeq: number
  },
) => {
  const [items, setItems] = useState<ActiveOverlayItem[]>([])
  const [portalTarget, setPortalTarget] = useState<Element | null>(() =>
    typeof document === 'undefined' ? null : (getFullscreenTarget() ?? document.body),
  )
  const itemSeqRef = useRef(0)
  const laneIdxRef = useRef(0)
  const lastSpawnAtRef = useRef<number | undefined>(undefined)
  const lastEventSeqRef = useRef<number>(0)
  const lastPreviewSeqRef = useRef<number>(previewSeq)
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  const clearAll = () => {
    for (const timer of timersRef.current.values()) clearTimeout(timer)
    timersRef.current.clear()
    setItems([])
  }

  useEffect(() => {
    const syncPortal = () => {
      setPortalTarget(getFullscreenTarget() ?? document.body)
    }
    syncPortal()
    return subscribeFullscreen(syncPortal)
  }, [])

  useEffect(() => clearAll, [])

  useEffect(() => {
    clearAll()
    lastSpawnAtRef.current = undefined
  }, [resetSeq])

  useEffect(() => {
    if (!settings.enabled) {
      clearAll()
      lastSpawnAtRef.current = undefined
    }
  }, [settings.enabled])

  const spawnRows = (rows: readonly ChatRow[], ignoreSlowMode = false) => {
    const activeSettings = settingsRef.current
    if (!activeSettings.enabled || rows.length === 0) return

    const spawned: ActiveOverlayItem[] = []
    for (const row of rows) {
      const now = Date.now()
      if (!ignoreSlowMode && !shouldAcceptOverlayMessage(lastSpawnAtRef.current, now, activeSettings.slowModeMs)) {
        continue
      }
      lastSpawnAtRef.current = now
      const classified = classifyChatMessage(row.text, row.runs)
      const animation = resolveOverlayAnimation(classified.kind, activeSettings)
      const baseMs = classified.kind === 'emoji-only'
        ? 3_200
        : animation === 'scroll'
          ? 6_400
          : 4_000
      const durationMs = Math.max(900, Math.round(baseMs / activeSettings.speed))
      const slot = laneIdxRef.current++
      const lanePct = 10 + ((slot * 17) % 72)
      const leftPct = 14 + ((slot * 23) % 58)
      const key = ++itemSeqRef.current
      spawned.push({
        key,
        messageId: row.id,
        authorId: row.author?.id,
        authorName: row.author?.name,
        text: row.text,
        runs: row.runs,
        classified,
        lanePct,
        leftPct,
        animation,
        durationMs,
      })

      const timer = setTimeout(() => {
        timersRef.current.delete(key)
        setItems((current) => current.filter((entry) => entry.key !== key))
      }, durationMs)
      timersRef.current.set(key, timer)
    }

    if (spawned.length === 0) return

    setItems((current) => {
      const combined = [...current, ...spawned]
      const excess = combined.length - activeSettings.maxOnScreen
      if (excess <= 0) return combined
      const evicted = combined.slice(0, excess)
      for (const dropped of evicted) {
        const timer = timersRef.current.get(dropped.key)
        if (timer !== undefined) {
          clearTimeout(timer)
          timersRef.current.delete(dropped.key)
        }
      }
      return combined.slice(excess)
    })
  }

  useEffect(() => {
    if (!event || event.seq === lastEventSeqRef.current) return
    lastEventSeqRef.current = event.seq

    if (event.removedIds.length > 0 || event.removedAuthorIds.length > 0) {
      const removedIds = new Set(event.removedIds)
      const removedAuthors = new Set(event.removedAuthorIds)
      setItems((current) =>
        current.filter((entry) => {
          const drop = removedIds.has(entry.messageId)
            || (entry.authorId !== undefined && removedAuthors.has(entry.authorId))
          if (drop) {
            const timer = timersRef.current.get(entry.key)
            if (timer !== undefined) {
              clearTimeout(timer)
              timersRef.current.delete(entry.key)
            }
          }
          return !drop
        }),
      )
    }

    if (settingsRef.current.enabled && event.items.length > 0) {
      spawnRows(event.items)
    }
  }, [event])

  useEffect(() => {
    if (previewSeq === lastPreviewSeqRef.current) return
    lastPreviewSeqRef.current = previewSeq
    if (!settingsRef.current.enabled) return
    spawnRows(PREVIEW_SAMPLES.map((sample, index) => ({
      ...sample,
      id: `${sample.id}-${previewSeq}-${index}`,
    })), true)
  }, [previewSeq])

  if (!settings.enabled || !portalTarget) return null

  const fontFamily = OVERLAY_FONT_STACKS[settings.fontFamily]

  return createPortal(
    <div
      css={overlayCss}
      aria-hidden='true'
      data-over-screen-overlay='true'
      data-text-animation={settings.textAnimation}
      data-emoji-animation={settings.emojiAnimation}
      data-font-family={settings.fontFamily}
      style={{ fontFamily, opacity: String(settings.opacity) }}
    >
      {items.map((item) => {
        const isEmojiOnly = item.classified.kind === 'emoji-only'
        const sizePx = isEmojiOnly && settings.emojiOnlyEnlarged
          ? Math.round(settings.fontSizePx * 1.5)
          : settings.fontSizePx
        const typeClass = settings.styleByType ? `kind-${item.classified.kind}` : ''
        const classes = [
          'overlay-item',
          isEmojiOnly ? 'emoji-only' : 'text-bubble',
          typeClass,
          `anim-${item.animation}`,
        ].filter(Boolean).join(' ')
        const positionStyle = item.animation === 'scroll'
          ? { top: `${item.lanePct}%` }
          : { top: `${item.lanePct}%`, left: `${item.leftPct}%` }

        return (
          <div
            key={item.key}
            className={classes}
            data-overlay-item={item.messageId}
            data-overlay-kind={item.classified.kind}
            data-overlay-animation={item.animation}
            style={{
              ...positionStyle,
              fontSize: `${sizePx}px`,
              animationDuration: `${item.durationMs}ms`,
            }}
          >
            {isEmojiOnly
              ? item.classified.emojis.map((token, idx) =>
                token.type === 'custom'
                  ? (
                    <img
                      key={`${item.key}-ce-${idx}`}
                      className='overlay-custom-emoji'
                      src={token.url}
                      alt={token.label}
                      referrerpolicy='no-referrer'
                    />
                  )
                  : <span key={`${item.key}-e-${idx}`}>{token.value}</span>,
              )
              : (
                <>
                  {settings.showAuthor && item.authorName
                    ? <span className='overlay-author'>{item.authorName}</span>
                    : undefined}
                  <span>
                    {item.runs.length > 0
                      ? item.runs.map((run, idx) =>
                        run.emojiUrl
                          ? (
                            <img
                              key={`${item.key}-r-${idx}`}
                              className='overlay-inline-emoji'
                              src={run.emojiUrl}
                              alt={run.emojiLabel ?? run.text}
                              referrerpolicy='no-referrer'
                            />
                          )
                          : <span key={`${item.key}-t-${idx}`}>{run.text}</span>,
                      )
                      : item.text}
                  </span>
                </>
              )}
          </div>
        )
      })}
    </div>,
    portalTarget,
  )
}
