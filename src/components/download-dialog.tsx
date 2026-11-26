import type { TargetedEvent } from 'preact'
import type { AudioTrack, DownloadFormatOption } from '../frame/protocol'

import { css } from '@emotion/react'
import { Download, Pause, Play, RefreshCw, RotateCcw, Scissors } from 'lucide-react'
import { useEffect, useRef, useState } from 'preact/hooks'
import { Link } from 'wouter'

import { LARGE_DOWNLOAD_WARNING_BYTES, MAX_DOWNLOAD_BYTES } from '../downloads/bytes'
import { closeDownloadDialog, formatBytes, pickDefaultAudioForVideo, startVideoDownload, useDownloadDialogTarget } from '../downloads/store'
import { clampTrimRange, estimateTrimmedBytes, formatClipLabel, formatTimestamp, isFullRange, MIN_CLIP_MS, parseTimestamp } from '../downloads/trim'
import { startEngine } from '../engine/client'
import { audioTracksOf } from '../frame/formats'
import { playerHost, usePlayerSession } from '../player/session'
import { Dialog } from './ui/dialog'

type DownloadMode = 'video' | 'audio'

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

  .crop-box {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1.2rem;
    border: 1px solid var(--border);
    border-radius: 0.8rem;
    background: var(--bg-elevated);
  }

  .crop-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .crop-toggle {
    display: inline-flex;
    padding: 0.2rem;
    border: 1px solid var(--border);
    border-radius: 0.8rem;
    background: var(--bg-surface);
    gap: 0.2rem;
  }

  .crop-mode-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    height: 2.8rem;
    padding: 0 1.2rem;
    border: none;
    border-radius: 0.6rem;
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: 1.3rem;
    font-weight: 500;
    cursor: pointer;
  }

  .crop-mode-btn[aria-pressed='true'] {
    background: var(--bg-inverse);
    color: var(--text-inverse);
  }

  .crop-summary {
    font-size: 1.3rem;
    font-weight: 500;
    color: var(--text-primary);
  }

  .dual-range {
    position: relative;
    height: 2.8rem;
    display: flex;
    align-items: center;
    cursor: pointer;
    touch-action: none;
  }

  .range-track {
    position: relative;
    width: 100%;
    height: 0.5rem;
    border-radius: 999px;
    background: var(--bg-chip);
  }

  .range-fill {
    position: absolute;
    top: 0;
    bottom: 0;
    border-radius: 999px;
    background: var(--accent);
  }

  .range-playhead {
    position: absolute;
    top: -0.45rem;
    width: 0.2rem;
    height: 1.4rem;
    border-radius: 1px;
    background: var(--text-primary);
    transform: translateX(-50%);
    pointer-events: none;
  }

  .range-thumb-input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    appearance: none;
    -webkit-appearance: none;
    background: transparent;
    pointer-events: none;
  }

  .range-thumb-input:focus-visible {
    outline: none;
  }

  .range-thumb-input::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    pointer-events: auto;
    width: 1.6rem;
    height: 1.6rem;
    border-radius: 50%;
    border: 2px solid var(--bg-surface);
    background: var(--text-primary);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
    cursor: ew-resize;
  }

  .range-thumb-input::-moz-range-thumb {
    pointer-events: auto;
    width: 1.6rem;
    height: 1.6rem;
    border-radius: 50%;
    border: 2px solid var(--bg-surface);
    background: var(--text-primary);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
    cursor: ew-resize;
  }

  .crop-fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
  }

  .crop-field {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .crop-field-label {
    font-size: 1.2rem;
    color: var(--text-secondary);
  }

  .crop-input-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .crop-input {
    min-width: 0;
    flex: 1;
    height: 3.2rem;
    padding: 0 0.8rem;
    border: 1px solid var(--border);
    border-radius: 0.6rem;
    background: var(--bg-input);
    color: var(--text-primary);
    font: inherit;
    font-size: 1.3rem;
    font-variant-numeric: tabular-nums;
  }

  .mini-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    height: 3.2rem;
    padding: 0 0.8rem;
    border: 1px solid var(--border);
    border-radius: 0.6rem;
    background: var(--bg-chip);
    color: var(--text-primary);
    font: inherit;
    font-size: 1.2rem;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
  }

  .mini-btn:hover:not(:disabled) {
    background: var(--bg-chip-hover);
  }

  .mini-btn:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .crop-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
  }

  .crop-action-group {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
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
    max-height: 22rem;
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

  @media (max-width: 520px) {
    .crop-fields {
      grid-template-columns: minmax(0, 1fr);
    }
  }
`

/** Modal dialog for choosing Video (MP4) or Audio (M4A/WebM) download options, optional clip cropping, and starting a download. */
export const DownloadDialog = (
  { videoId, title, thumbnail, channelName, onClose }: {
    videoId: string
    title: string
    thumbnail?: string | null
    channelName?: string | null
    onClose: () => void
  },
) => {
  const player = usePlayerSession()
  const [mode, setMode] = useState<DownloadMode>('video')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)
  const [isLive, setIsLive] = useState(false)
  const [durationMs, setDurationMs] = useState(0)
  const [cropEnabled, setCropEnabled] = useState(false)
  const [startMs, setStartMs] = useState(0)
  const [endMs, setEndMs] = useState(0)
  const [startDraft, setStartDraft] = useState('0:00')
  const [endDraft, setEndDraft] = useState('0:00')
  const [playerTimeMs, setPlayerTimeMs] = useState<number | undefined>(undefined)
  const [previewing, setPreviewing] = useState(false)
  const [videoFormats, setVideoFormats] = useState<DownloadFormatOption[]>([])
  const [audioFormats, setAudioFormats] = useState<DownloadFormatOption[]>([])
  const [selectedVideoKey, setSelectedVideoKey] = useState<string | undefined>(undefined)
  const [selectedAudioKey, setSelectedAudioKey] = useState<string | undefined>(undefined)
  const [selectedTrackId, setSelectedTrackId] = useState<string | undefined>(undefined)
  const [reloadNonce, setReloadNonce] = useState(0)
  const tabsRef = useRef<HTMLDivElement>(null)
  const radioListRef = useRef<HTMLDivElement>(null)
  const rangeBarRef = useRef<HTMLDivElement>(null)

  const hasWatchPlayer = player.videoId === videoId

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(undefined)
    void (async () => {
      try {
        const result = await (await startEngine()).downloadFormats(videoId)
        if (!active) return
        setIsLive(result.isLive)
        setDurationMs(result.durationMs)
        setStartMs(0)
        setEndMs(result.durationMs)
        setStartDraft(formatTimestamp(0))
        setEndDraft(formatTimestamp(result.durationMs))
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

  useEffect(() => {
    if (!hasWatchPlayer) {
      setPlayerTimeMs(undefined)
      setPreviewing(false)
      return
    }
    const videoEl = playerHost().querySelector('video')
    if (!videoEl) return
    const syncTime = () => {
      const currentMs = Math.round(videoEl.currentTime * 1000)
      setPlayerTimeMs(currentMs)
      if (previewing && currentMs >= endMs) {
        videoEl.pause()
        setPreviewing(false)
      }
    }
    syncTime()
    videoEl.addEventListener('timeupdate', syncTime)
    videoEl.addEventListener('seeked', syncTime)
    return () => {
      videoEl.removeEventListener('timeupdate', syncTime)
      videoEl.removeEventListener('seeked', syncTime)
    }
  }, [hasWatchPlayer, previewing, endMs])

  useEffect(() => () => {
    if (previewing) {
      playerHost().querySelector('video')?.pause()
    }
  }, [previewing])

  const applyRange = (nextStart: number, nextEnd: number, scrubTargetMs?: number) => {
    if (durationMs <= 0) return
    const clamped = clampTrimRange(nextStart, nextEnd, durationMs, MIN_CLIP_MS)
    setStartMs(clamped.startMs)
    setEndMs(clamped.endMs)
    setStartDraft(formatTimestamp(clamped.startMs))
    setEndDraft(formatTimestamp(clamped.endMs))
    if (scrubTargetMs !== undefined && hasWatchPlayer) {
      const videoEl = playerHost().querySelector('video')
      if (videoEl && Number.isFinite(videoEl.duration)) {
        videoEl.currentTime = scrubTargetMs / 1000
      }
    }
  }

  const commitStartDraft = () => {
    const parsed = parseTimestamp(startDraft, durationMs)
    if (parsed === undefined) {
      setStartDraft(formatTimestamp(startMs))
      return
    }
    const maxStart = Math.max(0, durationMs - Math.min(durationMs, MIN_CLIP_MS))
    const nextStart = Math.min(parsed, maxStart)
    const nextEnd = nextStart > endMs - Math.min(durationMs, MIN_CLIP_MS)
      ? Math.min(durationMs, nextStart + Math.min(durationMs, MIN_CLIP_MS))
      : endMs
    applyRange(nextStart, nextEnd, nextStart)
  }

  const commitEndDraft = () => {
    const parsed = parseTimestamp(endDraft, durationMs)
    if (parsed === undefined) {
      setEndDraft(formatTimestamp(endMs))
      return
    }
    const minEnd = Math.min(durationMs, MIN_CLIP_MS)
    const nextEnd = Math.max(parsed, minEnd)
    const nextStart = nextEnd < startMs + minEnd
      ? Math.max(0, nextEnd - minEnd)
      : startMs
    applyRange(nextStart, nextEnd, nextEnd)
  }

  const togglePreview = () => {
    const videoEl = playerHost().querySelector('video')
    if (!videoEl) return
    if (previewing) {
      videoEl.pause()
      setPreviewing(false)
      return
    }
    videoEl.currentTime = startMs / 1000
    setPreviewing(true)
    void videoEl.play().catch(() => setPreviewing(false))
  }

  const tracks: AudioTrack[] = audioTracksOf(audioFormats)
  const mp4AudioForTrack = pickDefaultAudioForVideo(audioFormats, selectedTrackId)
  const activeVideo = videoFormats.find((item) => item.key === selectedVideoKey) ?? videoFormats[0]
  const activeAudio = audioFormats.find((item) => item.key === selectedAudioKey) ?? audioFormats[0]

  const currentRange = cropEnabled && durationMs > 0 && !isFullRange({ startMs, endMs }, durationMs)
    ? { startMs, endMs }
    : undefined

  const rawSelectedBytes = mode === 'video'
    ? (activeVideo?.estimatedBytes !== undefined && mp4AudioForTrack?.estimatedBytes !== undefined
        ? activeVideo.estimatedBytes + mp4AudioForTrack.estimatedBytes
        : activeVideo?.estimatedBytes)
    : activeAudio?.estimatedBytes
  const selectedEstimatedBytes = estimateTrimmedBytes(rawSelectedBytes, durationMs, currentRange)
  const exceedsMaxBytes = Boolean(selectedEstimatedBytes && selectedEstimatedBytes > MAX_DOWNLOAD_BYTES)

  const canStart = !loading && !error && !isLive && !exceedsMaxBytes && (
    mode === 'video' ? Boolean(activeVideo && mp4AudioForTrack) : Boolean(activeAudio)
  )
  const canCrop = !loading && !error && !isLive && durationMs >= 2_000

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

  const onTrackPointerDown = (event: PointerEvent) => {
    if ((event.target as HTMLElement | null)?.tagName === 'INPUT') return
    const bar = rangeBarRef.current
    if (!bar || durationMs <= 0) return
    const rect = bar.getBoundingClientRect()
    if (rect.width <= 0) return
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    const clickMs = Math.round((ratio * durationMs) / 1000) * 1000
    if (Math.abs(clickMs - startMs) <= Math.abs(clickMs - endMs)) {
      const nextStart = Math.min(clickMs, Math.max(0, endMs - MIN_CLIP_MS))
      applyRange(nextStart, endMs, nextStart)
    } else {
      const nextEnd = Math.max(clickMs, Math.min(durationMs, startMs + MIN_CLIP_MS))
      applyRange(startMs, nextEnd, nextEnd)
    }
  }

  const onStart = () => {
    if (previewing) {
      playerHost().querySelector('video')?.pause()
      setPreviewing(false)
    }
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
        durationMs,
        trim: currentRange,
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
      estimatedBytes: selectedEstimatedBytes,
      durationMs,
      trim: currentRange,
    })
    onClose()
  }

  const sliderMax = durationMs > 0 ? Math.ceil(durationMs / 1000) * 1000 : 0
  const startPct = durationMs > 0 ? (startMs / durationMs) * 100 : 0
  const endPct = durationMs > 0 ? (endMs / durationMs) * 100 : 100
  const playheadPct = durationMs > 0 && playerTimeMs !== undefined
    ? Math.max(0, Math.min(100, (playerTimeMs / durationMs) * 100))
    : undefined

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

        {canCrop
          ? (
            <div className='crop-box'>
              <div className='crop-head'>
                <div className='crop-toggle' role='group' aria-label='Download range'>
                  <button
                    type='button'
                    className='crop-mode-btn'
                    aria-pressed={!cropEnabled}
                    onClick={() => {
                      setCropEnabled(false)
                      setPreviewing(false)
                    }}
                  >
                    Full
                  </button>
                  <button
                    type='button'
                    className='crop-mode-btn'
                    aria-pressed={cropEnabled}
                    onClick={() => setCropEnabled(true)}
                  >
                    <Scissors size={14} strokeWidth={1.75} />
                    Crop
                  </button>
                </div>
                {cropEnabled
                  ? (
                    <span className='crop-summary'>
                      Clip: {formatClipLabel({ startMs, endMs })} ({formatTimestamp(endMs - startMs)})
                    </span>
                  )
                  : undefined}
              </div>

              {cropEnabled
                ? (
                  <>
                    <div ref={rangeBarRef} className='dual-range' onPointerDown={onTrackPointerDown}>
                      <div className='range-track'>
                        <div className='range-fill' style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }} />
                        {playheadPct !== undefined
                          ? <span className='range-playhead' style={{ left: `${playheadPct}%` }} aria-hidden='true' />
                          : undefined}
                      </div>
                      <input
                        type='range'
                        className='range-thumb-input'
                        aria-label='Start time'
                        aria-valuetext={formatTimestamp(startMs)}
                        min={0}
                        max={sliderMax}
                        step={1000}
                        value={startMs}
                        onInput={(event: TargetedEvent<HTMLInputElement>) => {
                          const raw = Math.min(durationMs, Number(event.currentTarget.value))
                          const clampedStart = Math.min(raw, Math.max(0, endMs - MIN_CLIP_MS))
                          applyRange(clampedStart, endMs, clampedStart)
                        }}
                      />
                      <input
                        type='range'
                        className='range-thumb-input'
                        aria-label='End time'
                        aria-valuetext={formatTimestamp(endMs)}
                        min={0}
                        max={sliderMax}
                        step={1000}
                        value={endMs >= durationMs ? sliderMax : endMs}
                        onInput={(event: TargetedEvent<HTMLInputElement>) => {
                          const raw = Math.min(durationMs, Number(event.currentTarget.value))
                          const clampedEnd = Math.max(raw, Math.min(durationMs, startMs + MIN_CLIP_MS))
                          applyRange(startMs, clampedEnd, clampedEnd)
                        }}
                      />
                    </div>

                    <div className='crop-fields'>
                      <div className='crop-field'>
                        <label className='crop-field-label' htmlFor='dl-start-ts'>Start</label>
                        <div className='crop-input-row'>
                          <button
                            type='button'
                            className='mini-btn'
                            aria-label='Decrease start by 1 second'
                            onClick={() => applyRange(startMs - 1000, endMs, Math.max(0, startMs - 1000))}
                          >
                            -1s
                          </button>
                          <input
                            id='dl-start-ts'
                            type='text'
                            className='crop-input'
                            aria-label='Start timestamp'
                            value={startDraft}
                            onInput={(event: TargetedEvent<HTMLInputElement>) => setStartDraft(event.currentTarget.value)}
                            onBlur={commitStartDraft}
                            onKeyDown={(event: KeyboardEvent) => { if (event.key === 'Enter') commitStartDraft() }}
                          />
                          <button
                            type='button'
                            className='mini-btn'
                            aria-label='Increase start by 1 second'
                            onClick={() => applyRange(Math.min(startMs + 1000, endMs - MIN_CLIP_MS), endMs, Math.min(startMs + 1000, endMs - MIN_CLIP_MS))}
                          >
                            +1s
                          </button>
                        </div>
                      </div>

                      <div className='crop-field'>
                        <label className='crop-field-label' htmlFor='dl-end-ts'>End</label>
                        <div className='crop-input-row'>
                          <button
                            type='button'
                            className='mini-btn'
                            aria-label='Decrease end by 1 second'
                            onClick={() => applyRange(startMs, Math.max(endMs - 1000, startMs + MIN_CLIP_MS), Math.max(endMs - 1000, startMs + MIN_CLIP_MS))}
                          >
                            -1s
                          </button>
                          <input
                            id='dl-end-ts'
                            type='text'
                            className='crop-input'
                            aria-label='End timestamp'
                            value={endDraft}
                            onInput={(event: TargetedEvent<HTMLInputElement>) => setEndDraft(event.currentTarget.value)}
                            onBlur={commitEndDraft}
                            onKeyDown={(event: KeyboardEvent) => { if (event.key === 'Enter') commitEndDraft() }}
                          />
                          <button
                            type='button'
                            className='mini-btn'
                            aria-label='Increase end by 1 second'
                            onClick={() => applyRange(startMs, Math.min(durationMs, endMs + 1000), Math.min(durationMs, endMs + 1000))}
                          >
                            +1s
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className='crop-actions'>
                      <div className='crop-action-group'>
                        {hasWatchPlayer && playerTimeMs !== undefined
                          ? (
                            <>
                              <button
                                type='button'
                                className='mini-btn'
                                onClick={() => applyRange(Math.min(playerTimeMs, Math.max(0, endMs - MIN_CLIP_MS)), endMs)}
                              >
                                Use current start
                              </button>
                              <button
                                type='button'
                                className='mini-btn'
                                onClick={() => applyRange(startMs, Math.max(playerTimeMs, Math.min(durationMs, startMs + MIN_CLIP_MS)))}
                              >
                                Use current end
                              </button>
                              <button type='button' className='mini-btn' onClick={togglePreview}>
                                {previewing ? <Pause size={12} strokeWidth={1.75} /> : <Play size={12} strokeWidth={1.75} />}
                                {previewing ? 'Stop preview' : 'Preview clip'}
                              </button>
                            </>
                          )
                          : undefined}
                      </div>
                      <button
                        type='button'
                        className='mini-btn'
                        onClick={() => applyRange(0, durationMs, 0)}
                      >
                        <RotateCcw size={12} strokeWidth={1.75} />
                        Reset
                      </button>
                    </div>
                  </>
                )
                : undefined}
            </div>
          )
          : undefined}

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
                      const fullBytes = format.estimatedBytes !== undefined && mp4AudioForTrack?.estimatedBytes !== undefined
                        ? format.estimatedBytes + mp4AudioForTrack.estimatedBytes
                        : format.estimatedBytes
                      const totalBytes = estimateTrimmedBytes(fullBytes, durationMs, currentRange)
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
                    const totalBytes = estimateTrimmedBytes(format.estimatedBytes, durationMs, currentRange)
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
                        {totalBytes
                          ? <span className='format-size'>~{formatBytes(totalBytes)}</span>
                          : undefined}
                      </button>
                    )
                  })
                  : <div className='state'>No audio formats available.</div>}
              </div>
            )}
        </div>

        {!loading && !error && !isLive && exceedsMaxBytes && selectedEstimatedBytes
          ? (
            <p className='size-warning' role='alert'>
              File too large (~{formatBytes(selectedEstimatedBytes)}): exceeds the 1 GB browser memory limit. Pick a lower quality or trim a shorter clip.
            </p>
          )
          : !loading && !error && !isLive && selectedEstimatedBytes && selectedEstimatedBytes > LARGE_DOWNLOAD_WARNING_BYTES
          ? (
            <p className='size-warning'>
              Large file (~{formatBytes(selectedEstimatedBytes)}): assembled in a background worker before saving.
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
