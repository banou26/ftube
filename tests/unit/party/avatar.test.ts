import type { SocialIdentity } from '../../../src/social'

import { describe, expect, it } from 'vite-plus/test'

import { avatarInitialOf, safeAvatarSrc } from '../../../src/social/avatar'

const identity = (overrides: Partial<SocialIdentity> = {}): SocialIdentity => ({
  handle: 'fkn:name:alice',
  name: 'alice',
  displayName: 'Alice Example',
  avatar: null,
  ...overrides,
})

describe('safeAvatarSrc', () => {
  it('accepts https and inline image data URIs and trims whitespace', () => {
    expect(safeAvatarSrc(' https://social.fkn.app/avatar.png ')).toBe('https://social.fkn.app/avatar.png')
    expect(safeAvatarSrc('data:image/png;base64,iVBOR')).toBe('data:image/png;base64,iVBOR')
  })

  it('rejects unsafe schemes, relative paths, and empty values', () => {
    expect(safeAvatarSrc('javascript:alert(1)')).toBeNull()
    expect(safeAvatarSrc('http://social.fkn.app/avatar.png')).toBeNull()
    expect(safeAvatarSrc('data:text/html,<svg onload=alert(1)>')).toBeNull()
    expect(safeAvatarSrc('//social.fkn.app/avatar.png')).toBeNull()
    expect(safeAvatarSrc('/avatar.png')).toBeNull()
    expect(safeAvatarSrc('   ')).toBeNull()
    expect(safeAvatarSrc('')).toBeNull()
    expect(safeAvatarSrc(null)).toBeNull()
    expect(safeAvatarSrc(undefined)).toBeNull()
  })
})

describe('avatarInitialOf', () => {
  it('prefers friend nickname only when status is friend and falls back through displayName, name, and ?', () => {
    expect(avatarInitialOf(identity({ nickname: 'buddy' }), 'friend')).toBe('B')
    expect(avatarInitialOf(identity({ nickname: 'buddy' }), 'verified')).toBe('A')
    expect(avatarInitialOf(identity({ displayName: '   ', name: 'carol' }), 'verified')).toBe('C')
    expect(avatarInitialOf(identity({ displayName: '   ', name: '' }), 'verified')).toBe('?')
  })

  it('keeps multi-codepoint graphemes intact', () => {
    expect(avatarInitialOf(identity({ displayName: '👩‍🔬 Ada' }), 'verified')).toBe('👩‍🔬')
  })
})
