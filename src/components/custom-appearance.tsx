import { css } from '@emotion/react'
import { Bell, Check, Home, Search } from 'lucide-react'
import { useEffect, useState } from 'preact/hooks'

import type { TargetedEvent } from 'preact'
import type { Settings } from '../settings'
import type { SeekHandle, SeekIconCategory, SeekIconName } from '../theme/seek-handle'

import { SeekKnob } from '../player/seek-knob'
import { resetCustomAppearance, updateSettings } from '../settings'
import { APP_ICONS, buildAppIconDataUri } from '../theme/app-icon'
import { normalizeHexColor, THEME_PRESETS } from '../theme/palette'
import { filterSeekIcons, SEEK_ICON_CATEGORIES } from '../theme/seek-handle'
import { SEEK_ICON_COMPONENTS } from '../theme/seek-icons'
import { showUndoableToast } from '../undo'
import { EmojiPickerPanel } from './emoji-picker'

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
    gap: 1rem;
    flex-wrap: wrap;
  }

  .preview-brand {
    display: inline-flex;
    align-items: center;
    gap: 0.8rem;
    font-size: 1.4rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--text-primary);
  }

  .preview-brand-mark {
    display: block;
    flex-shrink: 0;
  }

  .preview-search {
    flex: 1 1 11rem;
    max-width: 18rem;
    min-width: 0;
    height: 3rem;
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0 1.2rem;
    border: 1px solid var(--accent-focus);
    border-radius: 999px;
    background: var(--bg-input);
    color: var(--text-placeholder);
    font-size: 1.25rem;
  }

  .preview-top-end {
    display: inline-flex;
    align-items: center;
    gap: 1rem;
  }

  .preview-bell {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.8rem;
    height: 2.8rem;
    color: var(--text-primary);
  }

  .preview-badge {
    position: absolute;
    top: 0;
    right: -0.2rem;
    min-width: 1.5rem;
    height: 1.5rem;
    padding: 0 0.35rem;
    border-radius: 0.8rem;
    background: var(--brand-red);
    color: var(--brand-mark-ink, #ffffff);
    font-size: 1.05rem;
    font-weight: 500;
    line-height: 1.5rem;
    text-align: center;
  }

  .preview-meta {
    font-size: 1.25rem;
    color: var(--text-secondary);
  }

  .preview-body {
    display: grid;
    grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
    gap: 1.2rem;
    align-items: stretch;
  }

  .preview-player {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 0.8rem;
    padding: 1.1rem 1.4rem;
    border-radius: 0.6rem;
    background: var(--bg-chip);
    color: var(--text-primary);
    border: 1px solid var(--border-subtle);
  }

  .preview-player-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    font-size: 1.25rem;
  }

  .preview-player-title {
    color: var(--text-primary);
    font-weight: 500;
  }

  .preview-timestamp {
    color: var(--accent);
    font-family: var(--font-mono);
    font-size: 1.2rem;
    font-weight: 500;
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

  .preview-controls {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 0.9rem;
    min-width: 0;
  }

  .preview-nav-active {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    padding: 0.6rem 1rem;
    border-radius: 0.6rem;
    background: var(--bg-selected);
    color: var(--text-primary);
    font-size: 1.3rem;
    font-weight: 500;
  }

  .preview-accent-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.8rem 1rem;
  }

  .preview-cta {
    display: inline-flex;
    align-items: center;
    padding: 0.35rem 0.9rem;
    border-radius: 999px;
    background: var(--accent-tint);
    color: var(--accent);
    font-size: 1.2rem;
    font-weight: 500;
  }

  .preview-link {
    color: var(--accent);
    font-size: 1.25rem;
    font-weight: 500;
  }

  .preview-check-item {
    display: inline-flex;
    align-items: center;
    gap: 0.55rem;
    font-size: 1.25rem;
    color: var(--text-primary);
  }

  .preview-check {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.6rem;
    height: 1.6rem;
    border-radius: 0.35rem;
    background: var(--accent);
    color: var(--text-inverse);
    flex-shrink: 0;
  }

  @media (max-width: 540px) {
    .preview-body {
      grid-template-columns: 1fr;
    }
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

  .emoji-handle-picker {
    margin-top: 1rem;
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
    object-fit: contain;
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
            <svg className='preview-brand-mark' width='28' height='20' viewBox='0 0 30 21' aria-hidden='true'>
              <path
                d='M29.37 3.28A3.77 3.77 0 0 0 26.72.62C24.38 0 15 0 15 0S5.62 0 3.28.62A3.77 3.77 0 0 0 .63 3.28C0 5.63 0 10.5 0 10.5s0 4.87.63 7.22a3.77 3.77 0 0 0 2.65 2.66C5.62 21 15 21 15 21s9.38 0 11.72-.62a3.77 3.77 0 0 0 2.65-2.66C30 15.37 30 10.5 30 10.5s0-4.87-.63-7.22Z'
                fill='var(--brand-mark, #ff0000)'
              />
              <path d='M10.4 14.85V6.15L17.9 10.5l-7.5 4.35Z' fill='var(--brand-mark-ink, #ffffff)' />
              <path
                d='M18.6 6.75l3.2 3.75-3.2 3.75'
                fill='none'
                stroke='var(--brand-mark-ink, #ffffff)'
                strokeWidth='2'
                strokeLinecap='round'
                strokeLinejoin='round'
                opacity='0.9'
              />
            </svg>
            <span>FTube</span>
          </div>
          <div className='preview-search' aria-hidden='true'>
            <Search size={14} strokeWidth={2} aria-hidden='true' />
            <span>Search</span>
          </div>
          <div className='preview-top-end'>
            <span className='preview-bell' aria-hidden='true'>
              <Bell size={16} strokeWidth={1.75} aria-hidden='true' />
              <span className='preview-badge'>3</span>
            </span>
            <span className='preview-meta'>{paletteLabel} ({resolvedMode})</span>
          </div>
        </div>
        <div className='preview-body'>
          <div className='preview-player' aria-label='Seek bar preview'>
            <div className='preview-player-row' aria-hidden='true'>
              <span className='preview-player-title'>Now playing</span>
              <span className='preview-timestamp'>02:14</span>
            </div>
            <div className='preview-scrubber'>
              <div className='preview-track'>
                <div className='preview-played' />
                <SeekKnob handle={settings.seekHandle} />
              </div>
            </div>
          </div>
          <div className='preview-controls' aria-hidden='true'>
            <div className='preview-nav-active'>
              <Home size={15} strokeWidth={2} aria-hidden='true' />
              <span>Home</span>
            </div>
            <div className='preview-accent-row'>
              <span className='preview-cta'>Chapter 2</span>
              <span className='preview-link'>Show more</span>
              <span className='preview-check-item'>
                <span className='preview-check'>
                  <Check size={12} strokeWidth={2.5} aria-hidden='true' />
                </span>
                <span>Autoplay</span>
              </span>
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
            <div className='emoji-handle-picker' role='group' aria-label='Seek handle emojis'>
              <EmojiPickerPanel
                variant='inline'
                selected={settings.seekHandle.kind === 'emoji' ? settings.seekHandle.value : undefined}
                onPick={(emoji: string) => pickHandle({ kind: 'emoji', value: emoji })}
              />
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
