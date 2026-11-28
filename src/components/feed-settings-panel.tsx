import type { TargetedEvent, TargetedSubmitEvent } from 'preact'

import type {
  DurationPreset,
  FeedFontFamily,
  FeedLayoutMode,
  FeedSurface,
  UploadDatePreset,
} from '../feeds/settings'

import { css } from '@emotion/react'
import { RotateCcw, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'preact/hooks'

import {
  addBlockedChannel,
  addBlockedKeyword,
  addCustomFeedFilter,
  FEED_FONT_OPTIONS,
  removeBlockedChannel,
  removeBlockedKeyword,
  removeCustomFeedFilter,
  resetFeedCardStyle,
  setFeedLayout,
  toggleCustomFeedFilter,
  updateFeedCardStyle,
  updateFeedHide,
  updateFeedViewSettings,
  useFeedViewSettings,
} from '../feeds/settings'
import { updateSettings, useSetting } from '../settings'
import { PreviewSelect } from './preview-select'

type PanelTab = 'card' | 'filters' | 'blocklist'

const TABS: readonly { id: PanelTab, label: string }[] = [
  { id: 'card', label: 'Card' },
  { id: 'filters', label: 'Filters' },
  { id: 'blocklist', label: 'Blocklist' },
]

const SURFACE_LABELS: Record<FeedSurface, string> = {
  subscriptions: 'Subscriptions',
  channel: 'Channel Videos',
  home: 'Home',
  other: 'Feed',
}

const panelStyle = css`
  position: fixed;
  top: var(--header-height, 5.6rem);
  right: 0;
  bottom: 0;
  z-index: 1500;
  width: min(36rem, 100vw);
  display: flex;
  flex-direction: column;
  background: var(--bg-menu);
  border-left: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-menu);
  color: var(--text-primary);

  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.2rem;
    padding: 1.4rem 1.6rem;
    border-bottom: 1px solid var(--border-subtle);
  }

  .panel-title {
    margin: 0;
    font-size: 1.6rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .icon-btn {
    width: 3.2rem;
    height: 3.2rem;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .icon-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .panel-tabs {
    display: flex;
    gap: 0.6rem;
    padding: 1rem 1.6rem;
    border-bottom: 1px solid var(--border-subtle);
  }

  .tab-btn {
    flex: 1;
    height: 3.2rem;
    padding: 0 1rem;
    border: none;
    border-radius: 0.8rem;
    background: var(--bg-chip);
    color: var(--text-primary);
    font-size: 1.3rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .tab-btn:hover {
    background: var(--bg-chip-hover);
  }

  .tab-btn[aria-selected='true'] {
    background: var(--bg-inverse);
    color: var(--text-inverse);
  }

  .panel-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 1.6rem;
    display: flex;
    flex-direction: column;
    gap: 1.8rem;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .section-title {
    margin: 0;
    font-size: 1.2rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-secondary);
  }

  .segmented {
    display: flex;
    gap: 0.6rem;
  }

  .seg-btn {
    flex: 1;
    height: 3.2rem;
    padding: 0 1rem;
    border: none;
    border-radius: 0.8rem;
    background: var(--bg-chip);
    color: var(--text-primary);
    font-size: 1.3rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .seg-btn:hover {
    background: var(--bg-chip-hover);
  }

  .seg-btn[aria-pressed='true'] {
    background: var(--bg-inverse);
    color: var(--text-inverse);
  }

  .check-row {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    font-size: 1.35rem;
    color: var(--text-primary);
    cursor: pointer;
  }

  .check-row input[type='checkbox'] {
    width: 1.7rem;
    height: 1.7rem;
    margin: 0;
    accent-color: var(--accent);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .field-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    font-size: 1.3rem;
    color: var(--text-primary);
  }

  .field-val {
    font-size: 1.2rem;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }

  .field input[type='range'] {
    width: 100%;
    margin: 0;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .select,
  .text-input,
  .num-input {
    height: 3.4rem;
    padding: 0 1rem;
    border: 1px solid var(--border);
    border-radius: 0.8rem;
    background: var(--bg-input);
    color: var(--text-primary);
    font: inherit;
    font-size: 1.3rem;
  }

  .row-inline {
    display: flex;
    align-items: center;
    gap: 0.8rem;
  }

  .row-inline .text-input,
  .row-inline .num-input {
    flex: 1;
    min-width: 0;
  }

  .color-row {
    display: flex;
    align-items: center;
    gap: 0.8rem;
  }

  .color-input {
    width: 3.6rem;
    height: 3rem;
    padding: 0.2rem;
    border: 1px solid var(--border);
    border-radius: 0.6rem;
    background: var(--bg-input);
    cursor: pointer;
  }

  .small-btn {
    height: 3.2rem;
    padding: 0 1.2rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    border: none;
    border-radius: 0.8rem;
    background: var(--bg-chip);
    color: var(--text-primary);
    font-size: 1.3rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .small-btn:hover {
    background: var(--bg-chip-hover);
  }

  .small-btn.primary {
    background: var(--bg-inverse);
    color: var(--text-inverse);
  }

  .small-btn.primary:hover {
    background: var(--bg-inverse-hover);
  }

  .tag-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
  }

  .tag {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    height: 2.8rem;
    padding: 0 0.6rem 0 1rem;
    border-radius: 1.4rem;
    background: var(--bg-chip);
    font-size: 1.25rem;
    color: var(--text-primary);
  }

  .tag button {
    width: 2rem;
    height: 2rem;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .tag button:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .custom-list {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .custom-item {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .custom-item .seg-btn {
    text-align: left;
  }

  .muted {
    margin: 0;
    font-size: 1.25rem;
    color: var(--text-secondary);
  }
`

const parseOptionalNum = (value: string): number | undefined => {
  if (!value.trim()) return undefined
  const num = Number(value)
  return Number.isFinite(num) && num >= 0 ? num : undefined
}

const hexByte = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')

const cssColorToHex = (varName: string, fallback: string): string => {
  if (typeof document === 'undefined') return fallback
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  if (!raw) return fallback
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw
  if (/^#[0-9a-f]{3}$/i.test(raw)) return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`
  const rgb = raw.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
  return rgb ? `#${hexByte(Number(rgb[1]))}${hexByte(Number(rgb[2]))}${hexByte(Number(rgb[3]))}` : fallback
}

export const FeedSettingsPanel = (
  { surface, open, onClose }: {
    surface: FeedSurface
    open: boolean
    onClose: () => void
  },
) => {
  const settings = useFeedViewSettings()
  const hideShorts = useSetting('hideShorts')
  const surfaceLayout = settings.layouts[surface]
  const [tab, setTab] = useState<PanelTab>('card')
  const [editMode, setEditMode] = useState<FeedLayoutMode>(surfaceLayout)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const tabRefs = useRef<Partial<Record<PanelTab, HTMLButtonElement | null>>>({})

  const [keywordDraft, setKeywordDraft] = useState('')
  const [channelDraft, setChannelDraft] = useState('')
  const [cfName, setCfName] = useState('')
  const [cfKeyword, setCfKeyword] = useState('')
  const [cfDuration, setCfDuration] = useState<DurationPreset>('any')
  const [cfMinMinutes, setCfMinMinutes] = useState<number | undefined>(undefined)
  const [cfMaxMinutes, setCfMaxMinutes] = useState<number | undefined>(undefined)
  const [cfDate, setCfDate] = useState<UploadDatePreset>('any')
  const [cfHideShorts, setCfHideShorts] = useState(false)
  const [cfHideLive, setCfHideLive] = useState(false)
  const [cfHideWatched, setCfHideWatched] = useState(false)
  const [cfHidePremieres, setCfHidePremieres] = useState(false)
  const [cfHideUpcoming, setCfHideUpcoming] = useState(false)
  const [cfHidePastStreams, setCfHidePastStreams] = useState(false)

  useEffect(() => {
    setEditMode(surfaceLayout)
  }, [surfaceLayout, surface])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      onCloseRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  if (!open) return null

  const cardStyle = settings.cardStyles[editMode]
  const patchCard = (patch: Partial<typeof cardStyle>) => updateFeedCardStyle(editMode, patch)
  const defaultTitleColor = cssColorToHex('--text-primary', '#f1f1f1')
  const defaultMetaColor = cssColorToHex('--text-secondary', '#aaaaaa')

  const selectTab = (next: PanelTab, focusButton = false) => {
    setTab(next)
    if (focusButton) tabRefs.current[next]?.focus()
  }

  const onTabKeyDown = (event: KeyboardEvent, index: number) => {
    let targetIndex = -1
    if (event.key === 'ArrowRight') targetIndex = (index + 1) % TABS.length
    else if (event.key === 'ArrowLeft') targetIndex = (index - 1 + TABS.length) % TABS.length
    else if (event.key === 'Home') targetIndex = 0
    else if (event.key === 'End') targetIndex = TABS.length - 1
    if (targetIndex === -1) return
    event.preventDefault()
    selectTab(TABS[targetIndex]!.id, true)
  }

  const normalizeDurationOrder = () => {
    const { minMinutes, maxMinutes } = settings.durationFilter
    if (minMinutes !== undefined && maxMinutes !== undefined && minMinutes > maxMinutes) {
      updateFeedViewSettings({
        durationFilter: {
          ...settings.durationFilter,
          minMinutes: maxMinutes,
          maxMinutes: minMinutes,
        },
      })
    }
  }

  const submitKeyword = (event: TargetedSubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!keywordDraft.trim()) return
    addBlockedKeyword(keywordDraft)
    setKeywordDraft('')
  }

  const submitChannel = (event: TargetedSubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!channelDraft.trim()) return
    addBlockedChannel(channelDraft)
    setChannelDraft('')
  }

  const submitCustomFilter = (event: TargetedSubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!cfName.trim()) return
    addCustomFeedFilter({
      name: cfName,
      keyword: cfKeyword,
      durationPreset: cfDuration,
      ...(cfDuration === 'custom'
        ? { minMinutes: cfMinMinutes, maxMinutes: cfMaxMinutes }
        : {}),
      uploadDate: cfDate,
      ...(cfHideShorts ? { hideShorts: true } : {}),
      ...(cfHideLive ? { hideLive: true } : {}),
      ...(cfHideWatched ? { hideWatched: true } : {}),
      ...(cfHidePremieres ? { hidePremieres: true } : {}),
      ...(cfHideUpcoming ? { hideUpcoming: true } : {}),
      ...(cfHidePastStreams ? { hidePastStreams: true } : {}),
    })
    setCfName('')
    setCfKeyword('')
    setCfDuration('any')
    setCfMinMinutes(undefined)
    setCfMaxMinutes(undefined)
    setCfDate('any')
    setCfHideShorts(false)
    setCfHideLive(false)
    setCfHideWatched(false)
    setCfHidePremieres(false)
    setCfHideUpcoming(false)
    setCfHidePastStreams(false)
  }

  return (
    <aside css={panelStyle} role='complementary' aria-label='Feed display settings'>
      <div className='panel-head'>
        <h2 className='panel-title'>Feed settings</h2>
        <button type='button' className='icon-btn' aria-label='Close feed settings' onClick={onClose}>
          <X size={18} strokeWidth={1.75} />
        </button>
      </div>

      <div className='panel-tabs' role='tablist' aria-label='Feed settings sections'>
        {TABS.map((entry, index) => (
          <button
            key={entry.id}
            ref={(el: HTMLButtonElement | null) => { tabRefs.current[entry.id] = el }}
            id={`feed-tab-${entry.id}`}
            type='button'
            role='tab'
            className='tab-btn'
            aria-selected={tab === entry.id}
            aria-controls={`feed-tabpanel-${entry.id}`}
            tabIndex={tab === entry.id ? 0 : -1}
            onClick={() => selectTab(entry.id)}
            onKeyDown={(event: KeyboardEvent) => onTabKeyDown(event, index)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div
        className='panel-body'
        role='tabpanel'
        id={`feed-tabpanel-${tab}`}
        aria-labelledby={`feed-tab-${tab}`}
      >
        {tab === 'card'
          ? (
            <>
              <div className='section'>
                <h3 className='section-title'>{SURFACE_LABELS[surface]} layout</h3>
                <div className='segmented' role='group' aria-label={`${SURFACE_LABELS[surface]} layout`}>
                  <button
                    type='button'
                    className='seg-btn'
                    aria-pressed={surfaceLayout === 'grid'}
                    onClick={() => setFeedLayout(surface, 'grid')}
                  >
                    Grid
                  </button>
                  <button
                    type='button'
                    className='seg-btn'
                    aria-pressed={surfaceLayout === 'list'}
                    onClick={() => setFeedLayout(surface, 'list')}
                  >
                    List
                  </button>
                </div>
                <label className='check-row'>
                  <input
                    type='checkbox'
                    checked={settings.showDuration}
                    onChange={(event: TargetedEvent<HTMLInputElement>) =>
                      updateFeedViewSettings({ showDuration: event.currentTarget.checked })}
                  />
                  Show video durations
                </label>
                <label className='check-row'>
                  <input
                    type='checkbox'
                    checked={settings.showChannelDescriptions}
                    onChange={(event: TargetedEvent<HTMLInputElement>) =>
                      updateFeedViewSettings({ showChannelDescriptions: event.currentTarget.checked })}
                  />
                  Show descriptions on channel Videos
                </label>
              </div>

              <div className='section'>
                <h3 className='section-title'>Editing card style</h3>
                <div className='segmented' role='group' aria-label='Card style target'>
                  <button
                    type='button'
                    className='seg-btn'
                    aria-pressed={editMode === 'grid'}
                    onClick={() => setEditMode('grid')}
                  >
                    Grid cards
                  </button>
                  <button
                    type='button'
                    className='seg-btn'
                    aria-pressed={editMode === 'list'}
                    onClick={() => setEditMode('list')}
                  >
                    List rows
                  </button>
                </div>

                <label className='field'>
                  <span className='field-head'>
                    <span>Thumbnail size</span>
                    <span className='field-val'>
                      {editMode === 'list' ? `${cardStyle.thumbSize} px` : `${cardStyle.thumbSize}%`}
                    </span>
                  </span>
                  <input
                    type='range'
                    aria-label='Thumbnail size'
                    min={editMode === 'list' ? 140 : 60}
                    max={editMode === 'list' ? 420 : 100}
                    step={editMode === 'list' ? 10 : 5}
                    value={cardStyle.thumbSize}
                    onInput={(event: TargetedEvent<HTMLInputElement>) =>
                      patchCard({ thumbSize: Number(event.currentTarget.value) })}
                  />
                </label>

                <div className='field'>
                  <span className='field-head'>
                    <span>Thumbnail position</span>
                  </span>
                  <div className='segmented' role='group' aria-label='Thumbnail position'>
                    <button
                      type='button'
                      className='seg-btn'
                      aria-pressed={cardStyle.thumbPosition === 'start'}
                      onClick={() => patchCard({ thumbPosition: 'start' })}
                    >
                      {editMode === 'list' ? 'Left' : 'Top'}
                    </button>
                    <button
                      type='button'
                      className='seg-btn'
                      aria-pressed={cardStyle.thumbPosition === 'end'}
                      onClick={() => patchCard({ thumbPosition: 'end' })}
                    >
                      {editMode === 'list' ? 'Right' : 'Bottom'}
                    </button>
                  </div>
                </div>

                {editMode === 'grid'
                  ? (
                    <label className='field'>
                      <span className='field-head'>
                        <span>Card width</span>
                        <span className='field-val'>{cardStyle.cardWidth} px</span>
                      </span>
                      <input
                        type='range'
                        aria-label='Card width'
                        min={220}
                        max={520}
                        step={10}
                        value={cardStyle.cardWidth}
                        onInput={(event: TargetedEvent<HTMLInputElement>) =>
                          patchCard({ cardWidth: Number(event.currentTarget.value) })}
                      />
                    </label>
                  )
                  : (
                    <>
                      <div className='field'>
                        <span className='field-head'>
                          <span>Columns</span>
                          <span className='field-val'>
                            {cardStyle.listColumns === 1 ? '1 column' : `${cardStyle.listColumns} columns`}
                          </span>
                        </span>
                        <div className='segmented' role='group' aria-label='List columns'>
                          {[1, 2, 3, 4].map(columns => (
                            <button
                              key={columns}
                              type='button'
                              className='seg-btn'
                              aria-pressed={cardStyle.listColumns === columns}
                              onClick={() => patchCard({ listColumns: columns })}
                            >
                              {String(columns)}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className='field'>
                        <span className='field-head'>
                          <span>Card width</span>
                          <span className='field-val'>
                            {cardStyle.cardWidth === 0 ? 'Full' : `${cardStyle.cardWidth} px`}
                          </span>
                        </span>
                        <div className='row-inline'>
                          <input
                            type='range'
                            aria-label='Card width'
                            min={560}
                            max={1600}
                            step={20}
                            value={cardStyle.cardWidth === 0 ? 1200 : cardStyle.cardWidth}
                            onInput={(event: TargetedEvent<HTMLInputElement>) =>
                              patchCard({ cardWidth: Number(event.currentTarget.value) })}
                          />
                          {cardStyle.cardWidth !== 0
                            ? (
                              <button type='button' className='small-btn' onClick={() => patchCard({ cardWidth: 0 })}>
                                Full
                              </button>
                            )
                            : undefined}
                        </div>
                      </div>
                    </>
                  )}

                <label className='field'>
                  <span className='field-head'>
                    <span>Title size</span>
                    <span className='field-val'>{cardStyle.titleSize} px</span>
                  </span>
                  <input
                    type='range'
                    aria-label='Title size'
                    min={12}
                    max={26}
                    step={1}
                    value={cardStyle.titleSize}
                    onInput={(event: TargetedEvent<HTMLInputElement>) =>
                      patchCard({ titleSize: Number(event.currentTarget.value) })}
                  />
                </label>

                <label className='check-row'>
                  <input
                    type='checkbox'
                    checked={cardStyle.boldTitle}
                    onChange={(event: TargetedEvent<HTMLInputElement>) =>
                      patchCard({ boldTitle: event.currentTarget.checked })}
                  />
                  Bold titles
                </label>

                <div className='field'>
                  <span className='field-head'>
                    <span>Font</span>
                  </span>
                  <PreviewSelect
                    ariaLabel='Card font'
                    align='start'
                    fullWidth
                    value={cardStyle.font}
                    options={FEED_FONT_OPTIONS}
                    onChange={(font: FeedFontFamily) => patchCard({ font })}
                  />
                </div>

                <div className='field'>
                  <span className='field-head'>
                    <span>Title color</span>
                    <span className='field-val'>{cardStyle.titleColor || 'Default'}</span>
                  </span>
                  <div className='color-row'>
                    <input
                      type='color'
                      className='color-input'
                      aria-label='Title color'
                      value={cardStyle.titleColor || defaultTitleColor}
                      onInput={(event: TargetedEvent<HTMLInputElement>) =>
                        patchCard({ titleColor: event.currentTarget.value })}
                    />
                    {cardStyle.titleColor
                      ? (
                        <button type='button' className='small-btn' onClick={() => patchCard({ titleColor: '' })}>
                          Reset
                        </button>
                      )
                      : undefined}
                  </div>
                </div>

                <div className='field'>
                  <span className='field-head'>
                    <span>Metadata color</span>
                    <span className='field-val'>{cardStyle.metaColor || 'Default'}</span>
                  </span>
                  <div className='color-row'>
                    <input
                      type='color'
                      className='color-input'
                      aria-label='Metadata color'
                      value={cardStyle.metaColor || defaultMetaColor}
                      onInput={(event: TargetedEvent<HTMLInputElement>) =>
                        patchCard({ metaColor: event.currentTarget.value })}
                    />
                    {cardStyle.metaColor
                      ? (
                        <button type='button' className='small-btn' onClick={() => patchCard({ metaColor: '' })}>
                          Reset
                        </button>
                      )
                      : undefined}
                  </div>
                </div>

                <div className='field'>
                  <span className='field-head'>
                    <span>Description length</span>
                    <span className='field-val'>
                      {cardStyle.descriptionLines === 0 ? 'Off' : `${cardStyle.descriptionLines} lines`}
                    </span>
                  </span>
                  <div className='segmented' role='group' aria-label='Description length'>
                    {[0, 1, 2, 3, 4].map(lines => (
                      <button
                        key={lines}
                        type='button'
                        className='seg-btn'
                        aria-pressed={cardStyle.descriptionLines === lines}
                        onClick={() => {
                          patchCard({ descriptionLines: lines })
                          if (lines === 0 && surface === 'channel' && editMode === 'grid' && settings.showChannelDescriptions) {
                            updateFeedViewSettings({ showChannelDescriptions: false })
                          }
                        }}
                      >
                        {lines === 0 ? 'Off' : String(lines)}
                      </button>
                    ))}
                  </div>
                </div>

                <label className='field'>
                  <span className='field-head'>
                    <span>Row spacing</span>
                    <span className='field-val'>{cardStyle.rowGap} px</span>
                  </span>
                  <input
                    type='range'
                    aria-label='Row spacing'
                    min={4}
                    max={48}
                    step={2}
                    value={cardStyle.rowGap}
                    onInput={(event: TargetedEvent<HTMLInputElement>) =>
                      patchCard({ rowGap: Number(event.currentTarget.value) })}
                  />
                </label>

                <label className='field'>
                  <span className='field-head'>
                    <span>Rounded corners</span>
                    <span className='field-val'>{cardStyle.cornerRadius} px</span>
                  </span>
                  <input
                    type='range'
                    aria-label='Rounded corners'
                    min={0}
                    max={28}
                    step={2}
                    value={cardStyle.cornerRadius}
                    onInput={(event: TargetedEvent<HTMLInputElement>) =>
                      patchCard({ cornerRadius: Number(event.currentTarget.value) })}
                  />
                </label>

                <button type='button' className='small-btn' onClick={() => resetFeedCardStyle(editMode)}>
                  <RotateCcw size={15} strokeWidth={1.75} aria-hidden='true' />
                  Reset card style
                </button>
              </div>
            </>
          )
          : tab === 'filters'
          ? (
            <>
              <div className='section'>
                <h3 className='section-title'>Hide across YouTube</h3>
                <label className='check-row'>
                  <input
                    type='checkbox'
                    checked={hideShorts}
                    onChange={(event: TargetedEvent<HTMLInputElement>) =>
                      updateSettings({ hideShorts: event.currentTarget.checked })}
                  />
                  Shorts
                </label>
                <label className='check-row'>
                  <input
                    type='checkbox'
                    checked={settings.hide.live}
                    onChange={(event: TargetedEvent<HTMLInputElement>) =>
                      updateFeedHide({ live: event.currentTarget.checked })}
                  />
                  Live streams
                </label>
                <label className='check-row'>
                  <input
                    type='checkbox'
                    checked={settings.hide.premieres}
                    onChange={(event: TargetedEvent<HTMLInputElement>) =>
                      updateFeedHide({ premieres: event.currentTarget.checked })}
                  />
                  Premieres
                </label>
                <label className='check-row'>
                  <input
                    type='checkbox'
                    checked={settings.hide.upcoming}
                    onChange={(event: TargetedEvent<HTMLInputElement>) =>
                      updateFeedHide({ upcoming: event.currentTarget.checked })}
                  />
                  Upcoming videos
                </label>
                <label className='check-row'>
                  <input
                    type='checkbox'
                    checked={settings.hide.pastStreams}
                    onChange={(event: TargetedEvent<HTMLInputElement>) =>
                      updateFeedHide({ pastStreams: event.currentTarget.checked })}
                  />
                  Past streams
                </label>
                <label className='check-row'>
                  <input
                    type='checkbox'
                    checked={settings.hide.watched}
                    onChange={(event: TargetedEvent<HTMLInputElement>) =>
                      updateFeedHide({ watched: event.currentTarget.checked })}
                  />
                  Watched videos
                </label>
                <label className='check-row'>
                  <input
                    type='checkbox'
                    checked={settings.hide.mostRelevant}
                    onChange={(event: TargetedEvent<HTMLInputElement>) =>
                      updateFeedHide({ mostRelevant: event.currentTarget.checked })}
                  />
                  "Most relevant" shelf
                </label>
              </div>

              <div className='section'>
                <h3 className='section-title'>Duration & upload date</h3>
                <label className='field'>
                  <span className='field-head'><span>Duration</span></span>
                  <select
                    className='select'
                    aria-label='Duration filter'
                    value={settings.durationFilter.preset}
                    onChange={(event: TargetedEvent<HTMLSelectElement>) =>
                      updateFeedViewSettings({
                        durationFilter: {
                          ...settings.durationFilter,
                          preset: event.currentTarget.value as DurationPreset,
                        },
                      })}
                  >
                    <option value='any'>Any duration</option>
                    <option value='under4'>Under 4 minutes</option>
                    <option value='4to20'>4 to 20 minutes</option>
                    <option value='over20'>Over 20 minutes</option>
                    <option value='custom'>Custom range</option>
                  </select>
                </label>

                {settings.durationFilter.preset === 'custom'
                  ? (
                    <div className='row-inline'>
                      <input
                        type='number'
                        min={0}
                        className='num-input'
                        aria-label='Min minutes'
                        placeholder='Min (min)'
                        value={settings.durationFilter.minMinutes ?? ''}
                        onInput={(event: TargetedEvent<HTMLInputElement>) =>
                          updateFeedViewSettings({
                            durationFilter: {
                              ...settings.durationFilter,
                              minMinutes: parseOptionalNum(event.currentTarget.value),
                            },
                          })}
                        onBlur={normalizeDurationOrder}
                      />
                      <input
                        type='number'
                        min={0}
                        className='num-input'
                        aria-label='Max minutes'
                        placeholder='Max (min)'
                        value={settings.durationFilter.maxMinutes ?? ''}
                        onInput={(event: TargetedEvent<HTMLInputElement>) =>
                          updateFeedViewSettings({
                            durationFilter: {
                              ...settings.durationFilter,
                              maxMinutes: parseOptionalNum(event.currentTarget.value),
                            },
                          })}
                        onBlur={normalizeDurationOrder}
                      />
                    </div>
                  )
                  : undefined}

                <label className='field'>
                  <span className='field-head'><span>Upload date</span></span>
                  <select
                    className='select'
                    aria-label='Upload date filter'
                    value={settings.uploadDate}
                    onChange={(event: TargetedEvent<HTMLSelectElement>) =>
                      updateFeedViewSettings({ uploadDate: event.currentTarget.value as UploadDatePreset })}
                  >
                    <option value='any'>Any time</option>
                    <option value='today'>Today</option>
                    <option value='week'>This week</option>
                    <option value='month'>This month</option>
                    <option value='year'>This year</option>
                  </select>
                </label>
              </div>

              <div className='section'>
                <h3 className='section-title'>Custom filter buttons</h3>
                <form className='section' onSubmit={submitCustomFilter}>
                  <input
                    type='text'
                    className='text-input'
                    aria-label='Custom filter name'
                    placeholder='Button name'
                    value={cfName}
                    onInput={(event: TargetedEvent<HTMLInputElement>) => setCfName(event.currentTarget.value)}
                  />
                  <input
                    type='text'
                    className='text-input'
                    aria-label='Custom filter keyword'
                    placeholder='Keyword (optional)'
                    value={cfKeyword}
                    onInput={(event: TargetedEvent<HTMLInputElement>) => setCfKeyword(event.currentTarget.value)}
                  />
                  <div className='row-inline'>
                    <select
                      className='select'
                      aria-label='Custom filter duration'
                      value={cfDuration}
                      onChange={(event: TargetedEvent<HTMLSelectElement>) =>
                        setCfDuration(event.currentTarget.value as DurationPreset)}
                    >
                      <option value='any'>Any length</option>
                      <option value='under4'>Under 4m</option>
                      <option value='4to20'>4 to 20m</option>
                      <option value='over20'>Over 20m</option>
                      <option value='custom'>Custom range</option>
                    </select>
                    <select
                      className='select'
                      aria-label='Custom filter upload date'
                      value={cfDate}
                      onChange={(event: TargetedEvent<HTMLSelectElement>) =>
                        setCfDate(event.currentTarget.value as UploadDatePreset)}
                    >
                      <option value='any'>Any date</option>
                      <option value='today'>Today</option>
                      <option value='week'>This week</option>
                      <option value='month'>This month</option>
                      <option value='year'>This year</option>
                    </select>
                  </div>
                  {cfDuration === 'custom'
                    ? (
                      <div className='row-inline'>
                        <input
                          type='number'
                          min={0}
                          className='num-input'
                          aria-label='Custom filter min minutes'
                          placeholder='Min (min)'
                          value={cfMinMinutes ?? ''}
                          onInput={(event: TargetedEvent<HTMLInputElement>) =>
                            setCfMinMinutes(parseOptionalNum(event.currentTarget.value))}
                        />
                        <input
                          type='number'
                          min={0}
                          className='num-input'
                          aria-label='Custom filter max minutes'
                          placeholder='Max (min)'
                          value={cfMaxMinutes ?? ''}
                          onInput={(event: TargetedEvent<HTMLInputElement>) =>
                            setCfMaxMinutes(parseOptionalNum(event.currentTarget.value))}
                        />
                      </div>
                    )
                    : undefined}
                  <div className='tag-list'>
                    <label className='check-row'>
                      <input
                        type='checkbox'
                        checked={cfHideShorts}
                        onChange={(event: TargetedEvent<HTMLInputElement>) =>
                          setCfHideShorts(event.currentTarget.checked)}
                      />
                      No Shorts
                    </label>
                    <label className='check-row'>
                      <input
                        type='checkbox'
                        checked={cfHideLive}
                        onChange={(event: TargetedEvent<HTMLInputElement>) =>
                          setCfHideLive(event.currentTarget.checked)}
                      />
                      No Live
                    </label>
                    <label className='check-row'>
                      <input
                        type='checkbox'
                        checked={cfHideWatched}
                        onChange={(event: TargetedEvent<HTMLInputElement>) =>
                          setCfHideWatched(event.currentTarget.checked)}
                      />
                      Unwatched
                    </label>
                    <label className='check-row'>
                      <input
                        type='checkbox'
                        checked={cfHidePremieres}
                        onChange={(event: TargetedEvent<HTMLInputElement>) =>
                          setCfHidePremieres(event.currentTarget.checked)}
                      />
                      No Premieres
                    </label>
                    <label className='check-row'>
                      <input
                        type='checkbox'
                        checked={cfHideUpcoming}
                        onChange={(event: TargetedEvent<HTMLInputElement>) =>
                          setCfHideUpcoming(event.currentTarget.checked)}
                      />
                      No Upcoming
                    </label>
                    <label className='check-row'>
                      <input
                        type='checkbox'
                        checked={cfHidePastStreams}
                        onChange={(event: TargetedEvent<HTMLInputElement>) =>
                          setCfHidePastStreams(event.currentTarget.checked)}
                      />
                      No Past streams
                    </label>
                  </div>
                  <button type='submit' className='small-btn primary'>
                    Add filter button
                  </button>
                </form>

                {settings.customFilters.length > 0
                  ? (
                    <div className='custom-list'>
                      {settings.customFilters.map((filter) => {
                        const active = settings.activeCustomFilterIds.includes(filter.id)
                        return (
                          <div key={filter.id} className='custom-item'>
                            <button
                              type='button'
                              className='seg-btn'
                              aria-pressed={active}
                              onClick={() => toggleCustomFeedFilter(filter.id)}
                            >
                              {filter.name}
                            </button>
                            <button
                              type='button'
                              className='icon-btn'
                              aria-label={`Delete filter ${filter.name}`}
                              onClick={() => removeCustomFeedFilter(filter.id)}
                            >
                              <Trash2 size={15} strokeWidth={1.75} aria-hidden='true' />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )
                  : undefined}
              </div>
            </>
          )
          : (
            <>
              <div className='section'>
                <h3 className='section-title'>Blocked keywords</h3>
                <form className='row-inline' onSubmit={submitKeyword}>
                  <input
                    type='text'
                    className='text-input'
                    aria-label='Blocked keyword'
                    placeholder='Add keyword'
                    value={keywordDraft}
                    onInput={(event: TargetedEvent<HTMLInputElement>) => setKeywordDraft(event.currentTarget.value)}
                  />
                  <button type='submit' className='small-btn primary'>Block</button>
                </form>
                {settings.blockedKeywords.length > 0
                  ? (
                    <div className='tag-list'>
                      {settings.blockedKeywords.map(keyword => (
                        <span key={keyword} className='tag'>
                          {keyword}
                          <button
                            type='button'
                            aria-label={`Remove keyword ${keyword}`}
                            onClick={() => removeBlockedKeyword(keyword)}
                          >
                            <X size={13} strokeWidth={2} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )
                  : <p className='muted'>No blocked keywords.</p>}
              </div>

              <div className='section'>
                <h3 className='section-title'>Blocked channels</h3>
                <form className='row-inline' onSubmit={submitChannel}>
                  <input
                    type='text'
                    className='text-input'
                    aria-label='Blocked channel'
                    placeholder='Channel name, @handle, or ID'
                    value={channelDraft}
                    onInput={(event: TargetedEvent<HTMLInputElement>) => setChannelDraft(event.currentTarget.value)}
                  />
                  <button type='submit' className='small-btn primary'>Block</button>
                </form>
                {settings.blockedChannels.length > 0
                  ? (
                    <div className='tag-list'>
                      {settings.blockedChannels.map(channel => (
                        <span key={channel} className='tag'>
                          {channel}
                          <button
                            type='button'
                            aria-label={`Remove channel ${channel}`}
                            onClick={() => removeBlockedChannel(channel)}
                          >
                            <X size={13} strokeWidth={2} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )
                  : <p className='muted'>No blocked channels.</p>}
              </div>
            </>
          )}
      </div>
    </aside>
  )
}
