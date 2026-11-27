import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

const load = async (stored?: unknown) => {
  vi.resetModules()
  vi.stubGlobal('localStorage', {
    getItem: () => (stored === undefined ? null : JSON.stringify(stored)),
    setItem: () => {},
  })
  return import('../../src/settings')
}

describe('the theme setting', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('follows the device until a theme is chosen', async () => {
    const { getSettings } = await load()
    expect(getSettings().theme).toBe('device')
  })

  it('keeps a theme chosen in Settings', async () => {
    expect((await load({ theme: 'dark', themeChosen: true })).getSettings().theme).toBe('dark')
    expect((await load({ theme: 'light' })).getSettings().theme).toBe('light')
  })

  it('reads a Dark saved without being chosen as the device theme', async () => {
    expect((await load({ theme: 'dark', extensionSeen: true })).getSettings().theme).toBe('device')
  })

  it('marks a theme as chosen when one is picked, so Dark sticks', async () => {
    const written: string[] = []
    vi.resetModules()
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: (_key: string, value: string) => written.push(value) })
    const { updateSettings } = await import('../../src/settings')
    updateSettings({ theme: 'dark' })
    const saved = JSON.parse(written.at(-1)!)
    expect(saved).toMatchObject({ theme: 'dark', themeChosen: true })
    expect((await load(saved)).getSettings().theme).toBe('dark')
  })

  it('leaves the mark alone when something other than the theme changes', async () => {
    const written: string[] = []
    vi.resetModules()
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: (_key: string, value: string) => written.push(value) })
    const { updateSettings } = await import('../../src/settings')
    updateSettings({ volume: 0.5 })
    expect(JSON.parse(written.at(-1)!).themeChosen).toBeUndefined()
  })

  it('follows the device when the stored value is not a theme', async () => {
    expect((await load({ theme: 'sepia' })).getSettings().theme).toBe('device')
  })
})

describe('the dislike counts setting', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is on until turned off', async () => {
    expect((await load()).getSettings().showDislikes).toBe(true)
    expect((await load({ theater: true })).getSettings().showDislikes).toBe(true)
    expect((await load({ showDislikes: false })).getSettings().showDislikes).toBe(false)
  })

  it('is on when the stored value is not a boolean', async () => {
    expect((await load({ showDislikes: 'no' })).getSettings().showDislikes).toBe(true)
    expect((await load({ showDislikes: 0 })).getSettings().showDislikes).toBe(true)
  })
})

describe('the Skip sponsors setting', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is on until turned off', async () => {
    expect((await load()).getSettings().skipSponsors).toBe(true)
    expect((await load({ skipSponsors: 'no' })).getSettings().skipSponsors).toBe(true)
    expect((await load({ skipSponsors: false })).getSettings().skipSponsors).toBe(false)
  })
})

describe('the Ambient mode setting', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is on until turned off', async () => {
    expect((await load()).getSettings().ambientMode).toBe(true)
    expect((await load({ ambientMode: 'no' })).getSettings().ambientMode).toBe(true)
    expect((await load({ ambientMode: false })).getSettings().ambientMode).toBe(false)
  })
})

describe('the Annotations setting', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is on until turned off and ignores non-boolean values', async () => {
    expect((await load()).getSettings().annotations).toBe(true)
    expect((await load({ annotations: 'no' })).getSettings().annotations).toBe(true)
    expect((await load({ annotations: 0 })).getSettings().annotations).toBe(true)
    expect((await load({ annotations: false })).getSettings().annotations).toBe(false)

    const written: string[] = []
    vi.resetModules()
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: (_key: string, value: string) => written.push(value) })
    const { updateSettings } = await import('../../src/settings')
    updateSettings({ annotations: false })
    expect(JSON.parse(written.at(-1)!).annotations).toBe(false)
    expect((await load(JSON.parse(written.at(-1)!))).getSettings().annotations).toBe(false)
  })
})

describe('the miniplayer width setting', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults to undefined, clamps valid widths, drops malformed values, and clears on reset', async () => {
    expect((await load()).getSettings().miniplayerWidth).toBeUndefined()
    expect((await load({ miniplayerWidth: '500' })).getSettings().miniplayerWidth).toBeUndefined()
    expect((await load({ miniplayerWidth: Number.NaN })).getSettings().miniplayerWidth).toBeUndefined()
    expect((await load({ miniplayerWidth: 520.4 })).getSettings().miniplayerWidth).toBe(520)
    expect((await load({ miniplayerWidth: 100 })).getSettings().miniplayerWidth).toBe(280)
    expect((await load({ miniplayerWidth: 2500 })).getSettings().miniplayerWidth).toBe(1200)

    const written: string[] = []
    vi.resetModules()
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: (_key: string, value: string) => written.push(value) })
    const { updateSettings } = await import('../../src/settings')
    updateSettings({ miniplayerWidth: 640 })
    expect(JSON.parse(written.at(-1)!).miniplayerWidth).toBe(640)
    updateSettings({ miniplayerWidth: undefined })
    expect(JSON.parse(written.at(-1)!).miniplayerWidth).toBeUndefined()
  })
})

describe('the miniplayer position setting', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults to undefined, clamps valid coordinates, drops malformed values, and clears on reset', async () => {
    expect((await load()).getSettings().miniplayerPosition).toBeUndefined()
    expect((await load({ miniplayerPosition: 'top-left' })).getSettings().miniplayerPosition).toBeUndefined()
    expect((await load({ miniplayerPosition: [0, 0] })).getSettings().miniplayerPosition).toBeUndefined()
    expect((await load({ miniplayerPosition: { x: Number.NaN, y: 0.5 } })).getSettings().miniplayerPosition).toBeUndefined()
    expect((await load({ miniplayerPosition: { x: -1, y: 2 } })).getSettings().miniplayerPosition).toEqual({ x: 0, y: 1 })
    expect((await load({ miniplayerPosition: { x: 0.2, y: 0.4 } })).getSettings().miniplayerPosition).toEqual({ x: 0.2, y: 0.4 })

    const written: string[] = []
    vi.resetModules()
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: (_key: string, value: string) => written.push(value) })
    const { updateSettings } = await import('../../src/settings')
    updateSettings({ miniplayerPosition: { x: 0.1, y: 0.2 } })
    expect(JSON.parse(written.at(-1)!).miniplayerPosition).toEqual({ x: 0.1, y: 0.2 })
    updateSettings({ miniplayerPosition: undefined })
    expect(JSON.parse(written.at(-1)!).miniplayerPosition).toBeUndefined()
  })
})

describe('the caption size setting', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is the default size until + or - picks one of their steps', async () => {
    expect((await load()).getSettings().captionSize).toBe(100)
    expect((await load({ captionSize: 150 })).getSettings().captionSize).toBe(150)
    expect((await load({ captionSize: 50 })).getSettings().captionSize).toBe(50)
  })

  it('keeps a size the Options panel picks between the steps of + and -', async () => {
    expect((await load({ captionSize: 75 })).getSettings().captionSize).toBe(75)
    expect((await load({ captionSize: 175 })).getSettings().captionSize).toBe(175)
  })

  it('is the default size when the stored value is not one of the sizes', async () => {
    expect((await load({ captionSize: 60 })).getSettings().captionSize).toBe(100)
    expect((await load({ captionSize: 400 })).getSettings().captionSize).toBe(100)
    expect((await load({ captionSize: '150' })).getSettings().captionSize).toBe(100)
  })
})

describe('the speed setting', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps every speed on the slider range', async () => {
    for (const rate of [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3]) {
      expect((await load({ playbackRate: rate })).getSettings().playbackRate).toBe(rate)
    }
  })

  it('reads a speed off the slider\'s range or steps as the nearest one on it', async () => {
    expect((await load({ playbackRate: 1.1 })).getSettings().playbackRate).toBe(1.1)
    expect((await load({ playbackRate: 1.1 + 0.05 })).getSettings().playbackRate).toBe(1.15)
    expect((await load({ playbackRate: 3 })).getSettings().playbackRate).toBe(3)
    expect((await load({ playbackRate: 4 })).getSettings().playbackRate).toBe(3)
    expect((await load({ playbackRate: 0.1 })).getSettings().playbackRate).toBe(0.25)
    expect((await load({ playbackRate: '1.5' })).getSettings().playbackRate).toBe(1)
  })
})

describe('the caption look settings', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('start at youtube.com\'s defaults', async () => {
    expect((await load()).getSettings()).toMatchObject({
      captionFont: 'Proportional Sans-Serif',
      captionColor: 'White',
      captionSize: 100,
      captionBackground: 'Black',
      captionBackgroundOpacity: 0.75,
      captionEdge: 'None',
      captionOpacity: 1,
    })
  })

  it('keep what the Options panel picked for the next visit', async () => {
    const written: string[] = []
    vi.resetModules()
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: (_key: string, value: string) => written.push(value) })
    const { updateSettings } = await import('../../src/settings')
    updateSettings({ captionColor: 'Yellow', captionBackgroundOpacity: 0.25, captionEdge: 'Outline', captionFont: 'Casual', captionOpacity: 0.5 })
    expect((await load(JSON.parse(written.at(-1)!))).getSettings()).toMatchObject({
      captionColor: 'Yellow',
      captionBackgroundOpacity: 0.25,
      captionEdge: 'Outline',
      captionFont: 'Casual',
      captionOpacity: 0.5,
    })
  })

  it('fall back one at a time when a stored value is not a choice', async () => {
    expect((await load({ captionColor: 'Orange', captionBackground: 'Blue', captionOpacity: 0.3, captionEdge: 'Raised' })).getSettings()).toMatchObject({
      captionColor: 'White',
      captionBackground: 'Blue',
      captionOpacity: 1,
      captionEdge: 'Raised',
    })
  })
})

describe('the caption position setting', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults to undefined, clamps valid coordinates, and drops malformed values', async () => {
    expect((await load()).getSettings().captionPosition).toBeUndefined()
    expect((await load({ captionPosition: { x: 0.2, y: 0.8 } })).getSettings().captionPosition).toEqual({ x: 0.2, y: 0.8 })
    expect((await load({ captionPosition: { x: -1, y: 3 } })).getSettings().captionPosition).toEqual({ x: 0, y: 1 })
    expect((await load({ captionPosition: 'top-left' })).getSettings().captionPosition).toBeUndefined()
    expect((await load({ captionPosition: { x: Number.NaN, y: 0.5 } })).getSettings().captionPosition).toBeUndefined()
    expect((await load({ captionPosition: { x: '0.1', y: 0.5 } })).getSettings().captionPosition).toBeUndefined()
  })

  it('persists updates and clears when reset to undefined', async () => {
    const written: string[] = []
    vi.resetModules()
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: (_key: string, value: string) => written.push(value) })
    const { updateSettings } = await import('../../src/settings')
    updateSettings({ captionPosition: { x: 0.15, y: 0.25 } })
    expect(JSON.parse(written.at(-1)!).captionPosition).toEqual({ x: 0.15, y: 0.25 })
    updateSettings({ captionPosition: undefined })
    expect(JSON.parse(written.at(-1)!).captionPosition).toBeUndefined()
  })
})

describe('the captions on or off choice', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const saved = async (patch: Record<string, unknown>) => {
    const written: string[] = []
    vi.resetModules()
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: (_key: string, value: string) => written.push(value) })
    const { updateSettings } = await import('../../src/settings')
    updateSettings(patch)
    return JSON.parse(written.at(-1)!)
  }

  it('is not made until a person turns captions on or off', async () => {
    expect((await load()).getSettings().captionsChosen).toBeUndefined()
    expect((await saved({ volume: 0.5 })).captionsChosen).toBeUndefined()
  })

  it('reads an off stored with every other setting as no choice', async () => {
    expect((await load({ captionsEnabled: false, theater: true })).getSettings().captionsChosen).toBeUndefined()
  })

  it('reads a stored on as a choice', async () => {
    expect((await load({ captionsEnabled: true, captionsLanguage: 'en' })).getSettings()).toMatchObject({ captionsEnabled: true, captionsChosen: true })
  })

  it('keeps captions turned off as a choice for the next visit', async () => {
    const off = await saved({ captionsEnabled: false })
    expect(off).toMatchObject({ captionsEnabled: false, captionsChosen: true })
    expect((await load(off)).getSettings()).toMatchObject({ captionsEnabled: false, captionsChosen: true })
  })
})

describe('the Stable Volume setting', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults to off, persists toggles, and ignores non-boolean values', async () => {
    expect((await load()).getSettings().stableVolume).toBe(false)
    expect((await load({ stableVolume: 'yes' })).getSettings().stableVolume).toBe(false)
    expect((await load({ stableVolume: true })).getSettings().stableVolume).toBe(true)

    const written: string[] = []
    vi.resetModules()
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: (_key: string, value: string) => written.push(value) })
    const { updateSettings } = await import('../../src/settings')
    updateSettings({ stableVolume: true })
    expect(JSON.parse(written.at(-1)!).stableVolume).toBe(true)
    expect((await load(JSON.parse(written.at(-1)!))).getSettings().stableVolume).toBe(true)
  })
})

describe('the Hide Shorts setting', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults to off, persists toggles, and ignores non-boolean values', async () => {
    expect((await load()).getSettings().hideShorts).toBe(false)
    expect((await load({ hideShorts: 'yes' })).getSettings().hideShorts).toBe(false)
    expect((await load({ hideShorts: 1 })).getSettings().hideShorts).toBe(false)
    expect((await load({ hideShorts: true })).getSettings().hideShorts).toBe(true)

    const written: string[] = []
    vi.resetModules()
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: (_key: string, value: string) => written.push(value) })
    const { updateSettings } = await import('../../src/settings')
    updateSettings({ hideShorts: true })
    expect(JSON.parse(written.at(-1)!).hideShorts).toBe(true)
    expect((await load(JSON.parse(written.at(-1)!))).getSettings().hideShorts).toBe(true)
  })
})

describe('custom appearance settings', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('coerces customThemeColor, seekHandle, and appIcon safely and persists valid choices', async () => {
    expect((await load()).getSettings()).toMatchObject({
      customThemeColor: undefined,
      seekHandle: { kind: 'default' },
      appIcon: 'default',
    })

    const invalid = (await load({
      customThemeColor: 'not-hex',
      seekHandle: { kind: 'icon', value: 'DoesNotExistIcon' },
      appIcon: 'unknown-icon',
    })).getSettings()
    expect(invalid.customThemeColor).toBeUndefined()
    expect(invalid.seekHandle).toEqual({ kind: 'default' })
    expect(invalid.appIcon).toBe('default')

    expect((await load({ customThemeColor: '#ABC', seekHandle: { kind: 'emoji', value: '🚀' }, appIcon: 'theme' })).getSettings()).toMatchObject({
      customThemeColor: '#aabbcc',
      seekHandle: { kind: 'emoji', value: '🚀' },
      appIcon: 'theme',
    })

    expect((await load({ seekHandle: { kind: 'icon', value: 'Star' } })).getSettings().seekHandle).toEqual({
      kind: 'icon',
      value: 'Star',
    })
  })

  it('resetCustomAppearance restores default theme, palette, seekHandle, and appIcon', async () => {
    const written: string[] = []
    vi.resetModules()
    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({
        theme: 'light',
        themeChosen: true,
        customThemeColor: '#10b981',
        seekHandle: { kind: 'icon', value: 'Rocket' },
        appIcon: 'dark',
      }),
      setItem: (_key: string, value: string) => written.push(value),
    })
    const { getSettings, resetCustomAppearance } = await import('../../src/settings')
    expect(getSettings()).toMatchObject({
      theme: 'light',
      customThemeColor: '#10b981',
      seekHandle: { kind: 'icon', value: 'Rocket' },
      appIcon: 'dark',
    })
    const reset = resetCustomAppearance()
    expect(reset).toMatchObject({
      theme: 'device',
      customThemeColor: undefined,
      seekHandle: { kind: 'default' },
      appIcon: 'default',
    })
    expect(reset.themeChosen).toBeUndefined()
    expect(JSON.parse(written.at(-1)!).customThemeColor).toBeUndefined()
  })

  it('auto-selects theme appIcon when picking a custom theme accent and honors explicit Classic override', async () => {
    vi.resetModules()
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
    const { updateSettings, resetCustomAppearance } = await import('../../src/settings')
    expect(updateSettings({ customThemeColor: '#10b981' }).appIcon).toBe('theme')
    expect(updateSettings({ customThemeColor: undefined }).appIcon).toBe('default')

    // Explicitly choosing Classic sets appIconChosen so a later custom accent does not overwrite it
    expect(updateSettings({ appIcon: 'default' })).toMatchObject({ appIcon: 'default', appIconChosen: true })
    expect(updateSettings({ customThemeColor: '#2563eb' }).appIcon).toBe('default')
    expect(updateSettings({ appIcon: 'theme' }).appIcon).toBe('theme')
    expect(updateSettings({ customThemeColor: undefined }).appIcon).toBe('theme')

    const reset = resetCustomAppearance()
    expect(reset.appIcon).toBe('default')
    expect(reset.appIconChosen).toBeUndefined()
    expect(updateSettings({ customThemeColor: '#10b981' }).appIcon).toBe('theme')
  })
})

describe('the Theater mode setting', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults to default, migrates legacy booleans, and persists all three states', async () => {
    expect((await load()).getSettings().theater).toBe('default')
    expect((await load({ theater: true })).getSettings().theater).toBe('theater')
    expect((await load({ theater: false })).getSettings().theater).toBe('default')
    expect((await load({ theater: 'theater' })).getSettings().theater).toBe('theater')
    expect((await load({ theater: 'fullscreen' })).getSettings().theater).toBe('fullscreen')
    expect((await load({ theater: 'invalid' })).getSettings().theater).toBe('default')

    const written: string[] = []
    vi.resetModules()
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: (_key: string, value: string) => written.push(value) })
    const { updateSettings } = await import('../../src/settings')
    updateSettings({ theater: 'fullscreen' })
    expect(JSON.parse(written.at(-1)!).theater).toBe('fullscreen')
    expect((await load(JSON.parse(written.at(-1)!))).getSettings().theater).toBe('fullscreen')
  })
})
