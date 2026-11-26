import { css } from '@emotion/react'
import { useEffect, useState } from 'preact/hooks'

import type { TargetedEvent } from 'preact'
import type { Settings } from '../settings'
import type { SeekHandle, SeekIconCategory, SeekIconName } from '../theme/seek-handle'
import type { EmojiCategory } from './emoji-picker'

import { SeekKnob } from '../player/seek-knob'
import { resetCustomAppearance, updateSettings } from '../settings'
import { APP_ICONS, buildAppIconDataUri } from '../theme/app-icon'
import { normalizeHexColor, THEME_PRESETS } from '../theme/palette'
import { filterSeekIcons, SEEK_ICON_CATEGORIES } from '../theme/seek-handle'
import { SEEK_ICON_COMPONENTS } from '../theme/seek-icons'
import { showUndoableToast } from '../undo'
import { EMOJI_CATEGORIES, filterEmojis } from './emoji-picker'

const style = css`
  display: flex;
  flex-direction: column;
  gap: 1.6rem;

  .subhead {
    font-size: 1.4rem;
    font-weight: 500;
    color: var(--text-primary);
    margin: 0 0 0.8rem;
  }

  .error-text {
    margin: 0.6rem 0 0;
    font-size: 1.25rem;
    color: var(--danger);
  }

  .preview-strip {
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
    padding: 1.4rem;
    border-radius: 0.8rem;
    background: var(--bg-subtle);
    border: 1px solid var(--border);
  }

  .preview-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.2rem;
    flex-wrap: wrap;
  }

  .preview-brand {
    display: flex;
    align-items: center;
    gap: 1rem;
    font-size: 1.4rem;
    font-weight: 500;
    color: var(--text-primary);
  }

  .preview-brand img {
    width: 2.8rem;
    height: 2.8rem;
    border-radius: 0.6rem;
    flex-shrink: 0;
  }

  .preview-meta {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    font-size: 1.25rem;
    color: var(--text-secondary);
  }

  .preview-cta {
    display: inline-flex;
    align-items: center;
    padding: 0.4rem 1rem;
    border-radius: 999px;
    background: var(--accent-tint);
    color: var(--accent);
    font-size: 1.2rem;
    font-weight: 500;
  }

  .preview-player {
    padding: 1.4rem 1.4rem 1rem;
    border-radius: 0.6rem;
    background: var(--bg-chip);
    color: var(--text-primary);
    border: 1px solid var(--border-subtle);
  }

  .preview-scrubber {
    position: relative;
    height: 1.6rem;
    display: flex;
    align-items: center;
  }

  .preview-track {
    position: relative;
    width: 100%;
    height: 0.4rem;
    background: color-mix(in srgb, var(--text-primary) 18%, transparent);
    border-radius: 999px;
  }

  .preview-played {
    position: absolute;
    inset: 0 auto 0 0;
    width: 45%;
    background: var(--brand-red);
    border-radius: 999px;
  }

  .preview-track .knob {
    position: absolute;
    top: 50%;
    left: 45%;
    transform: translate(-50%, -50%);
  }

  .preset-choice {
    display: inline-flex;
    align-items: center;
    gap: 0.7rem;
  }

  .swatch {
    width: 1.4rem;
    height: 1.4rem;
    border-radius: 50%;
    border: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }

  .color-row {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    margin-top: 1rem;
    flex-wrap: wrap;
  }

  .color-picker {
    width: 3.6rem;
    height: 3.2rem;
    padding: 0.2rem;
    border: 1px solid var(--border-strong);
    border-radius: 0.6rem;
    background: var(--bg-input);
    cursor: pointer;
  }

  .text-input {
    height: 3.2rem;
    padding: 0 1rem;
    border: 1px solid var(--border-strong);
    border-radius: 0.6rem;
    background: var(--bg-input);
    color: var(--text-primary);
    font-family: inherit;
    font-size: 1.35rem;
  }

  .text-input:focus-visible {
    outline: 2px solid var(--accent-focus);
    outline-offset: 1px;
  }

  .hex-input {
    width: 12rem;
    font-family: var(--font-mono);
  }

  .search-input {
    width: min(28rem, 100%);
  }

  .filter-row {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    margin-top: 1rem;
    flex-wrap: wrap;
  }

  .handle-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(4rem, 1fr));
    gap: 0.6rem;
    margin-top: 1rem;
    max-height: 22rem;
    overflow-y: auto;
    padding: 0.8rem;
    border: 1px solid var(--border);
    border-radius: 0.8rem;
    background: var(--bg-subtle);
  }

  .handle-tile {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 3.8rem;
    border: 1px solid transparent;
    border-radius: 0.6rem;
    background: transparent;
    color: var(--text-primary);
    font-size: 2rem;
    cursor: pointer;
  }

  .handle-tile:hover {
    background: var(--bg-chip);
  }

  .handle-tile.active {
    background: var(--bg-chip);
    border-color: var(--accent);
    color: var(--accent);
  }

  .icon-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
    gap: 0.8rem;
  }

  .app-icon-tile {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.9rem 1.2rem;
    border: 1px solid var(--border);
    border-radius: 0.8rem;
    background: var(--bg-chip);
    color: var(--text-primary);
    font-family: inherit;
    font-size: 1.35rem;
    font-weight: 500;
    cursor: pointer;
  }

  .app-icon-tile:hover {
    background: var(--bg-chip-hover);
  }

  .app-icon-tile.active {
    background: var(--bg-inverse);
    color: var(--text-inverse);
    border-color: var(--bg-inverse);
  }

  .app-icon-tile img {
    width: 2.8rem;
    height: 2.8rem;
    border-radius: 0.6rem;
    flex-shrink: 0;
  }

  .actions-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.2rem;
    flex-wrap: wrap;
    padding-top: 0.4rem;
    border-top: 1px solid var(--border);
  }
`

type HandleTab = 'default' | 'emoji' | 'icon'

type Props = {
  settings: Settings
  onUpdate: (patch: Partial<Settings>) => void
}

export const CustomAppearance = ({ settings, onUpdate }: Props) => {
  const [hexDraft, setHexDraft] = useState(settings.customThemeColor ?? '')
  const [handleTab, setHandleTab] = useState<HandleTab>(settings.seekHandle.kind)
  const [emojiCategory, setEmojiCategory] = useState<EmojiCategory | 'All'>('All')
  const [emojiQuery, setEmojiQuery] = useState('')
  const [iconCategory, setIconCategory] = useState<SeekIconCategory | 'All'>('All')
  const [iconQuery, setIconQuery] = useState('')
  const [deviceLight, setDeviceLight] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: light)').matches
      : false,
  )

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-color-scheme: light)')
    const sync = () => setDeviceLight(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    setHexDraft(settings.customThemeColor ?? '')
  }, [settings.customThemeColor])

  useEffect(() => {
    if (settings.seekHandle.kind === 'emoji' || settings.seekHandle.kind === 'icon') {
      setHandleTab(settings.seekHandle.kind)
    }
  }, [settings.seekHandle])

  useEffect(() => {
    if (window.location.hash !== '#custom-appearance') return
    document.getElementById('custom-appearance')?.scrollIntoView({ behavior: 'auto', block: 'start' })
  }, [])

  const activeColor = settings.customThemeColor
  const colorPickerValue = activeColor ?? '#ff0033'
  const resolvedMode = settings.theme === 'device' ? (deviceLight ? 'light' : 'dark') : settings.theme
  const activePreset = THEME_PRESETS.find(preset => preset.color === activeColor)
  const paletteLabel = activePreset ? activePreset.name : activeColor ? `Custom (${activeColor})` : 'Default'
  const invalidHex = hexDraft.trim() !== '' && !normalizeHexColor(hexDraft)

  const visibleEmojis = filterEmojis(emojiQuery, emojiCategory === 'All' ? undefined : emojiCategory)
  const visibleIcons = filterSeekIcons(iconQuery, iconCategory === 'All' ? undefined : iconCategory)

  const handleHexInput = (raw: string) => {
    setHexDraft(raw)
    if (!raw.trim()) {
      onUpdate({ customThemeColor: undefined })
      return
    }
    const normalized = normalizeHexColor(raw)
    if (normalized) onUpdate({ customThemeColor: normalized })
  }

  const pickHandle = (seekHandle: SeekHandle) => {
    onUpdate({ seekHandle })
  }

  const handleReset = () => {
    const previous = {
      theme: settings.theme,
      themeChosen: settings.themeChosen,
      customThemeColor: settings.customThemeColor,
      seekHandle: settings.seekHandle,
      appIcon: settings.appIcon,
    }
    resetCustomAppearance()
    setHexDraft('')
    setHandleTab('default')
    setEmojiQuery('')
    setIconQuery('')
    showUndoableToast('Custom appearance reset to default', {
      label: 'Reset custom appearance',
      undo: () => {
        updateSettings(previous)
      },
    })
  }

  return (
    <section className='section' id='custom-appearance' css={style}>
      <h2 className='section-title'>Custom appearance</h2>

      <div className='preview-strip'>
        <div className='preview-top'>
          <div className='preview-brand'>
            <img src={buildAppIconDataUri(settings.appIcon, activeColor)} alt='' aria-hidden='true' />
            <span>FTube</span>
          </div>
          <div className='preview-meta'>
            <span>{paletteLabel} ({resolvedMode})</span>
            <span className='preview-cta'>Preview accent</span>
          </div>
        </div>
        <div className='preview-player' aria-label='Seek bar preview'>
          <div className='preview-scrubber'>
            <div className='preview-track'>
              <div className='preview-played' />
              <SeekKnob handle={settings.seekHandle} />
            </div>
          </div>
        </div>
      </div>

      <div>
        <h3 className='subhead'>Theme palette</h3>
        <div className='choices'>
          <button
            type='button'
            className={!activeColor ? 'choice active' : 'choice'}
            aria-pressed={!activeColor}
            onClick={() => onUpdate({ customThemeColor: undefined })}
          >
            Default
          </button>
          {THEME_PRESETS.map(preset => (
            <button
              type='button'
              key={preset.id}
              className={activeColor === preset.color ? 'choice preset-choice active' : 'choice preset-choice'}
              aria-pressed={activeColor === preset.color}
              onClick={() => onUpdate({ customThemeColor: preset.color })}
            >
              <span className='swatch' style={{ background: preset.color }} aria-hidden='true' />
              <span>{preset.name}</span>
            </button>
          ))}
        </div>
        <div className='color-row'>
          <input
            type='color'
            className='color-picker'
            aria-label='Custom primary color picker'
            value={colorPickerValue}
            onInput={(event: TargetedEvent<HTMLInputElement>) => handleHexInput(event.currentTarget.value)}
          />
          <input
            type='text'
            className='text-input hex-input'
            aria-label='Custom primary color hex'
            placeholder='#ff0033'
            maxLength={7}
            spellcheck={false}
            value={hexDraft}
            onInput={(event: TargetedEvent<HTMLInputElement>) => handleHexInput(event.currentTarget.value)}
          />
        </div>
        {invalidHex
          ? <p className='error-text'>Enter a valid 3-digit or 6-digit hex color such as #10b981.</p>
          : undefined}
      </div>

      <div>
        <h3 className='subhead'>Seek bar handle</h3>
        <div className='choices' role='tablist' aria-label='Seek bar handle type'>
          <button
            type='button'
            role='tab'
            aria-selected={handleTab === 'default'}
            className={handleTab === 'default' ? 'choice active' : 'choice'}
            onClick={() => {
              setHandleTab('default')
              pickHandle({ kind: 'default' })
            }}
          >
            Default
          </button>
          <button
            type='button'
            role='tab'
            aria-selected={handleTab === 'emoji'}
            className={handleTab === 'emoji' ? 'choice active' : 'choice'}
            onClick={() => setHandleTab('emoji')}
          >
            Emoji
          </button>
          <button
            type='button'
            role='tab'
            aria-selected={handleTab === 'icon'}
            className={handleTab === 'icon' ? 'choice active' : 'choice'}
            onClick={() => setHandleTab('icon')}
          >
            Icon
          </button>
        </div>

        {handleTab === 'emoji'
          ? (
            <div>
              <div className='filter-row'>
                <input
                  type='search'
                  className='text-input search-input'
                  aria-label='Search seek emojis'
                  placeholder='Search emojis...'
                  value={emojiQuery}
                  onInput={(event: TargetedEvent<HTMLInputElement>) => setEmojiQuery(event.currentTarget.value)}
                />
              </div>
              <div className='filter-row'>
                <button
                  type='button'
                  className={emojiCategory === 'All' ? 'choice active' : 'choice'}
                  aria-pressed={emojiCategory === 'All'}
                  onClick={() => setEmojiCategory('All')}
                >
                  All
                </button>
                {EMOJI_CATEGORIES.map(category => (
                  <button
                    type='button'
                    key={category}
                    className={emojiCategory === category ? 'choice active' : 'choice'}
                    aria-pressed={emojiCategory === category}
                    onClick={() => setEmojiCategory(category)}
                  >
                    {category}
                  </button>
                ))}
              </div>
              <div className='handle-grid' role='group' aria-label='Seek handle emojis'>
                {visibleEmojis.map((entry) => {
                  const active = settings.seekHandle.kind === 'emoji' && settings.seekHandle.value === entry.emoji
                  return (
                    <button
                      type='button'
                      key={entry.name}
                      className={active ? 'handle-tile active' : 'handle-tile'}
                      aria-label={entry.name}
                      aria-pressed={active}
                      title={entry.name}
                      onClick={() => pickHandle({ kind: 'emoji', value: entry.emoji })}
                    >
                      <span aria-hidden='true'>{entry.emoji}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
          : undefined}

        {handleTab === 'icon'
          ? (
            <div>
              <div className='filter-row'>
                <input
                  type='search'
                  className='text-input search-input'
                  aria-label='Search seek icons'
                  placeholder='Search icons...'
                  value={iconQuery}
                  onInput={(event: TargetedEvent<HTMLInputElement>) => setIconQuery(event.currentTarget.value)}
                />
              </div>
              <div className='filter-row'>
                <button
                  type='button'
                  className={iconCategory === 'All' ? 'choice active' : 'choice'}
                  aria-pressed={iconCategory === 'All'}
                  onClick={() => setIconCategory('All')}
                >
                  All
                </button>
                {SEEK_ICON_CATEGORIES.map(category => (
                  <button
                    type='button'
                    key={category}
                    className={iconCategory === category ? 'choice active' : 'choice'}
                    aria-pressed={iconCategory === category}
                    onClick={() => setIconCategory(category)}
                  >
                    {category}
                  </button>
                ))}
              </div>
              <div className='handle-grid' role='group' aria-label='Seek handle icons'>
                {visibleIcons.map((entry) => {
                  const Icon = SEEK_ICON_COMPONENTS[entry.name as SeekIconName]
                  const active = settings.seekHandle.kind === 'icon' && settings.seekHandle.value === entry.name
                  return (
                    <button
                      type='button'
                      key={entry.name}
                      className={active ? 'handle-tile active' : 'handle-tile'}
                      aria-label={entry.label}
                      aria-pressed={active}
                      title={entry.label}
                      onClick={() => pickHandle({ kind: 'icon', value: entry.name })}
                    >
                      <Icon size={18} strokeWidth={2} aria-hidden />
                    </button>
                  )
                })}
              </div>
            </div>
          )
          : undefined}
      </div>

      <div>
        <h3 className='subhead'>Web app icon</h3>
        <div className='icon-grid' role='group' aria-label='Web app icon variants'>
          {APP_ICONS.map((option) => {
            const active = settings.appIcon === option.id
            return (
              <button
                type='button'
                key={option.id}
                className={active ? 'app-icon-tile active' : 'app-icon-tile'}
                aria-label={option.label}
                aria-pressed={active}
                onClick={() => onUpdate({ appIcon: option.id })}
              >
                <img src={buildAppIconDataUri(option.id, activeColor)} alt='' aria-hidden='true' />
                <span>{option.title}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className='actions-row'>
        <button type='button' className='choice' onClick={handleReset}>
          Reset to default
        </button>
      </div>
    </section>
  )
}
