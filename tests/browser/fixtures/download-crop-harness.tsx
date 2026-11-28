import type { DownloadFormatsResult } from '../../../src/frame/protocol'

import { render } from 'preact'

import { DownloadDialog } from '../../../src/components/download-dialog'
import { openPlayer, playerHost } from '../../../src/player/session'

type HarnessOptions = {
  videoId: string
  title: string
  videoUrl: string
  width: number
  height: number
  thumbnail?: string
}

type HarnessApi = {
  currentTime: () => number
  paused: () => boolean
  dimensions: () => { width: number, height: number }
}

declare global {
  interface Window {
    __downloadCropHarness?: HarnessApi
    __downloadCropCleanup?: () => void
  }
}

export const mountDownloadCropHarness = async (options: HarnessOptions) => {
  window.__downloadCropCleanup?.()

  const hostNode = playerHost()
  hostNode.replaceChildren()
  document.querySelectorAll('[data-download-crop-harness]').forEach((node) => node.remove())

  const response = await fetch(options.videoUrl)
  if (!response.ok) throw new Error(`Failed to fetch crop fixture: ${response.status}`)
  const blobUrl = URL.createObjectURL(await response.blob())

  const wrapper = document.createElement('div')
  wrapper.setAttribute('data-download-crop-harness', options.videoId)
  wrapper.style.cssText = 'position: relative; width: 100%; max-width: 720px; margin: 0 auto; background: #000;'

  const stage = document.createElement('div')
  stage.style.cssText = `position: relative; width: 100%; aspect-ratio: ${options.width} / ${options.height}; background: #000;`
  stage.append(hostNode)

  const video = document.createElement('video')
  video.muted = true
  video.defaultMuted = true
  video.volume = 0
  video.playsInline = true
  video.preload = 'auto'
  video.style.cssText = 'width: 100%; height: 100%; display: block; object-fit: contain;'
  video.src = blobUrl
  hostNode.append(video)

  const dialogRoot = document.createElement('div')
  wrapper.append(stage, dialogRoot)
  document.body.prepend(wrapper)

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener('loadeddata', onReady)
      video.removeEventListener('error', onError)
    }
    const onReady = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error(`Video fixture error: ${video.error?.code ?? 'unknown'}`))
    }
    if (video.readyState >= 2 && video.videoWidth > 0) {
      resolve()
      return
    }
    video.addEventListener('loadeddata', onReady, { once: true })
    video.addEventListener('error', onError, { once: true })
    video.load()
  })

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

  const formats: DownloadFormatsResult = {
    videoId: options.videoId,
    durationMs: 6_000,
    isLive: false,
    videoFormats: [
      {
        key: 'video-mp4',
        itag: 18,
        kind: 'video',
        container: 'mp4',
        mimeType: 'video/mp4',
        codec: 'avc1.42E01E',
        qualityLabel: `${Math.min(options.width, options.height)}p`,
        height: options.height,
        bitrate: 800_000,
        estimatedBytes: 600_000,
      },
    ],
    audioFormats: [
      {
        key: 'audio-m4a',
        itag: 140,
        kind: 'audio',
        container: 'm4a',
        mimeType: 'audio/mp4',
        codec: 'mp4a.40.2',
        qualityLabel: '128 kbps',
        bitrate: 128_000,
        estimatedBytes: 96_000,
        audioTrackId: 'en',
        audioTrackName: 'English (Original)',
        isOriginal: true,
      },
    ],
  }

  openPlayer({ videoId: options.videoId, title: options.title })

  render(
    <DownloadDialog
      videoId={options.videoId}
      title={options.title}
      thumbnail={options.thumbnail}
      channelName='Test Channel'
      onClose={() => {}}
      loadFormats={async () => formats}
    />,
    dialogRoot,
  )

  window.__downloadCropHarness = {
    currentTime: () => video.currentTime,
    paused: () => video.paused,
    dimensions: () => ({ width: video.videoWidth, height: video.videoHeight }),
  }

  window.__downloadCropCleanup = () => {
    render(null, dialogRoot)
    hostNode.replaceChildren()
    wrapper.remove()
    URL.revokeObjectURL(blobUrl)
    delete window.__downloadCropHarness
    delete window.__downloadCropCleanup
  }
}
