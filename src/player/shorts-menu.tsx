import type { SerializedStyles } from '@emotion/react'
import type { VNode } from 'preact'

import type { AudioTrack, CaptionPick, CaptionTrack, TranslationLanguage } from '../frame/protocol'
import type { RichTextRun } from '../components/rich-text'

import { css } from '@emotion/react'
import {
  Ban,
  Bookmark,
  Captions,
  Check,
  ChevronLeft,
  CircleX,
  Gauge,
  Languages,
  Maximize,
  Minimize,
  MonitorPlay,
  TextAlignStart,
  Tv,
  X,
} from 'lucide-react'
import { cloneElement } from 'preact'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { Link } from 'wouter'

import { hashtagHrefFor, RichText } from '../components/rich-text'
import { MenuDivider, MenuItem, Popup, useDismiss } from '../components/ui/popup'
import { VerifiedBadge } from '../components/verified-badge'
import { captionLabel } from '../frame/captions'
import { rateDetail } from './rates'
import { SpeedPicker } from './speed-picker'

export type ShortsMediaState = {
  captionTracks: CaptionTrack[]
  translationLanguages: TranslationLanguage[]
  caption: CaptionPick | undefined
  onCaption: (choice: CaptionPick | undefined) => void
  audioTracks: AudioTrack[]
  audioTrackId: string | undefined
  onAudioTrack: (trackId: string) => void
  playbackRate: number
  onPlaybackRate: (rate: number) => void
  ambientMode: boolean
  onAmbientMode: () => void
  fullscreen: boolean
  onFullscreen: () => void
}

export type ShortsMenuActions = {
  onDescription?: () => void
  onSave?: () => void
  onNotInterested?: () => void
  onDontRecommend?: () => void
  canDontRecommend?: boolean
  onOpenFullPlayer?: () => void
}

type ShortsPanel = 'root' | 'captions' | 'caption-translate' | 'audio' | 'speed'

const menuPanelStyle = css`
  --bg-menu: rgba(33, 33, 33, 0.96);
  --bg-hover: rgba(255, 255, 255, 0.12);
  --text-primary: #ffffff;
  --text-secondary: rgba(255, 255, 255, 0.72);
  --border-subtle: rgba(255, 255, 255, 0.14);
  min-width: 26rem;
  width: max-content;
  max-width: calc(100vw - 1.6rem);
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: var(--bg-menu);
  backdrop-filter: blur(12px);
  color: var(--text-primary);

  &.speed-menu {
    padding: 0;
  }

  .panel-header {
    display: flex;
    align-items: center;
    padding: 0.4rem 0;
    border-bottom: 1px solid var(--border-subtle);
    color: var(--text-primary);
    font-size: 1.3rem;
    font-weight: 500;
  }

  .panel-back {
    display: grid;
    place-items: center;
    width: 4.4rem;
    height: 4.4rem;
    padding: 0;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .panel-back:hover,
  .panel-back:focus-visible {
    background: var(--bg-hover);
  }

  .speed-picker {
    padding: 2rem 1.6rem 1.6rem;
  }
`

const menuRootStyle = css`
  position: relative;
  display: inline-flex;
  align-items: center;
`

/** Splits a publish date string (such as `Oct 23, 2026`) into compact day/month and year lines for Short stats. */
export const splitShortPublishDate = (
  publishedDateText?: string | null,
  relativeDateText?: string | null,
): { top: string, bottom?: string } | undefined => {
  const cleaned = publishedDateText
    ?.replace(/^(?:Premiered|Streamed live on|Published on)\s+/i, '')
    .trim()
  if (cleaned) {
    const commaYear = cleaned.match(/^(.+?),\s*(\d{4})$/)
    if (commaYear) return { top: commaYear[1]!.trim(), bottom: commaYear[2]! }
    const spaceYear = cleaned.match(/^(.+?)\s+(\d{4})$/)
    if (spaceYear) return { top: spaceYear[1]!.trim(), bottom: spaceYear[2]! }
    return { top: cleaned }
  }
  const relative = relativeDateText?.trim()
  return relative ? { top: relative } : undefined
}

/** Extracts the leading metric value from view or like stat strings (such as `3M views` -> `3M`). */
export const formatShortStatValue = (text?: string | null): string | undefined => {
  const value = text?.replace(/\s+(?:views?|likes?)$/i, '').trim()
  return value ? value : undefined
}

/** YouTube Shorts `"..."` options popover with Description, Save, Ambient mode, Captions, Audio Track, Speed, and recommendation feedback. */
export const ShortsOptionsMenu = ({
  trigger,
  media,
  actions,
  active = true,
  align = 'end',
  side = 'below',
  label = 'More options',
  onOpenChange,
}: {
  trigger: VNode
  media?: ShortsMediaState
  actions?: ShortsMenuActions
  active?: boolean
  align?: 'start' | 'end'
  side?: 'below' | 'above'
  label?: string
  onOpenChange?: (open: boolean) => void
}) => {
  const [open, setOpen] = useState(false)
  const [panel, setPanel] = useState<ShortsPanel>('root')
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const openRef = useRef(false)
  openRef.current = open
  const notifyRef = useRef(onOpenChange)
  notifyRef.current = onOpenChange

  const changeOpen = useCallback((next: boolean) => {
    if (openRef.current === next) return
    openRef.current = next
    setOpen(next)
    if (!next) setPanel('root')
    notifyRef.current?.(next)
  }, [])

  useEffect(() => {
    if (!active && open) changeOpen(false)
  }, [active, open, changeOpen])

  useEffect(() => () => {
    if (openRef.current) notifyRef.current?.(false)
  }, [])

  const close = useCallback(() => changeOpen(false), [changeOpen])
  useDismiss({ open, onClose: close, rootRef, panelRef, triggerRef })

  const onSpeedKey = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    if (event.key === 'ArrowLeft') setPanel('root')
  }

  const captionTracks = media?.captionTracks ?? []
  const translationLanguages = media?.translationLanguages ?? []
  const caption = media?.caption
  const activeTrack = caption && captionTracks.find(track => track.id === caption.trackId)
  const activeCaptionLabel = captionLabel(captionTracks, translationLanguages, caption)
  const canTranslate = Boolean(activeTrack?.translatable && translationLanguages.length > 0)
  const audioTracks = media?.audioTracks ?? []
  const audioTrackId = media?.audioTrackId
  const activeAudioTrack = audioTracks.find(track => track.id === audioTrackId) ?? audioTracks[0]
  const playbackRate = media?.playbackRate ?? 1
  const ambientMode = media?.ambientMode ?? true
  const fullscreen = media?.fullscreen ?? false

  const popupLabel = panel === 'captions'
    ? 'Captions'
    : panel === 'caption-translate'
    ? 'Auto-translate'
    : panel === 'audio'
    ? 'Audio track'
    : panel === 'speed'
    ? 'Playback speed'
    : label

  const panelExtraCss: SerializedStyles | undefined = panel === 'speed'
    ? css`padding: 0;`
    : undefined

  return (
    <div ref={rootRef} css={menuRootStyle} data-open={open ? 'true' : undefined}>
      {cloneElement(trigger, {
        ref: triggerRef,
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        onClick: () => changeOpen(!open),
      })}
      {open
        ? (
          <Popup
            label={popupLabel}
            align={align}
            side={side}
            anchor={triggerRef}
            panelRef={panelRef}
            panelCss={panelExtraCss ? [menuPanelStyle, panelExtraCss] : menuPanelStyle}
            class={panel === 'speed' ? 'speed-menu' : undefined}
            onKeyDown={panel === 'speed' ? onSpeedKey : undefined}
          >
            {panel === 'root'
              ? (
                <>
                  <MenuItem
                    icon={TextAlignStart}
                    onSelect={() => {
                      close()
                      triggerRef.current?.focus({ preventScroll: true })
                      actions?.onDescription?.()
                    }}
                  >
                    Description
                  </MenuItem>
                  <MenuItem
                    icon={Bookmark}
                    onSelect={() => {
                      close()
                      actions?.onSave?.()
                    }}
                  >
                    Save to playlist
                  </MenuItem>
                  <MenuItem
                    icon={Tv}
                    role='menuitemcheckbox'
                    selected={ambientMode}
                    detail={ambientMode ? 'On' : 'Off'}
                    toggle
                    disabled={!media}
                    onSelect={() => media?.onAmbientMode()}
                  >
                    Ambient mode
                  </MenuItem>
                  <MenuItem
                    icon={Captions}
                    detail={activeCaptionLabel ?? 'Off'}
                    disabled={captionTracks.length === 0}
                    submenu
                    onSelect={() => setPanel('captions')}
                  >
                    Captions
                  </MenuItem>
                  <MenuItem
                    icon={fullscreen ? Minimize : Maximize}
                    disabled={!media}
                    onSelect={() => {
                      close()
                      media?.onFullscreen()
                    }}
                  >
                    {fullscreen ? 'Exit full screen' : 'Full screen'}
                  </MenuItem>
                  <MenuItem
                    icon={Languages}
                    detail={activeAudioTrack?.label ?? 'Original'}
                    disabled={audioTracks.length <= 1}
                    submenu
                    onSelect={() => setPanel('audio')}
                  >
                    Audio Track
                  </MenuItem>
                  <MenuItem
                    icon={Gauge}
                    detail={rateDetail(playbackRate)}
                    disabled={!media}
                    submenu
                    onSelect={() => setPanel('speed')}
                  >
                    Playback speed
                  </MenuItem>
                  <MenuItem
                    icon={Ban}
                    disabled={!actions?.onNotInterested}
                    onSelect={() => {
                      close()
                      actions?.onNotInterested?.()
                    }}
                  >
                    Not interested
                  </MenuItem>
                  <MenuItem
                    icon={CircleX}
                    disabled={!actions?.canDontRecommend || !actions?.onDontRecommend}
                    onSelect={() => {
                      close()
                      actions?.onDontRecommend?.()
                    }}
                  >
                    Don't recommend this channel
                  </MenuItem>
                  {actions?.onOpenFullPlayer
                    ? (
                      <>
                        <MenuDivider />
                        <MenuItem
                          icon={MonitorPlay}
                          onSelect={() => {
                            close()
                            actions.onOpenFullPlayer?.()
                          }}
                        >
                          Open in the full player
                        </MenuItem>
                      </>
                    )
                    : undefined}
                </>
              )
              : panel === 'captions'
                ? (
                  <>
                    <MenuItem icon={ChevronLeft} onSelect={() => setPanel('root')}>Captions</MenuItem>
                    <MenuItem
                      icon={caption === undefined ? Check : undefined}
                      onSelect={() => {
                        media?.onCaption(undefined)
                        close()
                      }}
                    >
                      Off
                    </MenuItem>
                    {captionTracks.map(track => (
                      <MenuItem
                        key={track.id}
                        icon={caption?.trackId === track.id && !caption.translateTo ? Check : undefined}
                        detail={track.auto ? 'auto' : undefined}
                        onSelect={() => {
                          media?.onCaption({ trackId: track.id })
                          close()
                        }}
                      >
                        {track.label}
                      </MenuItem>
                    ))}
                    {canTranslate
                      ? <MenuItem submenu onSelect={() => setPanel('caption-translate')}>Auto-translate</MenuItem>
                      : undefined}
                  </>
                )
                : panel === 'caption-translate' && caption
                  ? (
                    <>
                      <MenuItem icon={ChevronLeft} onSelect={() => setPanel('captions')}>Auto-translate</MenuItem>
                      {translationLanguages.map(language => (
                        <MenuItem
                          key={language.languageCode}
                          icon={caption.translateTo === language.languageCode ? Check : undefined}
                          onSelect={() => {
                            media?.onCaption({ trackId: caption.trackId, translateTo: language.languageCode })
                            close()
                          }}
                        >
                          {language.label}
                        </MenuItem>
                      ))}
                    </>
                  )
                  : panel === 'audio'
                    ? (
                      <>
                        <MenuItem icon={ChevronLeft} onSelect={() => setPanel('root')}>Audio track</MenuItem>
                        {audioTracks.map(track => (
                          <MenuItem
                            key={track.id}
                            icon={audioTrackId === track.id ? Check : undefined}
                            detail={track.autoDubbed && !/auto/i.test(track.label) ? 'auto-dubbed' : undefined}
                            onSelect={() => {
                              media?.onAudioTrack(track.id)
                              close()
                            }}
                          >
                            {track.label}
                          </MenuItem>
                        ))}
                      </>
                    )
                    : (
                      <>
                        <div className='panel-header'>
                          <button
                            type='button'
                            className='panel-back'
                            aria-label='Back to previous menu'
                            onClick={() => setPanel('root')}
                          >
                            <ChevronLeft size={22} strokeWidth={2} />
                          </button>
                          <span role='heading' aria-level={2}>Playback speed</span>
                        </div>
                        <div className='speed-picker'>
                          <SpeedPicker rate={playbackRate} onRate={(rate: number) => media?.onPlaybackRate(rate)} />
                        </div>
                      </>
                    )}
          </Popup>
        )
        : undefined}
    </div>
  )
}

const descriptionOverlayStyle = css`
  position: absolute;
  inset: 0;
  z-index: 4;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.6rem;
  background: rgba(0, 0, 0, 0.35);

  .desc-card {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 38rem;
    max-height: 100%;
    border-radius: 1.6rem;
    background: rgba(33, 33, 33, 0.96);
    backdrop-filter: blur(12px);
    color: #ffffff;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.55);
    overflow: hidden;
  }

  .desc-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1.2rem;
    padding: 1.8rem 1.8rem 0.8rem;
  }

  .desc-title {
    margin: 0;
    font-size: 1.8rem;
    font-weight: 700;
    line-height: 2.4rem;
    color: #ffffff;
  }

  .desc-close {
    flex: none;
    display: grid;
    place-items: center;
    width: 3.4rem;
    height: 3.4rem;
    margin: -0.4rem -0.6rem 0 0;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: rgba(255, 255, 255, 0.85);
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .desc-close:hover,
  .desc-close:focus-visible {
    background: rgba(255, 255, 255, 0.12);
    color: #ffffff;
  }

  .desc-channel {
    display: inline-flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0 1.8rem 1.4rem;
    color: #ffffff;
    font-size: 1.4rem;
    font-weight: 500;
    text-decoration: none;
  }

  .desc-channel img {
    width: 2.4rem;
    height: 2.4rem;
    border-radius: 50%;
    object-fit: cover;
  }

  .desc-stats {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.8rem;
    padding: 0.8rem 1.8rem 1.6rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
    text-align: center;
  }

  .desc-stat {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
  }

  .desc-stat strong {
    font-size: 1.6rem;
    font-weight: 700;
    line-height: 2.2rem;
    color: #ffffff;
  }

  .desc-stat span {
    font-size: 1.2rem;
    line-height: 1.6rem;
    color: rgba(255, 255, 255, 0.7);
  }

  .desc-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 1.6rem 1.8rem 2rem;
    display: flex;
    flex-direction: column;
    gap: 1.6rem;
    font-size: 1.4rem;
    line-height: 2rem;
    color: rgba(255, 255, 255, 0.92);
  }

  .desc-disclosure h3 {
    margin: 0 0 0.8rem;
    font-size: 1.6rem;
    font-weight: 700;
    color: #ffffff;
  }

  .desc-disclosure strong {
    display: block;
    margin-bottom: 0.2rem;
    font-size: 1.3rem;
    font-weight: 600;
    color: #ffffff;
  }

  .desc-disclosure p {
    margin: 0;
    font-size: 1.3rem;
    line-height: 1.8rem;
    color: rgba(255, 255, 255, 0.72);
  }

  .desc-text {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .desc-text a {
    color: #3ea6ff;
  }

  .desc-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
  }

  .desc-tags a {
    color: #3ea6ff;
    font-size: 1.3rem;
    text-decoration: none;
  }

  .desc-tags a:hover {
    text-decoration: underline;
  }
`

/** Floating YouTube-style Description overlay inside the Shorts stage with stats, auto-dubbed disclosure, description text, and hashtags. */
export const ShortsDescriptionPanel = ({
  videoId,
  title,
  channel,
  likeCountText,
  viewCountText,
  shortViewCountText,
  publishedDateText,
  relativeDateText,
  description,
  descriptionRuns,
  hashtags,
  hasAutoDubbed = false,
  onClose,
}: {
  videoId: string
  title?: string | null
  channel?: {
    id: string
    name: string
    avatar?: string | null
    isVerified?: boolean | null
    isVerifiedArtist?: boolean | null
  } | null
  likeCountText?: string | null
  viewCountText?: string | null
  shortViewCountText?: string | null
  publishedDateText?: string | null
  relativeDateText?: string | null
  description?: string | null
  descriptionRuns?: readonly RichTextRun[] | null
  hashtags?: readonly string[] | null
  hasAutoDubbed?: boolean
  onClose: () => void
}) => {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeBtnRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useLayoutEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeBtnRef.current?.focus({ preventScroll: true })
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return
      const focusables = [...dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((element) => element.getClientRects().length > 0)
      if (focusables.length === 0) {
        event.preventDefault()
        return
      }
      const activeEl = document.activeElement instanceof HTMLElement ? document.activeElement : null
      const first = focusables[0]!
      const last = focusables[focusables.length - 1]!
      const index = activeEl ? focusables.indexOf(activeEl) : -1
      if (event.shiftKey) {
        if (index <= 0) {
          event.preventDefault()
          last.focus({ preventScroll: true })
        }
        return
      }
      if (index === -1 || index >= focusables.length - 1) {
        event.preventDefault()
        first.focus({ preventScroll: true })
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      const activeEl = document.activeElement
      if (
        previousFocus?.isConnected
        && (!activeEl || activeEl === document.body || dialogRef.current?.contains(activeEl))
      ) {
        previousFocus.focus({ preventScroll: true })
      }
    }
  }, [])

  const likeValue = formatShortStatValue(likeCountText)
  const viewValue = formatShortStatValue(shortViewCountText ?? viewCountText)
  const date = splitShortPublishDate(publishedDateText, relativeDateText)
  const hasStats = Boolean(likeValue || viewValue || date)
  const tagLinks = (hashtags ?? [])
    .map(tag => ({ tag, href: hashtagHrefFor(tag) }))
    .filter((item): item is { tag: string, href: string } => Boolean(item.href))

  return (
    <div
      css={descriptionOverlayStyle}
      onClick={(event: MouseEvent) => {
        event.stopPropagation()
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        className='desc-card'
        role='dialog'
        aria-modal='true'
        aria-label='Description'
        onClick={(event: MouseEvent) => event.stopPropagation()}
      >
        <div className='desc-head'>
          <h2 className='desc-title'>{title || 'Description'}</h2>
          <button ref={closeBtnRef} type='button' className='desc-close' aria-label='Close description' onClick={onClose}>
            <X size={20} strokeWidth={1.75} aria-hidden='true' />
          </button>
        </div>

        {channel
          ? (
            <Link className='desc-channel' href={`/channel/${channel.id}`}>
              {channel.avatar ? <img src={channel.avatar} alt='' loading='lazy' /> : undefined}
              <span>{channel.name}</span>
              <VerifiedBadge channel={channel} size={14} />
            </Link>
          )
          : undefined}

        {hasStats
          ? (
            <div className='desc-stats'>
              {likeValue
                ? (
                  <div className='desc-stat'>
                    <strong>{likeValue}</strong>
                    <span>Likes</span>
                  </div>
                )
                : undefined}
              {viewValue
                ? (
                  <div className='desc-stat'>
                    <strong>{viewValue}</strong>
                    <span>Views</span>
                  </div>
                )
                : undefined}
              {date
                ? (
                  <div className='desc-stat'>
                    <strong>{date.top}</strong>
                    {date.bottom ? <span>{date.bottom}</span> : undefined}
                  </div>
                )
                : undefined}
            </div>
          )
          : undefined}

        <div className='desc-body'>
          {hasAutoDubbed
            ? (
              <div className='desc-disclosure'>
                <h3>How this was made</h3>
                <strong>Auto-dubbed</strong>
                <p>Audio tracks for some languages were automatically generated.</p>
              </div>
            )
            : undefined}
          {descriptionRuns && descriptionRuns.length > 0
            ? <div className='desc-text'><RichText runs={descriptionRuns} videoId={videoId} /></div>
            : description
              ? <div className='desc-text'>{description}</div>
              : !hasAutoDubbed && tagLinks.length === 0
                ? <div className='desc-text'>No description.</div>
                : undefined}
          {tagLinks.length > 0
            ? (
              <div className='desc-tags'>
                {tagLinks.map(({ tag, href }) => (
                  <Link key={tag} href={href}>
                    {tag.startsWith('#') ? tag : `#${tag}`}
                  </Link>
                ))}
              </div>
            )
            : undefined}
        </div>
      </div>
    </div>
  )
}
