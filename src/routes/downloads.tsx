import { css } from '@emotion/react'
import { Download, RotateCcw, Trash2, X } from 'lucide-react'
import { Link } from 'wouter'

import { useDocumentTitle } from '../app'
import {
  cancelDownload,
  clearCompletedDownloads,
  downloadPercent,
  downloadStatusLabel,
  formatBytes,
  isDownloadActive,
  openDownloadDialog,
  removeDownload,
  saveCompletedAgain,
  useDownloads,
} from '../downloads/store'
import { watchHrefFor } from '../components/video-card'

const style = css`
  max-width: 88rem;
  padding: 2.4rem 1.6rem;

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.2rem;
    margin-bottom: 2.4rem;
  }

  .heading {
    margin: 0;
    font-size: 2rem;
    font-weight: 700;
    line-height: 2.8rem;
    color: var(--text-primary);
  }

  .clear-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    height: 3.6rem;
    padding: 0 1.4rem;
    border: none;
    border-radius: 1.8rem;
    background: var(--bg-chip);
    color: var(--text-primary);
    font: inherit;
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .clear-btn:hover {
    background: var(--bg-chip-hover);
  }

  .section + .section {
    margin-top: 2.8rem;
  }

  .section-title {
    margin: 0 0 1.2rem;
    font-size: 1.6rem;
    font-weight: 500;
    color: var(--text-primary);
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 1.2rem;
    padding: 1.2rem;
    border: 1px solid var(--border);
    border-radius: 1.2rem;
    background: var(--bg-subtle);
  }

  .thumb {
    flex: none;
    width: 12.8rem;
    aspect-ratio: 16 / 9;
    border-radius: 0.8rem;
    object-fit: cover;
    background: var(--bg-elevated);
  }

  .info {
    flex: 1;
    min-width: 0;
  }

  .title {
    display: block;
    font-size: 1.5rem;
    font-weight: 500;
    line-height: 2.1rem;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .title:hover {
    text-decoration: underline;
  }

  .details {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem 1.2rem;
    margin-top: 0.4rem;
    font-size: 1.3rem;
    color: var(--text-secondary);
  }

  .error-text {
    margin-top: 0.4rem;
    font-size: 1.3rem;
    color: var(--danger);
  }

  .progress-track {
    margin-top: 0.8rem;
    height: 0.5rem;
    border-radius: 0.3rem;
    background: var(--bg-chip);
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--accent);
    transition: width 0.2s ease;
  }

  .row-actions {
    flex: none;
    display: flex;
    align-items: center;
    gap: 0.8rem;
  }

  .action-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    height: 3.4rem;
    padding: 0 1.2rem;
    border: none;
    border-radius: 1.7rem;
    background: var(--bg-chip);
    color: var(--text-primary);
    font: inherit;
    font-size: 1.3rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .action-btn:hover {
    background: var(--bg-chip-hover);
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 3.4rem;
    height: 3.4rem;
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

  .empty {
    padding: 4.8rem 1.6rem;
    border-top: 1px solid var(--border-subtle);
    color: var(--text-secondary);
    font-size: 1.4rem;
  }

  @media (max-width: 640px) {
    .row {
      flex-wrap: wrap;
    }

    .thumb {
      width: 100%;
    }
  }
`

/** Page displaying active downloads and completed download history. */
export const DownloadsPage = () => {
  useDocumentTitle('Downloads')
  const items = useDownloads()
  const active = items.filter(isDownloadActive)
  const finished = items.filter((item) => !isDownloadActive(item))

  return (
    <main css={style}>
      <div className='head'>
        <h1 className='heading'>Downloads</h1>
        {finished.length > 0
          ? (
            <button type='button' className='clear-btn' onClick={clearCompletedDownloads}>
              <Trash2 size={16} strokeWidth={1.75} />
              Clear history
            </button>
          )
          : undefined}
      </div>

      {items.length === 0
        ? (
          <div className='empty'>
            No downloads yet. Choose Download on a video page or card menu to save MP4 video or audio.
          </div>
        )
        : undefined}

      {active.length > 0
        ? (
          <section className='section' aria-label='Active downloads'>
            <h2 className='section-title'>Active ({active.length})</h2>
            <div className='list'>
              {active.map((item) => {
                const percent = downloadPercent(item)
                return (
                  <article key={item.id} className='row'>
                    {item.thumbnail ? <img className='thumb' src={item.thumbnail} alt='' /> : undefined}
                    <div className='info'>
                      <Link href={watchHrefFor(item.videoId)} className='title'>{item.title}</Link>
                      <div className='details'>
                        <span>{item.qualityLabel}</span>
                        {item.clipLabel ? <span>{item.clipLabel}</span> : undefined}
                        <span>{downloadStatusLabel(item.status)}</span>
                        <span>
                          {formatBytes(item.loadedBytes)}
                          {item.totalBytes ? ` / ~${formatBytes(item.totalBytes)}` : ''}
                          {percent !== undefined ? ` (${percent}%)` : ''}
                        </span>
                      </div>
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
                    </div>
                    <div className='row-actions'>
                      <button
                        type='button'
                        className='icon-btn'
                        aria-label={`Cancel ${item.title}`}
                        onClick={() => { void cancelDownload(item.id) }}
                      >
                        <X size={18} strokeWidth={1.75} />
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        )
        : undefined}

      {finished.length > 0
        ? (
          <section className='section' aria-label='Completed and past downloads'>
            <h2 className='section-title'>History</h2>
            <div className='list'>
              {finished.map((item) => (
                <article key={item.id} className='row'>
                  {item.thumbnail ? <img className='thumb' src={item.thumbnail} alt='' /> : undefined}
                  <div className='info'>
                    <Link href={watchHrefFor(item.videoId)} className='title'>{item.title}</Link>
                    <div className='details'>
                      <span>{item.qualityLabel}</span>
                      {item.clipLabel ? <span>{item.clipLabel}</span> : undefined}
                      <span>{item.status === 'completed' && item.sizeBytes ? formatBytes(item.sizeBytes) : downloadStatusLabel(item.status)}</span>
                      {item.channelName ? <span>{item.channelName}</span> : undefined}
                    </div>
                    {item.error ? <div className='error-text'>{item.error}</div> : undefined}
                  </div>
                  <div className='row-actions'>
                    {item.status === 'completed' && item.blobUrl
                      ? (
                        <button type='button' className='action-btn' onClick={() => saveCompletedAgain(item.id)}>
                          <Download size={16} strokeWidth={1.75} />
                          Save file
                        </button>
                      )
                      : (
                        <button
                          type='button'
                          className='action-btn'
                          onClick={() => openDownloadDialog({
                            videoId: item.videoId,
                            title: item.title,
                            thumbnail: item.thumbnail,
                            channelName: item.channelName,
                          })}
                        >
                          <RotateCcw size={16} strokeWidth={1.75} />
                          Download again
                        </button>
                      )}
                    <button
                      type='button'
                      className='icon-btn'
                      aria-label={`Remove ${item.title}`}
                      onClick={() => removeDownload(item.id)}
                    >
                      <Trash2 size={16} strokeWidth={1.75} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )
        : undefined}
    </main>
  )
}

export default DownloadsPage
