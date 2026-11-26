import { css } from '@emotion/react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, ListVideo, X } from 'lucide-react'
import { useState } from 'preact/hooks'
import { Link } from 'wouter'

import { clearQueue, getQueue, moveInQueue, removeFromQueue, restoreQueue, setQueueIndex, useQueue } from '../player/queue'
import { showUndoableToast } from '../undo'
import { formatDuration } from './format'
import { Thumbnail } from './thumbnail'
import { watchHrefFor } from './video-card'

const style = css`
  border: 1px solid var(--border-subtle);
  border-radius: 1.2rem;
  overflow: hidden;
  background: var(--bg-base);

  .panel-header {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 1.2rem 1.2rem 1.2rem 1.6rem;
    background: var(--bg-subtle);
  }

  .panel-meta {
    flex: 1;
    min-width: 0;
  }

  .panel-title {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    margin: 0;
    font-size: 1.6rem;
    font-weight: 700;
    line-height: 2.2rem;
    color: var(--text-primary);
  }

  .panel-sub {
    margin-top: 0.2rem;
    font-size: 1.2rem;
    line-height: 1.6rem;
    color: var(--text-secondary);
  }

  .clear,
  .collapse {
    flex: none;
    height: 3.2rem;
    border: none;
    border-radius: 1.6rem;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .clear {
    padding: 0 1.2rem;
    font-size: 1.3rem;
    font-weight: 500;
  }

  .collapse {
    width: 3.2rem;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .clear:hover,
  .collapse:hover {
    background: var(--bg-hover);
  }

  .rows {
    margin: 0;
    padding: 0.4rem 0;
    list-style: none;
    max-height: 40rem;
    overflow-y: auto;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.8rem 0.4rem 0;
    transition: background 0.15s ease;
  }

  .row:hover {
    background: var(--bg-hover);
  }

  .row[data-active='true'] {
    background: var(--bg-chip);
  }

  .item-link {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0.4rem 0.8rem 0.4rem 1.2rem;
    color: inherit;
    text-decoration: none;
  }

  .index {
    flex: none;
    width: 2rem;
    font-size: 1.2rem;
    color: var(--text-secondary);
    text-align: center;
  }

  .thumb {
    position: relative;
    flex: none;
    width: 10rem;
    aspect-ratio: 16 / 9;
    border-radius: 0.6rem;
    overflow: hidden;
    background: var(--bg-elevated);
  }

  .thumb img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .badge {
    position: absolute;
    right: 0.4rem;
    bottom: 0.4rem;
    padding: 0.1rem 0.4rem;
    border-radius: 0.4rem;
    background: var(--bg-badge);
    color: var(--text-on-media);
    font-size: 1.1rem;
    font-weight: 500;
  }

  .info {
    flex: 1;
    min-width: 0;
  }

  .video-title {
    font-size: 1.4rem;
    font-weight: 500;
    line-height: 1.8rem;
    color: var(--text-primary);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .channel {
    margin-top: 0.2rem;
    font-size: 1.2rem;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-actions {
    flex: none;
    display: flex;
    align-items: center;
    gap: 0.2rem;
  }

  .icon-btn {
    width: 2.8rem;
    height: 2.8rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .icon-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .icon-btn:disabled {
    cursor: default;
    opacity: 0.35;
  }
`

/** Watch-page panel displaying the local playback queue with reorder, remove, and clear controls. */
export const QueuePanel = () => {
  const queue = useQueue()
  const [collapsed, setCollapsed] = useState(false)

  if (queue.items.length === 0) return null

  const position = queue.currentIndex >= 0
    ? `${queue.currentIndex + 1} / ${queue.items.length}`
    : `${queue.items.length} queued`

  return (
    <section css={style} className='queue-panel' aria-label='Queue'>
      <header className='panel-header'>
        <div className='panel-meta'>
          <h2 className='panel-title'>
            <ListVideo size={18} strokeWidth={1.5} aria-hidden='true' />
            Queue
          </h2>
          <div className='panel-sub'>{position}</div>
        </div>
        <button
          type='button'
          className='clear'
          aria-label='Clear queue'
          onClick={() => {
            const snapshot = getQueue()
            clearQueue()
            showUndoableToast('Queue cleared', {
              label: 'Clear queue',
              undo: () => restoreQueue(snapshot),
              undoneMessage: 'Queue restored',
            })
          }}
        >
          Clear
        </button>
        <button
          type='button'
          className='collapse'
          aria-label={collapsed ? 'Expand queue' : 'Collapse queue'}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(value => !value)}
        >
          {collapsed ? <ChevronDown size={18} strokeWidth={1.5} /> : <ChevronUp size={18} strokeWidth={1.5} />}
        </button>
      </header>
      {!collapsed
        ? (
          <ol className='rows'>
            {queue.items.map((item, index) => {
              const duration = formatDuration(item.durationSeconds)
              const active = index === queue.currentIndex
              return (
                <li key={item.id} className='row' data-active={active ? 'true' : undefined}>
                  <Link
                    href={watchHrefFor(item.id)}
                    className='item-link'
                    onClick={() => setQueueIndex(index)}
                  >
                    <span className='index'>{active ? '▶' : index + 1}</span>
                    <span className='thumb'>
                      {item.thumbnail ? <Thumbnail src={item.thumbnail} sizes='10rem' /> : undefined}
                      {duration ? <span className='badge'>{duration}</span> : undefined}
                    </span>
                    <span className='info'>
                      <span className='video-title'>{item.title}</span>
                      {item.channel?.name ? <span className='channel'>{item.channel.name}</span> : undefined}
                    </span>
                  </Link>
                  <div className='row-actions'>
                    <button
                      type='button'
                      className='icon-btn'
                      aria-label={`Move ${item.title} up`}
                      disabled={index === 0}
                      onClick={() => moveInQueue(index, index - 1)}
                    >
                      <ArrowUp size={14} strokeWidth={1.5} />
                    </button>
                    <button
                      type='button'
                      className='icon-btn'
                      aria-label={`Move ${item.title} down`}
                      disabled={index === queue.items.length - 1}
                      onClick={() => moveInQueue(index, index + 1)}
                    >
                      <ArrowDown size={14} strokeWidth={1.5} />
                    </button>
                    <button
                      type='button'
                      className='icon-btn'
                      aria-label={`Remove ${item.title} from queue`}
                      onClick={() => {
                        const snapshot = getQueue()
                        removeFromQueue(index)
                        showUndoableToast('Removed from queue', {
                          label: `Remove ${item.title} from queue`,
                          undo: () => restoreQueue(snapshot),
                          undoneMessage: 'Restored to queue',
                        })
                      }}
                    >
                      <X size={14} strokeWidth={1.5} />
                    </button>
                  </div>
                </li>
              )
            })}
          </ol>
        )
        : undefined}
    </section>
  )
}
