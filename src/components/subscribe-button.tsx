import { css } from '@emotion/react'
import { Bell, BellOff, BellRing, ChevronDown, UserMinus } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { useMutation } from 'urql'

import type { NotificationLevel } from '../generated/graphql'

import { gql } from '../generated'
import { lineFor } from './data-failure'
import { MenuDivider, MenuItem, Popup, useDismiss } from './ui/popup'
import { showToast } from './ui/toast'
import { signIn } from '../sign-in'
import { showUndoableToast } from '../undo'

// The mutation does not refetch the channel, so anything else would come back null
export const SET_SUBSCRIBED = gql(`
  mutation SetSubscribed($channelId: ID!, $subscribed: Boolean!) {
    setSubscribed(channelId: $channelId, subscribed: $subscribed) {
      id
      isSubscribed
    }
  }
`)

export const SET_NOTIFICATION_LEVEL = gql(`
  mutation SetNotificationLevel($channelId: ID!, $level: NotificationLevel!) {
    setNotificationLevel(channelId: $channelId, level: $level) {
      id
      notificationLevel
    }
  }
`)

/** Draws a `.subscribe` button inside it as this one, for a Subscribe that opens something else (a collaboration's). */
export const subscribeStyle = css`
  display: flex;
  align-items: center;
  gap: 0.8rem;

  .subscribe {
    flex: none;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    height: var(--action-height, 3.6rem);
    padding: 0 1.6rem;
    border: none;
    border-radius: calc(var(--action-height, 3.6rem) / 2);
    background: var(--bg-inverse);
    color: var(--text-inverse);
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .subscribe:hover:not(:disabled) {
    background: var(--bg-inverse-hover);
  }

  .subscribe:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .subscribe.subscribed {
    background: var(--bg-chip);
    color: var(--text-primary);
  }

  .subscribe.subscribed:hover:not(:disabled) {
    background: var(--bg-chip-hover);
  }

  .bell {
    position: relative;
  }
`

/**
 * Subscribes to a channel or unsubscribes from it and says which in a toast, or the error. `toggle` resolves to whether
 * the account is now subscribed, or undefined on an error. Signing in first is the caller's.
 */
export const useToggleSubscription = () => {
  const [state, setSubscribed] = useMutation(SET_SUBSCRIBED)
  const toggle = async (channelId: string, subscribed: boolean, onUndo?: (restored: boolean) => void) => {
    const result = await setSubscribed({ channelId, subscribed: !subscribed })
    if (result.error) {
      showToast(lineFor(result.error))
      return undefined
    }
    showUndoableToast(subscribed ? 'Unsubscribed' : 'Subscribed', {
      label: subscribed ? 'Unsubscribe' : 'Subscribe',
      undo: async () => {
        const reverted = await setSubscribed({ channelId, subscribed })
        if (reverted.error) throw reverted.error
        onUndo?.(reverted.data?.setSubscribed.isSubscribed === true)
      },
      undoneMessage: subscribed ? 'Subscribed' : 'Unsubscribed',
    })
    return result.data?.setSubscribed.isSubscribed === true
  }
  return { fetching: state.fetching, toggle }
}

const LEVELS: { level: NotificationLevel, label: string, Icon: typeof Bell }[] = [
  { level: 'ALL', label: 'All', Icon: BellRing },
  { level: 'PERSONALIZED', label: 'Personalized', Icon: Bell },
  { level: 'NONE', label: 'None', Icon: BellOff },
]

const menuItemsOf = (panel: HTMLElement | null) =>
  [...(panel?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]

export const SubscribeButton = (
  { channelId, subscribed, notificationLevel, compact = false, tabIndex, active = true, onOpenChange }: {
    channelId?: string
    subscribed?: boolean | null
    notificationLevel?: NotificationLevel | null
    /** Renders a single compact bell trigger pill when subscribed, putting notification levels and Unsubscribe inside its popup. */
    compact?: boolean
    tabIndex?: number
    active?: boolean
    onOpenChange?: (open: boolean) => void
  },
) => {
  const { fetching: subscribing, toggle } = useToggleSubscription()
  const [levelState, setLevel] = useMutation(SET_NOTIFICATION_LEVEL)
  const [open, setOpen] = useState(false)
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
    notifyRef.current?.(next)
  }, [])

  const onClose = useCallback(() => changeOpen(false), [changeOpen])
  useDismiss({ open, onClose, rootRef, panelRef, triggerRef })

  const pending = subscribing || levelState.fetching
  const isSubscribed = subscribed === true
  const level = LEVELS.find(entry => entry.level === notificationLevel) ?? LEVELS[1]!

  useEffect(() => () => {
    if (openRef.current) notifyRef.current?.(false)
  }, [])

  useEffect(() => {
    if ((!active || !isSubscribed) && open) changeOpen(false)
  }, [active, isSubscribed, open, changeOpen])

  useLayoutEffect(() => {
    if (!open) return
    menuItemsOf(panelRef.current)[0]?.focus({ preventScroll: true })
  }, [open])

  const onMenuKeyDown = (event: KeyboardEvent) => {
    const items = menuItemsOf(panelRef.current)
    if (items.length === 0) return
    const from = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      const delta = event.key === 'ArrowDown' ? 1 : -1
      const next = from === -1 ? (delta > 0 ? 0 : items.length - 1) : (from + delta + items.length) % items.length
      items[next]?.focus({ preventScroll: true })
    } else if (event.key === 'Home') {
      event.preventDefault()
      items[0]?.focus({ preventScroll: true })
    } else if (event.key === 'End') {
      event.preventDefault()
      items[items.length - 1]?.focus({ preventScroll: true })
    } else if (event.key === 'Tab') {
      event.preventDefault()
      const delta = event.shiftKey ? -1 : 1
      const next = from === -1 ? (delta > 0 ? 0 : items.length - 1) : (from + delta + items.length) % items.length
      items[next]?.focus({ preventScroll: true })
    }
  }

  const onToggle = () => {
    if (!channelId) return
    // Signed-out reads leave isSubscribed absent, which is what distinguishes them
    if (subscribed === undefined || subscribed === null) {
      signIn()
      return
    }
    void toggle(channelId, isSubscribed)
  }

  const onLevel = (next: NotificationLevel) => {
    changeOpen(false)
    triggerRef.current?.focus({ preventScroll: true })
    if (!channelId || next === notificationLevel) return
    void setLevel({ channelId, level: next }).then((result) => {
      if (result.error) showToast(lineFor(result.error))
    })
  }

  const onUnsubscribe = () => {
    changeOpen(false)
    triggerRef.current?.focus({ preventScroll: true })
    if (!channelId) return
    void toggle(channelId, true)
  }

  if (isSubscribed) {
    return (
      <div css={subscribeStyle} ref={rootRef}>
        <div className='bell'>
          <button
            ref={triggerRef}
            type='button'
            className='subscribe subscribed'
            aria-label={compact ? `Subscribed, notifications: ${level.label}` : undefined}
            title={compact ? undefined : `Notifications: ${level.label}`}
            aria-haspopup='menu'
            aria-expanded={open}
            tabIndex={tabIndex}
            disabled={pending}
            onClick={() => changeOpen(!open)}
          >
            <level.Icon size={18} strokeWidth={1.5} />
            {compact ? undefined : 'Subscribed'}
            <ChevronDown size={14} strokeWidth={1.5} />
          </button>
          {open
            ? (
              <Popup label='Notifications' align='start' anchor={triggerRef} panelRef={panelRef} onKeyDown={onMenuKeyDown}>
                {LEVELS.map(entry => (
                  <MenuItem
                    key={entry.level}
                    icon={entry.Icon}
                    selected={entry.level === level.level}
                    onSelect={() => onLevel(entry.level)}
                  >
                    {entry.label}
                  </MenuItem>
                ))}
                <MenuDivider />
                <MenuItem icon={UserMinus} onSelect={onUnsubscribe}>
                  Unsubscribe
                </MenuItem>
              </Popup>
            )
            : undefined}
        </div>
      </div>
    )
  }

  return (
    <div css={subscribeStyle} ref={rootRef}>
      <button
        ref={triggerRef}
        type='button'
        className='subscribe'
        tabIndex={tabIndex}
        disabled={pending || !channelId}
        aria-pressed={false}
        onClick={onToggle}
      >
        Subscribe
      </button>
    </div>
  )
}

export default SubscribeButton
