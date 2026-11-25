import { describe, expect, it } from 'vite-plus/test'

import {
  chatText,
  decodePartyMessage,
  displayName,
  encodePartyMessage,
  isHostOnly,
  MAX_CHAT_LENGTH,
  MAX_NAME_LENGTH,
  normalizePartyPath,
  sanitizePath,
  SOCIAL_MAX_CHARS,
  videoIdOfPath,
} from '../../../src/party/protocol'

describe('party protocol validation', () => {
  it('separates host-only steering messages from open member messages', () => {
    expect(isHostOnly({ t: 'nav', path: '/' })).toBe(true)
    expect(isHostOnly({ t: 'playback', s: { paused: false, time: 1, rate: 1, at: 100 } })).toBe(true)
    expect(isHostOnly({ t: 'state', path: '/' })).toBe(true)
    expect(isHostOnly({ t: 'pong', n: 1, at: 100, host: 120 })).toBe(true)
    expect(isHostOnly({ t: 'chat', text: 'hi' })).toBe(false)
    expect(isHostOnly({ t: 'name', name: 'Alex' })).toBe(false)
    expect(isHostOnly({ t: 'ping', n: 1, at: 100 })).toBe(false)
  })

  it('sanitizes route paths and rejects external URLs, control chars, and /party', () => {
    expect(sanitizePath('/watch?v=dQw4w9WgXcQ')).toBe('/watch?v=dQw4w9WgXcQ')
    expect(sanitizePath('/results?search_query=music')).toBe('/results?search_query=music')
    expect(sanitizePath('//evil.invalid/watch')).toBeUndefined()
    expect(sanitizePath('https://youtube.com/watch')).toBeUndefined()
    expect(sanitizePath('/watch\\x')).toBeUndefined()
    expect(sanitizePath('/watch\nfoo')).toBeUndefined()
    expect(sanitizePath('/party')).toBeUndefined()
    expect(sanitizePath('/party?foo=1')).toBeUndefined()
    expect(sanitizePath('/party/sub')).toBeUndefined()
  })

  it('strips watch t= params during normalization and extracts video IDs', () => {
    expect(normalizePartyPath('/watch', 'v=abc&t=42s&list=PL1')).toBe('/watch?v=abc&list=PL1')
    expect(normalizePartyPath('/watch', '?v=abc&t=12')).toBe('/watch?v=abc')
    expect(normalizePartyPath('/party', '')).toBeUndefined()
    expect(normalizePartyPath('/results', 'search_query=cats')).toBe('/results?search_query=cats')
    expect(videoIdOfPath('/watch?v=abc&list=PL1')).toBe('abc')
    expect(videoIdOfPath('/results?v=abc')).toBeUndefined()
    expect(videoIdOfPath(undefined)).toBeUndefined()
  })

  it('bounds display names and chat lines', () => {
    expect(displayName('  Alex \n  Kim  ')).toBe('Alex Kim')
    expect(displayName('   ')).toBeUndefined()
    expect(displayName('a'.repeat(MAX_NAME_LENGTH + 10))).toHaveLength(MAX_NAME_LENGTH)
    expect(chatText('hello\n\tworld')).toBe('hello world')
    expect(chatText('')).toBeUndefined()
    expect(chatText('x'.repeat(MAX_CHAT_LENGTH + 50))).toHaveLength(MAX_CHAT_LENGTH)
  })

  it('round-trips every valid message type and drops malformed payloads', () => {
    const valid = [
      { t: 'nav' as const, path: '/watch?v=abc' },
      { t: 'playback' as const, s: { paused: false, time: 12.5, rate: 1.5, at: 1_000 } },
      { t: 'state' as const, path: '/watch?v=abc', s: { paused: true, time: 0, rate: 1, at: 2_000 } },
      { t: 'state' as const, path: '/' },
      { t: 'chat' as const, text: 'ready' },
      { t: 'name' as const, name: 'Sam' },
      { t: 'social' as const, p: '{"t":"social.hello","v":1}' },
      { t: 'ping' as const, n: 3, at: 500 },
      { t: 'pong' as const, n: 3, at: 500, host: 520 },
    ]
    for (const message of valid) {
      expect(decodePartyMessage(encodePartyMessage(message))).toStrictEqual(message)
    }

    expect(decodePartyMessage(JSON.stringify({ t: 'social', p: '' }))).toBeUndefined()
    expect(decodePartyMessage(JSON.stringify({ t: 'social', p: 'x'.repeat(SOCIAL_MAX_CHARS + 1) }))).toBeUndefined()
    expect(decodePartyMessage('not json')).toBeUndefined()
    expect(decodePartyMessage(JSON.stringify({ t: 'unknown' }))).toBeUndefined()
    expect(decodePartyMessage(JSON.stringify({ t: 'nav', path: '//bad' }))).toBeUndefined()
    expect(decodePartyMessage(JSON.stringify({ t: 'playback', s: { paused: false, time: -1, rate: 1, at: 10 } }))).toBeUndefined()
    expect(decodePartyMessage(JSON.stringify({ t: 'playback', s: { paused: false, time: 1, rate: 0, at: 10 } }))).toBeUndefined()
    expect(decodePartyMessage(JSON.stringify({ t: 'ping', n: 1.5, at: 10 }))).toBeUndefined()
  })
})
