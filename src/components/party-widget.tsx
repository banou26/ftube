import type { TargetedEvent } from 'preact'
import type { PartyEndReason, PartyRosterMember } from '../party'

import { css } from '@emotion/react'
import { Check, Copy, LogOut, Play, Radio, Users } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { useLocation } from 'wouter'

import { party, PARTY_PATH, partyLink } from '../party'
import { useParty, usePartyPresence } from '../party/use-party'
import { PartyAvatar } from './party-avatar'
import { Popup, useDismiss } from './ui/popup'

const rootStyle = css`
  position: relative;
  display: flex;
  align-items: center;
  flex: none;

  &.idle {
    @media (max-width: 656px) {
      display: none;
    }
  }
`

const triggerStyle = css`
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  height: 3.6rem;
  padding: 0 1.2rem;
  border: 1px solid var(--border-strong);
  border-radius: 1.8rem;
  background: transparent;
  color: var(--text-primary);
  font-size: 1.3rem;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;

  &:hover,
  &[aria-expanded='true'] {
    background: var(--bg-hover);
  }

  &.live {
    border-color: var(--membership);
    color: var(--membership);
  }

  &.ended {
    border-color: var(--danger);
    color: var(--danger);
  }

  .count {
    opacity: 0.85;
  }

  @media (max-width: 1359px) {
    padding: 0 1rem;

    .label {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
  }
`

const panelStyle = css`
  width: 30rem;
  padding: 1.4rem;
  color: var(--text-primary);
  font-size: 1.3rem;

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
  }

  .title {
    font-size: 1.4rem;
    font-weight: 600;
  }

  .meta {
    color: var(--text-secondary);
    font-size: 1.2rem;
  }

  .avatars {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 1rem;
  }

  .avatars-member {
    display: inline-flex;
  }

  .avatars-more {
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--text-secondary);
    padding-left: 0.2rem;
  }

  .message {
    margin-top: 0.6rem;
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .link-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-top: 1rem;
  }

  .link-row input {
    flex: 1;
    min-width: 0;
    height: 3.4rem;
    padding: 0 1rem;
    border: 1px solid var(--border);
    border-radius: 0.8rem;
    background: var(--bg-input);
    color: var(--text-primary);
    font-size: 1.2rem;
    outline: none;
  }

  .follow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    margin-top: 1rem;
    cursor: pointer;
  }

  .follow input {
    width: 1.6rem;
    height: 1.6rem;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.8rem;
    margin-top: 1.2rem;
  }

  button {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    height: 3.4rem;
    padding: 0 1.2rem;
    border: 1px solid var(--border-strong);
    border-radius: 1.7rem;
    background: var(--bg-chip);
    color: var(--text-primary);
    font-size: 1.3rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  button:hover {
    background: var(--bg-chip-hover);
  }

  button.danger {
    color: var(--danger);
  }
`

export const endMessage = (reason: PartyEndReason): string => {
  switch (reason) {
    case 'host-left': return 'Host ended the party.'
    case 'removed': return 'You were removed from the party.'
    case 'blocked': return 'You were blocked from this party.'
    case 'left': return 'You left the party.'
    default: return 'The party ended.'
  }
}

export const failMessage = (code: string): string => {
  switch (code) {
    case 'not-found': return 'That party has ended.'
    case 'full': return 'That party is full.'
    case 'blocked': return 'You are blocked from this party.'
    case 'invalid': return 'That invite link is invalid.'
    case 'unavailable': return 'Watch together is unavailable right now.'
    default: return 'Could not connect to the party.'
  }
}

/** Header control for starting, sharing, following, and leaving a Watch Together session. */
export const PartyWidget = () => {
  const state = useParty()
  const presence = usePartyPresence()
  const [, navigate] = useLocation()
  const [open, setOpen] = useState(false)
  const [roster, setRoster] = useState<PartyRosterMember[]>([])
  const [copied, setCopied] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const close = useCallback(() => setOpen(false), [])
  useDismiss({ open, onClose: close, rootRef, panelRef, triggerRef })

  useEffect(() => () => clearTimeout(copyTimer.current), [])

  // Clear stale popover when returning cleanly to idle after dismissal.
  useEffect(() => {
    if (state.status === 'idle') setOpen(false)
  }, [state.status])

  const invite = state.status === 'active' ? state.invite : undefined
  const link = invite ? partyLink(window.location.origin, invite) : ''

  const copy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 2_000)
    } catch {}
  }

  const onTrigger = () => {
    if (state.status === 'idle') {
      setOpen(true)
      void party.create()
      return
    }
    setOpen((value) => !value)
  }

  const active = state.status === 'active'
  const memberCount = active ? state.members : 0
  useEffect(() => {
    if (!open || !active) {
      setRoster([])
      return
    }
    let cancelled = false
    void party.roster().then((list) => {
      if (!cancelled) setRoster(list)
    })
    return () => {
      cancelled = true
    }
  }, [open, active, memberCount, presence])

  const socialMembers = roster.filter((member) => member.identity?.identity)
  const renderAvatars = () => {
    if (!socialMembers.length) return undefined
    const shown = socialMembers.slice(0, 6)
    const extra = socialMembers.length - shown.length
    return (
      <div className='avatars'>
        {shown.map((member) => (
          <span key={member.id} className='avatars-member' title={member.name ?? member.id}>
            <PartyAvatar participant={member.identity} size={24} />
          </span>
        ))}
        {extra > 0 ? <span className='avatars-more'>+{extra}</span> : undefined}
      </div>
    )
  }

  const ended = state.status === 'ended' || state.status === 'failed'
  const label = active
    ? (state.role === 'host' ? 'Hosting' : 'Following')
    : state.status === 'joining'
      ? 'Joining…'
      : ended
        ? 'Party ended'
        : 'Watch together'

  return (
    <div css={rootStyle} className={state.status === 'idle' ? 'idle' : undefined} ref={rootRef}>
      <button
        ref={triggerRef}
        type='button'
        css={triggerStyle}
        className={active ? 'live' : ended ? 'ended' : undefined}
        aria-haspopup='dialog'
        aria-expanded={open}
        onClick={onTrigger}
      >
        {active ? <Radio size={18} strokeWidth={1.75} /> : <Users size={18} strokeWidth={1.75} />}
        <span className='label'>{label}</span>
        {active ? <span className='count'>{state.members}</span> : undefined}
      </button>
      {open
        ? (
          <Popup label='Watch together' align='end' anchor={triggerRef} panelRef={panelRef}>
            <div css={panelStyle}>
              {state.status === 'joining'
                ? (
                  <>
                    <div className='title'>Connecting…</div>
                    <div className='actions'>
                      <button type='button' onClick={() => { void party.leave(); close() }}>Cancel</button>
                    </div>
                  </>
                )
                : active
                  ? (
                    <>
                      <div className='head'>
                        <span className='title'>{state.role === 'host' ? 'Hosting' : 'Following'}</span>
                        <span className='meta'>{state.members === 1 ? '1 viewer' : `${state.members} viewers`}</span>
                      </div>
                      {renderAvatars()}
                      <div className='link-row'>
                        <input
                          readOnly
                          value={link}
                          aria-label='Invite link'
                          onFocus={(event: TargetedEvent<HTMLInputElement>) => event.currentTarget.select()}
                        />
                        <button type='button' onClick={() => void copy()}>
                          {copied ? <Check size={16} strokeWidth={1.75} /> : <Copy size={16} strokeWidth={1.75} />}
                          {copied ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                      {state.role === 'guest'
                        ? (
                          <label className='follow'>
                            <span>Follow host</span>
                            <input
                              type='checkbox'
                              checked={party.following()}
                              onChange={(event: TargetedEvent<HTMLInputElement>) => party.setFollowing(event.currentTarget.checked)}
                            />
                          </label>
                        )
                        : undefined}
                      <div className='actions'>
                        {state.role === 'guest'
                          ? (
                            <button type='button' onClick={() => { party.replay(); close() }}>
                              <Play size={14} strokeWidth={1.75} />
                              Catch up
                            </button>
                          )
                          : undefined}
                        <button type='button' onClick={() => { close(); navigate(PARTY_PATH) }}>
                          Manage
                        </button>
                        <button type='button' className='danger' onClick={() => { void party.leave(); close() }}>
                          <LogOut size={14} strokeWidth={1.75} />
                          {state.role === 'host' ? 'End' : 'Leave'}
                        </button>
                      </div>
                    </>
                  )
                  : ended
                    ? (
                      <>
                        <div className='title'>Watch together</div>
                        <div className='message'>
                          {state.status === 'ended' ? endMessage(state.reason) : failMessage(state.code)}
                        </div>
                        <div className='actions'>
                          <button type='button' onClick={() => { party.dismiss(); void party.create() }}>
                            Start new
                          </button>
                          <button type='button' onClick={() => { party.dismiss(); close() }}>
                            Dismiss
                          </button>
                        </div>
                      </>
                    )
                    : undefined}
            </div>
          </Popup>
        )
        : undefined}
    </div>
  )
}

export default PartyWidget
