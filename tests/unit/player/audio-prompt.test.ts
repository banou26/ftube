import { describe, expect, it } from 'vite-plus/test'

import { audioPermissionTip } from '../../../src/player/audio-tip'
import { DEFAULT_SETTINGS } from '../../../src/settings'

describe('default audio settings', () => {
  it('starts unmuted at full volume', () => {
    expect(DEFAULT_SETTINGS.muted).toBe(false)
    expect(DEFAULT_SETTINGS.volume).toBe(1)
  })
})

describe('audioPermissionTip', () => {
  const CHROME_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  const HEADLESS_CHROME_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36'
  const EDGE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'
  const FIREFOX_UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0'
  const SAFARI_MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15'
  const SAFARI_IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'

  it('points Chrome, Chromium, and Edge viewers to the address bar site settings', () => {
    for (const ua of [CHROME_UA, HEADLESS_CHROME_UA, EDGE_UA, '']) {
      const tip = audioPermissionTip(ua)
      expect(tip).toContain('site settings')
      expect(tip).toContain('Sound')
      expect(tip).toContain('Allow')
    }
  })

  it('points Firefox viewers to the address bar autoplay icon', () => {
    const tip = audioPermissionTip(FIREFOX_UA)
    expect(tip).toContain('autoplay icon')
    expect(tip).toContain('Audio and Video')
  })

  it('points Safari viewers to Settings for This Website Auto-Play', () => {
    for (const ua of [SAFARI_MAC_UA, SAFARI_IOS_UA]) {
      const tip = audioPermissionTip(ua)
      expect(tip).toContain('Safari')
      expect(tip).toContain('Auto-Play')
      expect(tip).toContain('Allow All Auto-Play')
    }
  })

  it('never includes em dashes or en dashes', () => {
    for (const ua of [CHROME_UA, HEADLESS_CHROME_UA, EDGE_UA, FIREFOX_UA, SAFARI_MAC_UA, SAFARI_IOS_UA, '']) {
      expect(audioPermissionTip(ua)).not.toMatch(/[\u2013\u2014]/)
    }
  })
})
