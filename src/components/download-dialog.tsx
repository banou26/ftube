import type { TargetedEvent } from 'preact'
import type { AudioTrack, DownloadFormatOption } from '../frame/protocol'

import { css } from '@emotion/react'
import { Download, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'preact/hooks'
import { Link } from 'wouter'

import { closeDownloadDialog, formatBytes, startVideoDownload, useDownloadDialogTarget } from '../downloads/store'
import { startEngine } from '../engine/client'
import { audioTracksOf } from '../frame/formats'
import { Dialog } from './ui/dialog'

type DownloadMode = 'video' | 'audio'

const LARGE_DOWNLOAD_WARNING_BYTES = 512 * 1024 * 1024

const style = css`
  display: flex;
  flex-direction: column;
  gap: 1.6rem;

  .video-summary {
    display: flex;
    align-items: center;
    gap: 1.2rem;
  }

  .thumb {
    flex: none;
    width: 9.6rem;
    aspect-ratio: 16 / 9;
    border-radius: 0.6rem;
    object-fit: cover;
    background: var(--bg-elevated);
  }

  .meta {
    min-width: 0;
  }

  .video-title {
    font-size: 1.4rem;
    font-weight: 500;
    line-height: 2rem;
    color: var(--text-primary);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .video-channel {
    margin-top: 0.2rem;
    font-size: 1.2rem;
    color: var(--text-secondary);
  }

  .tabs {
    display: flex;
    gap: 0.8rem;
  }

  .tab {
    flex: 1;
    height: 3.6rem;
    border: 1px solid var(--border);
    border-radius: 0.8rem;
    background: var(--bg-chip);
    color: var(--text-primary);
    font: inherit;
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .tab:hover {
    background: var(--bg-chip-hover);
  }

  .tab[aria-selected='true'] {
    background: var(--bg-inverse);
    color: var(--text-inverse);
    border-color: var(--bg-inverse);
  }

  .track-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.2rem;
    font-size: 1.3rem;
    color: var(--text-secondary);
  }

  .track-select {
    height: 3.4rem;
    padding: 0 1rem;
    border: 1px solid var(--border);
    border-radius: 0.8rem;
    background: var(--bg-input);
    color: var(--text-primary);
    font: inherit;
    font-size: 1.3rem;
  }

  .formats {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    max-height: 24rem;
    overflow-y: auto;
  }

  .format-option {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.2rem;
    padding: 1rem 1.2rem;
    border: 1px solid var(--border);
    border-radius: 0.8rem;
    background: var(--bg-elevated);
    color: var(--text-primary);
    font: inherit;
    font-size: 1.4rem;
    text-align: left;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .format-option:hover {
    background: var(--bg-hover);
  }

  .format-option[aria-checked='true'] {
    border-color: var(--accent);
    background: var(--accent-hover);
  }

  .format-main {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    min-width: 0;
  }

  .format-label {
    font-weight: 500;
  }

  .format-badge {
    padding: 0.2rem 0.6rem;
    border-radius: 0.4rem;
    background: var(--bg-chip);
    color: var(--text-secondary);
    font-size: 1.2rem;
  }

  .format-size {
    color: var(--text-secondary);
    font-size: 1.3rem;
    white-space: nowrap;
  }

  .size-warning {
    margin: 0;
    padding: 0.8rem 1rem;
    border: 1px solid var(--border);
    border-radius: 0.8rem;
    background: var(--bg-elevated);
    color: var(--text-secondary);
    font-size: 1.2rem;
    line-height: 1.7rem;
  }

  .state {
    padding: 2rem 0;
    text-align: center;
    font-size: 1.4rem;
    color: var(--text-secondary);
  }

  .retry {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    margin-top: 1.2rem;
    height: 3.4rem;
    padding: 0 1.4rem;
    border: 1px solid var(--border-strong);
    border-radius: 1.7rem;
    background: transparent;
    color: var(--accent);
    font: inherit;
    font-size: 1.3rem;
    font-weight: 500;
    cursor: pointer;
  }

  .footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.2rem;
    padding-top: 0.4rem;
  }

  .manage-link {
    font-size: 1.4rem;
    font-weight: 500;
    color: var(--accent);
  }

  .manage-link:hover {
    text-decoration: underline;
  }

  .start-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.8rem;
    height: 3.8rem;
    padding: 0 1.8rem;
    border: none;
    border-radius: 1.9rem;
    background: var(--bg-inverse);
    color: var(--text-inverse);
    font: inherit;
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .start-btn:hover:not(:disabled) {
    background: var(--bg-inverse-hover);
  }

  .start-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
`

const pickDefaultAudioForVideo = (
  audioFormats: readonly DownloadFormatOption[],
  trackId: string | undefined,
): DownloadFormatOption | undefined => {
  const mp4 = audioFormats.filter((item) => item.container === 'm4a')
  const pool = mp4.length > 0 ? mp4 : audioFormats
  if (trackId) {
    const byTrack = pool.find((item) => item.audioTrackId === trackId)
    if (byTrack) return byTrack
  }
  return pool.find((item) => item.isOriginal) ?? pool[0]
}

/** Modal dialog for choosing Video (MP4) or Audio (M4A/WebM) download options and starting a download. */
export const DownloadDialog = (
  { videoId, title, thumbnail, channelName, onClose }: {
    videoId: string
    title: string
    thumbnail?: string | null
    channelName?: string | null
    onClose: () => void
  },
) => {
  const [mode, setMode] = useState<DownloadMode>('video')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)
  const [isLive, setIsLive] = useState(false)
  const [videoFormats, setVideoFormats] = useState<DownloadFormatOption[]>([])
  const [audioFormats, setAudioFormats] = useState<DownloadFormatOption[]>([])
  const [selectedVideoKey, setSelectedVideoKey] = useState<string | undefined>(undefined)
  const [selectedAudioKey, setSelectedAudioKey] = useState<string | undefined>(undefined)
  const [selectedTrackId, setSelectedTrackId] = useState<string | undefined>(undefined)
  const [reloadNonce, setReloadNonce] = useState(0)
  const tabsRef = useRef<HTMLDivElement>(null)
  const radioListRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(undefined)
    void (async () => {
      try {
        const result = await (await startEngine()).downloadFormats(videoId)
        if (!active) return
        setIsLive(result.isLive)
        setVideoFormats(result.videoFormats)
        setAudioFormats(result.audioFormats)
        const tracks = audioTracksOf(result.audioFormats)
        const defaultTrackId = (tracks.find((track) => track.original) ?? tracks[0])?.id
        setSelectedTrackId(defaultTrackId)
        setSelectedVideoKey(result.videoFormats[0]?.key)
        const firstAudio = pickDefaultAudioForVideo(result.audioFormats, defaultTrackId) ?? result.audioFormats[0]
        setSelectedAudioKey(firstAudio?.key)
        if (result.videoFormats.length === 0 && result.audioFormats.length > 0) setMode('audio')
      } catch (err) {
        if (!active) return
        const message = err instanceof Error ? err.message.replace(/^youtube:\s*/i, '') : String(err)
        setError(message)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [videoId, reloadNonce])

  const tracks: AudioTrack[] = audioTracksOf(audioFormats)
  const mp4AudioForTrack = pickDefaultAudioForVideo(audioFormats, selectedTrackId)
  const activeVideo = videoFormats.find((item) => item.key === selectedVideoKey) ?? videoFormats[0]
  const activeAudio = audioFormats.find((item) => item.key === selectedAudioKey) ?? audioFormats[0]

  const selectedEstimatedBytes = mode === 'video'
    ? (activeVideo?.estimatedBytes !== undefined && mp4AudioForTrack?.estimatedBytes !== undefined
        ? activeVideo.estimatedBytes + mp4AudioForTrack.estimatedBytes
        : activeVideo?.estimatedBytes)
    : activeAudio?.estimatedBytes

  const canStart = !loading && !error && !isLive && (
    mode === 'video' ? Boolean(activeVideo && mp4AudioForTrack) : Boolean(activeAudio)
  )

  const onTabKeyDown = (event: KeyboardEvent) => {
    const order: DownloadMode[] = ['video', 'audio']
    const index = order.indexOf(mode)
    let nextIndex = -1
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % order.length
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + order.length) % order.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = order.length - 1
    if (nextIndex < 0) return
    event.preventDefault()
    setMode(order[nextIndex]!)
    ;(tabsRef.current?.children[nextIndex] as HTMLElement | undefined)?.focus()
  }

  const onRadioKeyDown = (
    event: KeyboardEvent,
    options: readonly DownloadFormatOption[],
    activeKey: string | undefined,
    onSelect: (key: string) => void,
  ) => {
    if (options.length === 0) return
    const currentIndex = Math.max(0, options.findIndex((item) => item.key === activeKey))
    let nextIndex = -1
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % options.length
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + options.length) % options.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = options.length - 1
    if (nextIndex < 0) return
    event.preventDefault()
    onSelect(options[nextIndex]!.key)
    const radios = radioListRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
    radios?.[nextIndex]?.focus()
  }

  const onStart = () => {
    if (mode === 'video') {
      if (!activeVideo || !mp4AudioForTrack) return
      void startVideoDownload({
        target: { videoId, title, thumbnail, channelName },
        mode: 'video',
        videoKey: activeVideo.key,
        audioKey: mp4AudioForTrack.key,
        qualityLabel: `${activeVideo.qualityLabel} (${activeVideo.codec})`,
        container: 'mp4',
        estimatedBytes: selectedEstimatedBytes,
      })
      onClose()
      return
    }
    if (!activeAudio) return
    void startVideoDownload({
      target: { videoId, title, thumbnail, channelName },
      mode: 'audio',
      audioKey: activeAudio.key,
      qualityLabel: `${activeAudio.container.toUpperCase()} ${activeAudio.qualityLabel}`,
      container: activeAudio.container,
      estimatedBytes: activeAudio.estimatedBytes,
    })
    onClose()
  }

  return (
    <Dialog title='Download' onClose={onClose}>
      <div css={style}>
        <div className='video-summary'>
          {thumbnail ? <img className='thumb' src={thumbnail} alt='' /> : undefined}
          <div className='meta'>
            <div className='video-title'>{title}</div>
            {channelName ? <div className='video-channel'>{channelName}</div> : undefined}
          </div>
        </div>

        <div ref={tabsRef} className='tabs' role='tablist' aria-label='Download type' onKeyDown={onTabKeyDown}>
          <button
            id='dl-tab-video'
            type='button'
            role='tab'
            className='tab'
            aria-controls='dl-tabpanel'
            aria-selected={mode === 'video'}
            tabIndex={mode === 'video' ? 0 : -1}
            onClick={() => setMode('video')}
          >
            Video (MP4)
          </button>
          <button
            id='dl-tab-audio'
            type='button'
            role='tab'
            className='tab'
            aria-controls='dl-tabpanel'
            aria-selected={mode === 'audio'}
            tabIndex={mode === 'audio' ? 0 : -1}
            onClick={() => setMode('audio')}
          >
            Audio
          </button>
        </div>

        <div id='dl-tabpanel' role='tabpanel' aria-labelledby={mode === 'video' ? 'dl-tab-video' : 'dl-tab-audio'}>
          {loading
            ? <div className='state'>Loading formats…</div>
            : error
            ? (
              <div className='state'>
                <div>Could not load formats: {error}</div>
                <button type='button' className='retry' onClick={() => setReloadNonce((n) => n + 1)}>
                  <RefreshCw size={14} strokeWidth={1.75} />
                  Retry
                </button>
              </div>
            )
            : isLive
            ? <div className='state'>Live streams cannot be downloaded while broadcasting.</div>
            : mode === 'video'
            ? (
              <>
                {tracks.length > 1
                  ? (
                    <label className='track-row'>
                      <span>Audio language</span>
                      <select
                        className='track-select'
                        value={selectedTrackId ?? ''}
                        onChange={(event: TargetedEvent<HTMLSelectElement>) => setSelectedTrackId(event.currentTarget.value)}
                      >
                        {tracks.map((track) => (
                          <option key={track.id} value={track.id}>{track.label}</option>
                        ))}
                      </select>
                    </label>
                  )
                  : undefined}
                <div
                  ref={radioListRef}
                  className='formats'
                  role='radiogroup'
                  aria-label='Video quality'
                  onKeyDown={(event: KeyboardEvent) => onRadioKeyDown(event, videoFormats, activeVideo?.key, setSelectedVideoKey)}
                >
                  {videoFormats.length > 0
                    ? videoFormats.map((format) => {
                      const checked = format.key === activeVideo?.key
                      const totalBytes = format.estimatedBytes !== undefined && mp4AudioForTrack?.estimatedBytes !== undefined
                        ? format.estimatedBytes + mp4AudioForTrack.estimatedBytes
                        : format.estimatedBytes
                      return (
                        <button
                          key={format.key}
                          type='button'
                          role='radio'
                          aria-checked={checked}
                          tabIndex={checked ? 0 : -1}
                          className='format-option'
                          onClick={() => setSelectedVideoKey(format.key)}
                        >
                          <span className='format-main'>
                            <span className='format-label'>{format.qualityLabel}</span>
                            <span className='format-badge'>{format.codec}</span>
                          </span>
                          {totalBytes ? <span className='format-size'>~{formatBytes(totalBytes)}</span> : undefined}
                        </button>
                      )
                    })
                    : <div className='state'>No MP4 video formats available.</div>}
                </div>
              </>
            )
            : (
              <div
                ref={radioListRef}
                className='formats'
                role='radiogroup'
                aria-label='Audio format'
                onKeyDown={(event: KeyboardEvent) => onRadioKeyDown(event, audioFormats, activeAudio?.key, setSelectedAudioKey)}
              >
                {audioFormats.length > 0
                  ? audioFormats.map((format) => {
                    const checked = format.key === activeAudio?.key
                    return (
                      <button
                        key={format.key}
                        type='button'
                        role='radio'
                        aria-checked={checked}
                        tabIndex={checked ? 0 : -1}
                        className='format-option'
                        onClick={() => setSelectedAudioKey(format.key)}
                      >
                        <span className='format-main'>
                          <span className='format-label'>
                            {format.container.toUpperCase()} {format.qualityLabel}
                          </span>
                          <span className='format-badge'>{format.codec}</span>
                          {format.audioTrackName && tracks.length > 1
                            ? <span className='format-badge'>{format.audioTrackName}</span>
                            : undefined}
                        </span>
                        {format.estimatedBytes
                          ? <span className='format-size'>~{formatBytes(format.estimatedBytes)}</span>
                          : undefined}
                      </button>
                    )
                  })
                  : <div className='state'>No audio formats available.</div>}
              </div>
            )}
        </div>

        {!loading && !error && !isLive && selectedEstimatedBytes && selectedEstimatedBytes > LARGE_DOWNLOAD_WARNING_BYTES
          ? (
            <p className='size-warning'>
              Large file (~{formatBytes(selectedEstimatedBytes)}): assembled in browser memory before saving.
            </p>
          )
          : undefined}

        <div className='footer'>
          <Link href='/downloads' className='manage-link' onClick={onClose}>
            Manage downloads
          </Link>
          <button type='button' className='start-btn' disabled={!canStart} onClick={onStart}>
            <Download size={18} strokeWidth={1.75} />
            Download
          </button>
        </div>
      </div>
    </Dialog>
  )
}

/** Global portal host mounting `DownloadDialog` whenever a card menu or watch page triggers a download. */
export const DownloadDialogHost = () => {
  const target = useDownloadDialogTarget()
  if (!target) return null
  return (
    <DownloadDialog
      key={target.videoId}
      videoId={target.videoId}
      title={target.title}
      thumbnail={target.thumbnail}
      channelName={target.channelName}
      onClose={closeDownloadDialog}
    />
  )
}

export default DownloadDialog
