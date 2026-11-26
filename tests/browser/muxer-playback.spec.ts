import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test } from './test'

type PlaybackProbeResult = {
  supported: boolean
  canPlayType: string
  duration: number
  currentTimeBeforePlay: number
  currentTimeAfterPlay: number
  currentTimeAfterSeek: number
  videoWidth?: number
  videoHeight?: number
  errorCode: number | null
}

type MuxerPlaybackReport = {
  mp4: PlaybackProbeResult
  m4a: PlaybackProbeResult
  webm: PlaybackProbeResult
  headerBrands: {
    mp4Box: string
    m4aBox: string
    webmMagicHex: string
  }
}

const loadFixture = (name: string) => readFileSync(resolve(process.cwd(), 'tests/unit/fixtures', name))

test('remuxes and trims real MP4, M4A, and WebM fixtures into playable and seekable media elements', async ({ page, browserName }) => {
  const fixtures = new Map<string, { body: Buffer, contentType: string }>([
    ['sample-av-fmp4-video.mp4', { body: loadFixture('sample-av-fmp4-video.mp4'), contentType: 'video/mp4' }],
    ['sample-av-fmp4-audio.m4a', { body: loadFixture('sample-av-fmp4-audio.m4a'), contentType: 'audio/mp4' }],
    ['sample-opus.webm', { body: loadFixture('sample-opus.webm'), contentType: 'audio/webm' }],
  ])

  await page.route('**/__muxer_fixtures__/*', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop() ?? ''
    const item = fixtures.get(name)
    if (!item) {
      await route.fulfill({ status: 404 })
      return
    }
    await route.fulfill({ status: 200, contentType: item.contentType, body: item.body })
  })

  await page.goto('/privacy')
  const report = await page.evaluate(async ([mp4Path, webmPath]): Promise<MuxerPlaybackReport> => {
    const [{ muxMp4, muxMp4Audio }, { trimWebmAudio }] = await Promise.all([
      import(mp4Path) as Promise<typeof import('../../src/downloads/mp4-muxer')>,
      import(webmPath) as Promise<typeof import('../../src/downloads/webm-trimmer')>,
    ])

    const fetchBytes = async (name: string) => {
      const response = await fetch(`/__muxer_fixtures__/${name}`)
      if (!response.ok) throw new Error(`fixture fetch failed: ${name}`)
      return new Uint8Array(await response.arrayBuffer())
    }

    const [videoBytes, audioBytes, webmBytes] = await Promise.all([
      fetchBytes('sample-av-fmp4-video.mp4'),
      fetchBytes('sample-av-fmp4-audio.m4a'),
      fetchBytes('sample-opus.webm'),
    ])

    const mp4Parts = muxMp4([videoBytes], [audioBytes], { startMs: 1_000, endMs: 4_500 }).map(part => new Uint8Array(part))
    const m4aParts = muxMp4Audio([audioBytes]).map(part => new Uint8Array(part))
    const webmParts = trimWebmAudio([webmBytes], { startMs: 1_000, endMs: 4_000 }).map(part => new Uint8Array(part))

    const ascii4 = (bytes: Uint8Array, offset: number) =>
      String.fromCharCode(bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0, bytes[offset + 3] ?? 0)
    const hex4 = (bytes: Uint8Array) =>
      Array.from(bytes.slice(0, 4), byte => byte.toString(16).padStart(2, '0')).join('')

    const probeMedia = async (tag: 'video' | 'audio', mime: string, blob: Blob, seekToSec: number): Promise<PlaybackProbeResult> => {
      const el = document.createElement(tag)
      el.muted = true
      el.volume = 0
      el.preload = 'auto'
      if (el instanceof HTMLVideoElement) el.playsInline = true
      el.style.cssText = 'position: fixed; left: -9999px; width: 160px; height: 90px'
      const canPlayType = el.canPlayType(mime)
      if (!canPlayType) {
        return {
          supported: false,
          canPlayType,
          duration: 0,
          currentTimeBeforePlay: 0,
          currentTimeAfterPlay: 0,
          currentTimeAfterSeek: 0,
          errorCode: null,
        }
      }

      const url = URL.createObjectURL(blob)
      document.body.append(el)
      try {
        el.src = url
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`timed out loading ${tag} (${mime})`)), 10_000)
          const done = () => {
            clearTimeout(timer)
            resolve()
          }
          const fail = () => {
            clearTimeout(timer)
            reject(new Error(`${tag} error ${el.error?.code ?? 'unknown'}`))
          }
          if (el.readyState >= 1) done()
          el.addEventListener('loadedmetadata', done, { once: true })
          el.addEventListener('error', fail, { once: true })
        })

        const currentTimeBeforePlay = el.currentTime
        await el.play().catch(() => {})
        await new Promise<void>((resolve) => {
          const start = performance.now()
          const check = () => {
            if (el.currentTime > currentTimeBeforePlay + 0.08 || performance.now() - start > 1_200) {
              resolve()
              return
            }
            setTimeout(check, 40)
          }
          check()
        })
        const currentTimeAfterPlay = el.currentTime

        const targetSeek = Math.min(seekToSec, Math.max(0.2, el.duration - 0.3))
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 2_000)
          el.addEventListener('seeked', () => {
            clearTimeout(timer)
            resolve()
          }, { once: true })
          el.currentTime = targetSeek
        })
        const currentTimeAfterSeek = el.currentTime
        el.pause()

        return {
          supported: true,
          canPlayType,
          duration: el.duration,
          currentTimeBeforePlay,
          currentTimeAfterPlay,
          currentTimeAfterSeek,
          ...(el instanceof HTMLVideoElement ? { videoWidth: el.videoWidth, videoHeight: el.videoHeight } : {}),
          errorCode: el.error?.code ?? null,
        }
      } finally {
        el.pause()
        el.removeAttribute('src')
        el.load()
        el.remove()
        URL.revokeObjectURL(url)
      }
    }

    const mp4 = await probeMedia('video', 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"', new Blob(mp4Parts, { type: 'video/mp4' }), 2.0)
    const m4a = await probeMedia('audio', 'audio/mp4; codecs="mp4a.40.2"', new Blob(m4aParts, { type: 'audio/mp4' }), 2.5)
    const webm = await probeMedia('audio', 'audio/webm; codecs="opus"', new Blob(webmParts, { type: 'audio/webm' }), 1.5)

    return {
      mp4,
      m4a,
      webm,
      headerBrands: {
        mp4Box: mp4Parts[0] ? ascii4(mp4Parts[0], 4) : '',
        m4aBox: m4aParts[0] ? ascii4(m4aParts[0], 4) : '',
        webmMagicHex: webmParts[0] ? hex4(webmParts[0]) : '',
      },
    }
  }, ['/src/downloads/mp4-muxer.ts', '/src/downloads/webm-trimmer.ts'] as const)

  expect(report.headerBrands).toEqual({
    mp4Box: 'ftyp',
    m4aBox: 'ftyp',
    webmMagicHex: '1a45dfa3',
  })

  if (browserName === 'chromium') {
    expect(report.mp4.supported).toBe(true)
    expect(report.m4a.supported).toBe(true)
    expect(report.webm.supported).toBe(true)
  }

  if (report.mp4.supported) {
    expect(report.mp4.errorCode).toBeNull()
    expect(report.mp4.duration).toBeGreaterThan(2.5)
    expect(report.mp4.duration).toBeLessThan(5.0)
    expect(report.mp4.videoWidth).toBeGreaterThan(0)
    expect(report.mp4.videoHeight).toBeGreaterThan(0)
    expect(report.mp4.currentTimeAfterPlay).toBeGreaterThan(report.mp4.currentTimeBeforePlay)
    expect(report.mp4.currentTimeAfterSeek).toBeGreaterThan(1.0)
  }

  if (report.m4a.supported) {
    expect(report.m4a.errorCode).toBeNull()
    expect(report.m4a.duration).toBeGreaterThan(5.5)
    expect(report.m4a.duration).toBeLessThan(6.5)
    expect(report.m4a.currentTimeAfterPlay).toBeGreaterThan(report.m4a.currentTimeBeforePlay)
    expect(report.m4a.currentTimeAfterSeek).toBeGreaterThan(1.5)
  }

  if (report.webm.supported) {
    expect(report.webm.errorCode).toBeNull()
    expect(report.webm.duration).toBeGreaterThan(2.0)
    expect(report.webm.duration).toBeLessThan(4.0)
    expect(report.webm.currentTimeAfterPlay).toBeGreaterThan(report.webm.currentTimeBeforePlay)
    expect(report.webm.currentTimeAfterSeek).toBeGreaterThan(0.8)
  }
})
