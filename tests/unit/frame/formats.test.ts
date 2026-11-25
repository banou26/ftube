import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import type { AdaptiveFormat } from '../../../src/frame/formats'

import {
  audioManifestLabel,
  audioManifestRole,
  audioRepresentationId,
  audioTracksOf,
  pickAudioFormat,
  pickInitialVideoFormat,
  playableFormats,
  trackHasDrc,
} from '../../../src/frame/formats'

type Named = AdaptiveFormat & { name: string }

const audio = (name: string, extra: Partial<AdaptiveFormat> = {}): Named =>
  ({ name, has_audio: true, has_video: false, ...extra })

const video = (name: string, extra: Partial<AdaptiveFormat> = {}): Named =>
  ({ name, has_video: true, has_audio: false, ...extra })

const names = (formats: Named[]) => formats.map((format) => format.name)

// Real protobuf FormatXTags payloads observed on YouTube watch pages
const XTAG_VB = 'CgcKAnZiEgEx'
const XTAG_DRC = 'CggKA2RyYxIBMQ'
const XTAG_EN_ORIG = 'ChEKBWFjb250EghvcmlnaW5hbAoNCgRsYW5nEgVlbi1VUw'
const XTAG_EN_ORIG_DRC = 'ChEKBWFjb250EghvcmlnaW5hbAoICgNkcmMSATEKDQoEbGFuZxIFZW4tVVM'
const XTAG_EN_ORIG_VB = 'ChEKBWFjb250EghvcmlnaW5hbAoNCgRsYW5nEgVlbi1VUwoHCgJ2YhIBMQ'
const XTAG_ES_DUB = 'Cg8KBWFjb250EgZkdWJiZWQKCgoEbGFuZxICZXM'

describe('playableFormats', () => {
  it('keeps every video format, tagged or not', () => {
    const formats = [video('v1'), video('v2', { xtags: 'Cg0KBGxhbmcSBWVuLVVT' }), audio('a')]
    expect(names(playableFormats(formats))).toEqual(['v1', 'v2', 'a'])
  })

  it('keeps a lone untagged audio track', () => {
    expect(names(playableFormats([audio('a')]))).toEqual(['a'])
  })

  // The 403 regression: vb=1 (Voice Boost) siblings fail on every segment even when is_vb is unset
  it('drops the volume-boosted sibling while keeping plain and DRC tracks', () => {
    const formats = [
      audio('opus'),
      audio('opus-drc', { xtags: XTAG_DRC, is_drc: true }),
      audio('opus-vb', { xtags: XTAG_VB }),
      audio('aac'),
      audio('aac-vb', { xtags: XTAG_VB, is_vb: true }),
    ]
    expect(names(playableFormats(formats))).toEqual(['opus', 'opus-drc', 'aac'])
  })

  it('keeps original, dubbed, auto-dubbed, and DRC tracks on multi-language videos while dropping vb=1 and descriptive', () => {
    const formats = [
      audio('es', { xtags: XTAG_ES_DUB, is_dubbed: true, audio_track: { id: 'es.3', display_name: 'Spanish' } }),
      audio('de', { xtags: 'dubbed-auto', is_auto_dubbed: true, audio_track: { id: 'de.3', display_name: 'German' } }),
      audio('desc', { is_descriptive: true, audio_track: { id: 'en.2', display_name: 'English descriptive' } }),
      audio('sec', { is_secondary: true, audio_track: { id: 'en.1', display_name: 'Commentary' } }),
      audio('en-drc', { xtags: XTAG_EN_ORIG_DRC, is_original: true, is_drc: true, audio_track: { id: 'en-US.4', display_name: 'English (US) original' } }),
      audio('en', { xtags: XTAG_EN_ORIG, is_original: true, audio_track: { id: 'en-US.4', display_name: 'English (US) original' } }),
      audio('en-vb', { xtags: XTAG_EN_ORIG_VB, is_original: true, is_vb: true, audio_track: { id: 'en-US.4', display_name: 'English (US) original' } }),
    ]
    expect(names(playableFormats(formats))).toEqual(['es', 'de', 'en-drc', 'en'])
  })

  it('drops orphan trackless audio formats when other audio formats carry audio_track', () => {
    const formats = [
      audio('orphan'),
      audio('es', { is_dubbed: true, audio_track: { id: 'es.3', display_name: 'Spanish' } }),
      audio('en', { is_original: true, audio_track: { id: 'en.4', display_name: 'English original' } }),
    ]
    expect(names(playableFormats(formats))).toEqual(['es', 'en'])
  })

  it('narrows to the original non-DRC audio track when singleTrack is requested for live streams', () => {
    const formats = [
      audio('es', { is_dubbed: true, audio_track: { id: 'es.3', display_name: 'Spanish' } }),
      audio('en-drc', { is_original: true, is_drc: true, audio_track: { id: 'en.4', display_name: 'English original' } }),
      audio('en', { is_original: true, audio_track: { id: 'en.4', display_name: 'English original' } }),
    ]
    expect(names(playableFormats(formats, { singleTrack: true }))).toEqual(['en'])
  })

  it('preserves the caller ordering', () => {
    const formats = [audio('first'), video('v'), audio('second')]
    expect(names(playableFormats(formats))).toEqual(['first', 'v', 'second'])
  })

  it('leaves audio present rather than empty if every track looks unrecognized', () => {
    const formats = [audio('only', { xtags: 'weird', is_drc: false })]
    expect(names(playableFormats(formats))).toEqual(['only'])
  })
})

describe('audioTracksOf, trackHasDrc, and pickAudioFormat', () => {
  const multi = [
    { key: '251:es', itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 130_000, audioTrackId: 'es.3', audioTrackName: 'Spanish', language: 'es' },
    { key: '140:es', itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128_000, audioTrackId: 'es.3', audioTrackName: 'Spanish', language: 'es' },
    { key: '251:de', itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 130_000, audioTrackId: 'de.3', audioTrackName: 'German', language: 'de', isAutoDubbed: true },
    { key: '251:en-drc', itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 131_000, audioTrackId: 'en-US.4', audioTrackName: 'English (US) original', language: 'en-US', isOriginal: true, isDrc: true },
    { key: '250:en', itag: 250, mimeType: 'audio/webm; codecs="opus"', bitrate: 70_000, audioTrackId: 'en-US.4', audioTrackName: 'English (US) original', language: 'en-US', isOriginal: true },
    { key: '251:en', itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 130_000, audioTrackId: 'en-US.4', audioTrackName: 'English (US) original', language: 'en-US', isOriginal: true },
  ]

  const singleWithDrc = [
    { key: '140:', itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128_000, isOriginal: true, language: 'en' },
    { key: '140:drc', itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128_000, isDrc: true, language: 'en' },
    { key: '251:', itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 156_000, isOriginal: true, language: 'en' },
    { key: '251:drc', itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 156_000, isDrc: true, language: 'en' },
  ]

  it('orders the original track first and the remaining tracks alphabetically', () => {
    expect(audioTracksOf(multi)).toEqual([
      { id: 'en-US.4', label: 'English (US) original', language: 'en-US', original: true, autoDubbed: false, hasDrc: true },
      { id: 'de.3', label: 'German', language: 'de', original: false, autoDubbed: true, hasDrc: false },
      { id: 'es.3', label: 'Spanish', language: 'es', original: false, autoDubbed: false, hasDrc: false },
    ])
    expect(audioTracksOf(singleWithDrc)).toEqual([])
  })

  it('reports DRC availability per active track and on single-track videos', () => {
    expect(trackHasDrc(multi, 'en-US.4')).toBe(true)
    expect(trackHasDrc(multi, 'es.3')).toBe(false)
    expect(trackHasDrc(singleWithDrc)).toBe(true)
    expect(trackHasDrc(singleWithDrc.filter((format) => !format.isDrc))).toBe(false)
  })

  it('defaults to the highest-bitrate opus format of the original track, never an auto-dub or DRC', () => {
    expect(pickAudioFormat(multi)?.key).toBe('251:en')
    expect(pickAudioFormat(multi, { drc: true })?.key).toBe('251:en-drc')
    expect(pickAudioFormat(multi, { trackId: 'es.3', drc: false })?.key).toBe('251:es')
    // falls back to plain when the selected dubbed track has no DRC variant
    expect(pickAudioFormat(multi, { trackId: 'es.3', drc: true })?.key).toBe('251:es')
    expect(pickAudioFormat(singleWithDrc, { drc: false })?.key).toBe('251:')
    expect(pickAudioFormat(singleWithDrc, { drc: true })?.key).toBe('251:drc')
  })

  it('matches youtubei.js DASH representation IDs, labels, and roles', () => {
    expect(audioRepresentationId(multi[5]!)).toBe('251-en-US.4')
    expect(audioRepresentationId(multi[3]!)).toBe('251-en-US.4-drc')
    expect(audioRepresentationId(singleWithDrc[2]!)).toBe('251')
    expect(audioRepresentationId(singleWithDrc[3]!)).toBe('251-drc')

    expect(audioManifestLabel(multi[5]!, true)).toBe('English (US) original')
    expect(audioManifestLabel(multi[3]!, true)).toBe('English (US) original (Stable Volume)')
    expect(audioManifestLabel(singleWithDrc[2]!, true)).toBe('Original')
    expect(audioManifestLabel(singleWithDrc[3]!, true)).toBe('Stable Volume')
    expect(audioManifestLabel(singleWithDrc[2]!, false)).toBe('')

    expect(audioManifestRole(multi[5]!, true)).toBe('main')
    expect(audioManifestRole(multi[0]!, true)).toBe('alternate')
    expect(audioManifestRole(singleWithDrc[2]!, true)).toBe('main')
    expect(audioManifestRole(singleWithDrc[3]!, true)).toBe('alternate')
    expect(audioManifestRole(singleWithDrc[2]!, false)).toBe('')
  })
})

describe('pickInitialVideoFormat', () => {
  beforeEach(() => {
    vi.stubGlobal('MediaSource', { isTypeSupported: () => true })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const portrait = [
    { key: '396:', mimeType: 'video/mp4; codecs="av01.0.01M.08"', bitrate: 200_000, width: 360, height: 640 },
    { key: '397:', mimeType: 'video/mp4; codecs="av01.0.04M.08"', bitrate: 400_000, width: 480, height: 854 },
    { key: '398:', mimeType: 'video/mp4; codecs="av01.0.05M.08"', bitrate: 800_000, width: 720, height: 1_280 },
    { key: '399:', mimeType: 'video/mp4; codecs="av01.0.08M.08"', bitrate: 1_500_000, width: 1_080, height: 1_920 },
  ]
  const fourByFive = [
    { key: '398:', mimeType: 'video/mp4; codecs="av01.0.05M.08"', bitrate: 700_000, width: 720, height: 900 },
    { key: '399:', mimeType: 'video/mp4; codecs="av01.0.08M.08"', bitrate: 1_400_000, width: 1_080, height: 1_350 },
    { key: '400:', mimeType: 'video/mp4; codecs="av01.0.12M.08"', bitrate: 3_000_000, width: 1_440, height: 1_800 },
  ]
  const landscape = [
    { key: '397:', mimeType: 'video/mp4; codecs="av01.0.04M.08"', bitrate: 400_000, width: 854, height: 480 },
    { key: '247:', mimeType: 'video/webm; codecs="vp9"', bitrate: 1_100_000, width: 1_280, height: 720 },
    { key: '398:', mimeType: 'video/mp4; codecs="av01.0.05M.08"', bitrate: 800_000, width: 1_280, height: 720 },
    { key: '399:', mimeType: 'video/mp4; codecs="av01.0.08M.08"', bitrate: 2_000_000, width: 1_920, height: 1_080 },
  ]

  it('picks the smallest tier covering an object-fit: contain box across 9:16, 4:5, and 16:9 Shorts', () => {
    expect(pickInitialVideoFormat(portrait, { cover: { width: 405, height: 720 } })?.key).toBe('397:')
    expect(pickInitialVideoFormat(portrait, { cover: { width: 690, height: 1_227 } })?.key).toBe('398:')
    expect(pickInitialVideoFormat(portrait, { cover: { width: 810, height: 1_440 } })?.key).toBe('399:')
    // 4:5 video in an 810x1440 box renders at 810x1012: 1080x1350 already covers it without pulling 1440x1800
    expect(pickInitialVideoFormat(fourByFive, { cover: { width: 810, height: 1_440 } })?.key).toBe('399:')
    // 16:9 Short in an 810x1440 box renders at 810x456: 854x480 covers it without pulling 1080p/4K
    expect(pickInitialVideoFormat(landscape, { cover: { width: 810, height: 1_440 } })?.key).toBe('397:')
  })

  it('honors pinnedHeight directly and falls back to maxHeight when absent', () => {
    expect(pickInitialVideoFormat(landscape, { maxHeight: 720, pinnedHeight: 1_080 })?.key).toBe('399:')
    expect(pickInitialVideoFormat(landscape, { maxHeight: 720, pinnedHeight: 720 })?.key).toBe('247:')
    expect(pickInitialVideoFormat(landscape, { maxHeight: 720, pinnedHeight: 2_160 })?.key).toBe('398:')
  })

  it('consults ManagedMediaSource when MediaSource is absent (iOS WebKit)', () => {
    vi.unstubAllGlobals()
    vi.stubGlobal('ManagedMediaSource', { isTypeSupported: (mime: string) => mime.includes('mp4') })
    expect(pickInitialVideoFormat(landscape, { maxHeight: 720, pinnedHeight: 720 })?.key).toBe('398:')
  })
})
