import type { TargetedEvent, TargetedSubmitEvent } from 'preact'

import { css } from '@emotion/react'
import { MessageCircle, Send, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'preact/hooks'

import { party } from '../party'
import { chatText, MAX_CHAT_LENGTH } from '../party/protocol'
import { useParty, usePartyMessages, usePartyPresence } from '../party/use-party'
import { EmojiButton, insertAtCursor } from './emoji-picker'
import { PartyAvatar } from './party-avatar'

const style = css`
  position: fixed;
  left: 2rem;
  bottom: 2rem;
  z-index: var(--z-popup);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1rem;

  .toggle {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 4.8rem;
    height: 4.8rem;
    border: 1px solid var(--border-strong);
    border-radius: 50%;
    background: var(--bg-menu);
    color: var(--text-primary);
    cursor: pointer;
    box-shadow: var(--shadow-menu);
    transition: background 0.15s ease;
  }

  .toggle:hover {
    background: var(--bg-chip-hover);
  }

  .unread {
    position: absolute;
    top: -0.3rem;
    right: -0.3rem;
    min-width: 1.8rem;
    height: 1.8rem;
    padding: 0 0.5rem;
    border-radius: 0.9rem;
    background: var(--membership);
    color: #ffffff;
    font-size: 1.1rem;
    font-weight: 700;
    line-height: 1.8rem;
    text-align: center;
  }

  .panel {
    display: flex;
    flex-direction: column;
    width: min(32rem, calc(100vw - 4rem));
    height: min(38rem, calc(100vh - 12rem));
    border: 1px solid var(--border);
    border-radius: 1.2rem;
    background: var(--bg-menu);
    color: var(--text-primary);
    box-shadow: var(--shadow-menu);
    overflow: hidden;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.4rem;
    border-bottom: 1px solid var(--border-subtle);
    font-size: 1.4rem;
    font-weight: 600;
  }

  .head button {
    display: flex;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .head button:hover {
    color: var(--text-primary);
  }

  .lines {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 1rem 1.4rem;
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    font-size: 1.3rem;
    line-height: 1.4;
  }

  .line {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    overflow-wrap: anywhere;
  }

  .line .who {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 1.1rem;
    color: var(--text-secondary);
  }

  .line.self .who {
    color: var(--membership);
  }

  .empty {
    color: var(--text-secondary);
  }

  form {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.8rem;
    border-top: 1px solid var(--border-subtle);
  }

  form input {
    flex: 1;
    min-width: 0;
    height: 3.6rem;
    padding: 0 1.2rem;
    border: 1px solid var(--border);
    border-radius: 1.8rem;
    background: var(--bg-input);
    color: var(--text-primary);
    font-size: 1.3rem;
    outline: none;
  }

  form input:focus {
    border-color: var(--accent-focus);
  }

  form button[type='submit'] {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 3.6rem;
    height: 3.6rem;
    border: none;
    border-radius: 50%;
    background: var(--bg-chip);
    color: var(--text-primary);
    cursor: pointer;
  }

  form button[type='submit']:hover {
    background: var(--bg-chip-hover);
  }
`

const senderLabel = (line: { from: string, name?: string, self: boolean }, owner: string) =>
  line.self ? 'You' : (party.nameOf(line.from) ?? line.name ?? (line.from === owner ? 'Host' : line.from.slice(0, 6)))

/** Floating Watch Together chat drawer pinned bottom-left to stay clear of the bottom-right miniplayer. */
export const PartyChat = () => {
  const state = useParty()
  usePartyPresence()
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const openRef = useRef(open)
  openRef.current = open

  const active = state.status === 'active'
  const invite = active ? state.invite : undefined
  const lines = active ? party.chat() : []

  useEffect(() => {
    setOpen(false)
    setUnread(0)
    setDraft('')
  }, [invite])

  usePartyMessages((message, { self }) => {
    if (message.t === 'chat' && !self && !openRef.current) {
      setUnread((count) => count + 1)
    }
  })

  useEffect(() => {
    if (!open) return
    setUnread(0)
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [open, lines.length])

  if (!active) return null

  const pickEmoji = (emoji: string) => {
    const input = inputRef.current
    const start = input?.selectionStart ?? draft.length
    const end = input?.selectionEnd ?? draft.length
    const next = insertAtCursor(draft, start, end, emoji)
    const value = next.value.slice(0, MAX_CHAT_LENGTH)
    const cursor = Math.min(next.cursor, value.length)
    setDraft(value)
    requestAnimationFrame(() => {
      const current = inputRef.current
      if (!current) return
      current.focus()
      current.setSelectionRange(cursor, cursor)
    })
  }

  const submit = (event: TargetedSubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = chatText(draft)
    if (!text) return
    party.send({ t: 'chat', text })
    setDraft('')
  }

  return (
    <div css={style}>
      {open
        ? (
          <section className='panel' aria-label='Party chat'>
            <div className='head'>
              <span>Party chat</span>
              <button type='button' aria-label='Close chat' onClick={() => setOpen(false)}>
                <X size={18} strokeWidth={1.75} />
              </button>
            </div>
            <div className='lines' ref={listRef}>
              {lines.length === 0
                ? <span className='empty'>No messages yet.</span>
                : lines.map((line) => (
                  <div key={line.id} className={line.self ? 'line self' : 'line'}>
                    <span className='who'>
                      <PartyAvatar participant={party.identityOf(line.from)} size={18} />
                      <span>{senderLabel(line, state.owner)}</span>
                    </span>
                    <span>{line.text}</span>
                  </div>
                ))}
            </div>
            <form onSubmit={submit}>
              <input
                ref={inputRef}
                value={draft}
                maxLength={MAX_CHAT_LENGTH}
                placeholder='Message'
                aria-label='Party message'
                onInput={(event: TargetedEvent<HTMLInputElement>) => setDraft(event.currentTarget.value)}
              />
              <EmojiButton onPick={pickEmoji} />
              <button type='submit' aria-label='Send message'>
                <Send size={16} strokeWidth={1.75} />
              </button>
            </form>
          </section>
        )
        : undefined}
      <button
        type='button'
        className='toggle'
        aria-label='Party chat'
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MessageCircle size={22} strokeWidth={1.75} />
        {!open && unread > 0 ? <span className='unread'>{unread > 99 ? '99+' : unread}</span> : undefined}
      </button>
    </div>
  )
}

export default PartyChat
