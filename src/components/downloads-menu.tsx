import type { DownloadItem } from '../downloads/store'

import { css } from '@emotion/react'
import { AlertCircle, Check, Download, RotateCcw, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { Link, useLocation } from 'wouter'

import {
  cancelDownload,
  dismissDownloadFromTray,
  dismissFinishedFromTray,
  downloadPercent,
  downloadStatusLabel,
  formatBytes,
  isDownloadActive,
  openDownloadDialog,
  saveCompletedAgain,
  useDownloadTray,
} from '../downloads/store'
import { Popup, useDismiss } from './ui/popup'
import { watchHrefFor } from './video-card'

const RING_RADIUS = 8
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

const rootStyle = css`
  position: relative;
  display: flex;
  align-items: center;
  flex: none;
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

  &.done {
    border-color: var(--membership);
  }

  &.failed {
    border-color: var(--danger);
  }

  .ring-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    flex: none;
  }

  .ring {
    display: block;
    transform: rotate(-90deg);
  }

  .ring-track {
    fill: none;
    stroke: var(--bg-chip);
    stroke-width: 2;
  }

  .ring-arc {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2;
    stroke-linecap: round;
    transition: stroke-dashoffset 0.2s ease;
  }

  .ring-icon {
    position: absolute;
    color: var(--text-primary);
  }

  .done-icon {
    color: var(--membership);
  }

  .failed-icon {
    color: var(--danger);
  }

  @media (max-width: 1359px) {
    padding: 0 0.8rem;

    .label {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
  }

  @media (max-width: 656px) {
    width: 3.6rem;
    padding: 0;
    justify-content: center;
  }
`

const panelStyle = css`
  width: min(36rem, calc(100vw - 1.6rem));
  padding: 1.2rem 1.4rem;
  color: var(--text-primary);
  font-size: 1.3rem;

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
  }

  .head-title {
    font-size: 1.4rem;
    font-weight: 600;
  }

  .head-meta {
    margin-left: 0.6rem;
    font-size: 1.2rem;
    font-weight: 400;
    color: var(--text-secondary);
  }

  .head-actions {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .clear-link {
    border: none;
    padding: 0;
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: 1.2rem;
    font-weight: 500;
    cursor: pointer;
  }

  .clear-link:hover {
    color: var(--text-primary);
  }

  .all-link {
    color: var(--accent);
    font-size: 1.3rem;
    font-weight: 500;
    white-space: nowrap;
  }

  .all-link:hover {
    text-decoration: underline;
  }

  .items {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    max-height: 40rem;
    margin-top: 1rem;
    overflow-y: auto;
  }

  .item {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.9rem 1rem;
    border: 1px solid var(--border);
    border-radius: 0.8rem;
    background: var(--bg-subtle);
  }

  .item-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.8rem;
  }

  .item-title {
    flex: 1;
    min-width: 0;
    font-size: 1.3rem;
    font-weight: 500;
    line-height: 1.8rem;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .item-title:hover {
    text-decoration: underline;
  }

  .item-controls {
    flex: none;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .item-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    height: 2.6rem;
    padding: 0 0.9rem;
    border: none;
    border-radius: 1.3rem;
    background: var(--bg-chip);
    color: var(--text-primary);
    font: inherit;
    font-size: 1.2rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .item-btn:hover {
    background: var(--bg-chip-hover);
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.6rem;
    height: 2.6rem;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .icon-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .item-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 0.8rem;
    font-size: 1.2rem;
    color: var(--text-secondary);
  }

  .error-text {
    font-size: 1.2rem;
    color: var(--danger);
  }

  .progress-track {
    height: 0.4rem;
    border-radius: 0.2rem;
    background: var(--bg-chip);
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--accent);
    transition: width 0.2s ease;
  }
`

const aggregateProgress = (active: readonly DownloadItem[]): number | undefined => {
  let loaded = 0
  let total = 0
  for (const item of active) {
    if (item.totalBytes && item.totalBytes > 0) {
      loaded += Math.min(item.loadedBytes, item.totalBytes)
      total += item.totalBytes
    }
  }
  return total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : undefined
}

/** Floating header pill and popover showing active and recent download progress across routes. */
export const DownloadsMenu = () => {
  const tray = useDownloadTray()
  const [location] = useLocation()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const lastStartedSeqRef = useRef(tray.startedSeq)

  const close = useCallback(() => setOpen(false), [])
  useDismiss({ open, onClose: close, rootRef, panelRef, triggerRef })

  useEffect(() => {
    if (tray.startedSeq > lastStartedSeqRef.current) {
      lastStartedSeqRef.current = tray.startedSeq
      if (location !== '/downloads') setOpen(true)
    }
  }, [tray.startedSeq, location])

  useEffect(() => {
    if (tray.items.length === 0) setOpen(false)
  }, [tray.items.length])

  if (tray.items.length === 0) return null

  const { items, active } = tray
  const finishedCount = items.length - active.length
  const aggregatePercent = active.length > 0 ? aggregateProgress(active) : undefined
  const allMuxing = active.length > 0 && active.every((item) => item.status === 'muxing')
  const hasFailed = active.length === 0 && items.some((item) => item.status === 'failed')

  const triggerLabel = active.length > 0
    ? active.length > 1
      ? (allMuxing
          ? `${active.length} · Muxing…`
          : aggregatePercent !== undefined
            ? `${active.length} · ${aggregatePercent}%`
            : `${active.length} active`)
      : (allMuxing
          ? 'Muxing…'
          : aggregatePercent !== undefined
            ? `${aggregatePercent}%`
            : 'Preparing…')
    : hasFailed
      ? 'Failed'
      : 'Done'

  const triggerAriaLabel = active.length > 0
    ? `Downloads: ${active.length} active${aggregatePercent !== undefined ? `, ${aggregatePercent}%` : ''}`
    : `Downloads: ${hasFailed ? 'failed' : 'completed'}`

  const ringFraction = allMuxing
    ? 1
    : aggregatePercent !== undefined
      ? aggregatePercent / 100
      : 0.25
  const ringOffset = RING_CIRCUMFERENCE * (1 - ringFraction)

  return (
    <div css={rootStyle} ref={rootRef}>
      <button
        ref={triggerRef}
        type='button'
        css={triggerStyle}
        className={active.length === 0 ? (hasFailed ? 'failed' : 'done') : undefined}
        aria-label={triggerAriaLabel}
        aria-haspopup='dialog'
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {active.length > 0
          ? (
            <span className='ring-wrap' aria-hidden='true'>
              <svg className='ring' width='20' height='20' viewBox='0 0 20 20'>
                <circle className='ring-track' cx='10' cy='10' r={RING_RADIUS} />
                <circle
                  className='ring-arc'
                  cx='10'
                  cy='10'
                  r={RING_RADIUS}
                  strokeDasharray={RING_CIRCUMFERENCE}
                  strokeDashoffset={ringOffset}
                />
              </svg>
              <Download className='ring-icon' size={10} strokeWidth={2.2} />
            </span>
          )
          : hasFailed
            ? <AlertCircle className='failed-icon' size={18} strokeWidth={1.75} aria-hidden='true' />
            : <Check className='done-icon' size={18} strokeWidth={2} aria-hidden='true' />}
        <span className='label'>{triggerLabel}</span>
      </button>

      {open
        ? (
          <Popup label='Downloads' align='end' anchor={triggerRef} panelRef={panelRef}>
            <div css={panelStyle}>
              <div className='head'>
                <div>
                  <span className='head-title'>Downloads</span>
                  {active.length > 0 ? <span className='head-meta'>· {active.length} active</span> : undefined}
                </div>
                <div className='head-actions'>
                  {finishedCount > 0
                    ? (
                      <button type='button' className='clear-link' onClick={dismissFinishedFromTray}>
                        Clear
                      </button>
                    )
                    : undefined}
                  <Link href='/downloads' className='all-link' onClick={close}>
                    All downloads
                  </Link>
                </div>
              </div>

              <div className='items'>
                {items.map((item) => {
                  const isActive = isDownloadActive(item)
                  const percent = downloadPercent(item)
                  return (
                    <article key={item.id} className='item'>
                      <div className='item-top'>
                        <Link href={watchHrefFor(item.videoId)} className='item-title' onClick={close}>
                          {item.title}
                        </Link>
                        <div className='item-controls'>
                          {!isActive && item.status === 'completed' && item.blobUrl
                            ? (
                              <button type='button' className='item-btn' onClick={() => saveCompletedAgain(item.id)}>
                                Save file
                              </button>
                            )
                            : !isActive
                              ? (
                                <button
                                  type='button'
                                  className='item-btn'
                                  onClick={() => {
                                    close()
                                    openDownloadDialog({
                                      videoId: item.videoId,
                                      title: item.title,
                                      thumbnail: item.thumbnail,
                                      channelName: item.channelName,
                                    })
                                  }}
                                >
                                  <RotateCcw size={12} strokeWidth={1.75} />
                                  Download again
                                </button>
                              )
                              : undefined}
                          <button
                            type='button'
                            className='icon-btn'
                            aria-label={isActive ? `Cancel ${item.title}` : `Dismiss ${item.title}`}
                            onClick={() => {
                              if (isActive) void cancelDownload(item.id)
                              else dismissDownloadFromTray(item.id)
                            }}
                          >
                            <X size={15} strokeWidth={1.75} />
                          </button>
                        </div>
                      </div>

                      <div className='item-meta'>
                        <span>{item.qualityLabel}</span>
                        <span>
                          {!isActive && item.status === 'completed' && item.sizeBytes
                            ? formatBytes(item.sizeBytes)
                            : downloadStatusLabel(item.status)}
                        </span>
                        {isActive
                          ? (
                            <span>
                              {formatBytes(item.loadedBytes)}
                              {item.totalBytes ? ` / ~${formatBytes(item.totalBytes)}` : ''}
                              {percent !== undefined ? ` (${percent}%)` : ''}
                            </span>
                          )
                          : undefined}
                      </div>

                      {item.error ? <div className='error-text'>{item.error}</div> : undefined}

                      {isActive
                        ? (
                          <div
                            className='progress-track'
                            role='progressbar'
                            aria-label={`${item.title} download progress`}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={percent}
                          >
                            <div className='progress-fill' style={{ width: `${percent ?? 15}%` }} />
                          </div>
                        )
                        : undefined}
                    </article>
                  )
                })}
              </div>
            </div>
          </Popup>
        )
        : undefined}
    </div>
  )
}

export default DownloadsMenu
