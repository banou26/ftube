import type { Settings } from '../settings'
import type { EmojiCategory, EmojiPickerSettings } from './emoji-picker-settings'

import { css } from '@emotion/react'
import { useState } from 'preact/hooks'

import { showUndoableToast } from '../undo'
import { EmojiPickerPanel } from './emoji-picker'
import {
  cloneDefaultEmojiPickerSettings,
  EMOJI_CATEGORIES,
  EMOJI_PICKER_COLUMNS,
  EMOJI_PICKER_HEIGHTS,
  EMOJI_PICKER_SIZES,
  SKIN_TONES,
} from './emoji-picker-settings'

const style = css`
  display: flex;
  flex-direction: column;
  gap: 2rem;

  .subhead {
    margin: 0 0 1rem;
    font-size: 1.45rem;
    font-weight: 500;
    color: var(--text-primary);
  }

  .preview-box {
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
    padding: 1.4rem;
    border-radius: 0.8rem;
    background: var(--bg-subtle);
    border: 1px solid var(--border);
  }

  .preview-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    min-height: 3.2rem;
    padding: 0.5rem 1rem;
    border: 1px solid var(--border-subtle);
    border-radius: 0.6rem;
    background: var(--bg-base);
  }

  .preview-picked {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    min-width: 0;
    flex: 1 1 auto;
  }

  .preview-label {
    font-size: 1.25rem;
    font-weight: 500;
    color: var(--text-secondary);
    flex: none;
  }

  .preview-value {
    font-size: 1.8rem;
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .preview-placeholder {
    font-size: 1.3rem;
    color: var(--text-secondary);
  }

  .preview-picker-wrap {
    width: min(44rem, 100%);
  }

  .clear-btn {
    height: 2.8rem;
    padding: 0 1rem;
    border: 1px solid var(--border-subtle);
    border-radius: 0.6rem;
    background: var(--bg-chip);
    color: var(--text-primary);
    font: inherit;
    font-size: 1.25rem;
    font-weight: 500;
    cursor: pointer;
    flex: none;
  }

  .clear-btn:hover {
    background: var(--bg-chip-hover);
  }

  .clear-btn:focus-visible {
    outline: 2px solid var(--accent-focus);
    outline-offset: 2px;
  }

  .tone-choice {
    display: inline-flex;
    align-items: center;
    gap: 0.7rem;
  }

  .swatch {
    width: 1.4rem;
    height: 1.4rem;
    border-radius: 0.35rem;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.25);
    flex: none;
  }

  .menu-list {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--border-subtle);
  }

  .menu-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.2rem;
    min-height: 4.4rem;
    padding: 0.6rem 0;
    border-bottom: 1px solid var(--border-subtle);
  }

  .menu-row-main {
    min-width: 0;
    font-size: 1.4rem;
    color: var(--text-primary);
  }

  .actions-row {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    padding-top: 0.4rem;
  }
`

const CATEGORY_LABELS: Record<EmojiCategory, string> = {
  Smileys: 'Smileys',
  Gestures: 'Gestures',
  Hearts: 'Hearts',
  Nature: 'Nature',
  Food: 'Food',
  Travel: 'Travel',
  Activities: 'Activities',
  Objects: 'Objects',
}

type BooleanSettingKey =
  | 'showSearch'
  | 'showSkinTone'
  | 'showCategories'
  | 'showSectionHeaders'
  | 'closeOnPick'

const BEHAVIOR_TOGGLES: readonly { key: BooleanSettingKey, label: string }[] = [
  { key: 'showSearch', label: 'Show search bar' },
  { key: 'showSkinTone', label: 'Show skin tone selector' },
  { key: 'showCategories', label: 'Show category bar' },
  { key: 'showSectionHeaders', label: 'Show section headings' },
  { key: 'closeOnPick', label: 'Close after picking an emoji' },
]

type Props = {
  settings: Settings
  onUpdate: (patch: Partial<Settings>) => void
}

/**
 * Settings panel tab for customizing emoji picker layout, skin tone default,
 * visible controls, and pick behavior alongside an interactive live preview.
 */
export const EmojiPickerCustomization = ({ settings, onUpdate }: Props) => {
  const picker = settings.emojiPicker
  const [sample, setSample] = useState('')

  const patchPicker = (patch: Partial<EmojiPickerSettings>) => {
    onUpdate({ emojiPicker: { ...picker, ...patch } })
  }

  const handleReset = () => {
    const previous = settings.emojiPicker
    onUpdate({ emojiPicker: cloneDefaultEmojiPickerSettings() })
    showUndoableToast('Emoji picker settings reset to default', {
      label: 'Reset emoji picker settings',
      undo: () => {
        onUpdate({ emojiPicker: previous })
      },
    })
  }

  return (
    <section css={style} aria-label='Emoji picker customization'>
      <div className='preview-box' aria-label='Emoji picker preview'>
        <div className='preview-bar'>
          <div className='preview-picked'>
            <span className='preview-label'>Selected</span>
            {sample
              ? <span className='preview-value' data-preview-picked='true'>{sample}</span>
              : <span className='preview-placeholder' data-preview-picked='true'>None</span>}
          </div>
          {sample
            ? (
              <button type='button' className='clear-btn' onClick={() => setSample('')}>
                Clear
              </button>
            )
            : undefined}
        </div>
        <div className='preview-picker-wrap'>
          <EmojiPickerPanel
            variant='inline'
            pickerSettings={picker}
            onPick={(emoji: string) => setSample(current => `${current}${emoji}`)}
          />
        </div>
      </div>

      <div>
        <h3 className='subhead'>Default skin tone</h3>
        <div className='choices' role='group' aria-label='Default skin tone'>
          {SKIN_TONES.map((tone) => {
            const active = picker.defaultSkinTone === tone.modifier
            return (
              <button
                type='button'
                key={tone.label}
                className={active ? 'choice tone-choice active' : 'choice tone-choice'}
                aria-label={tone.label}
                aria-pressed={active}
                onClick={() => patchPicker({ defaultSkinTone: tone.modifier })}
              >
                <span className='swatch' style={{ backgroundColor: tone.color }} aria-hidden='true' />
                <span>{tone.shortLabel}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <h3 className='subhead'>Emoji size</h3>
        <div className='choices' role='group' aria-label='Emoji size'>
          {EMOJI_PICKER_SIZES.map((option) => {
            const active = picker.emojiSize === option.value
            return (
              <button
                type='button'
                key={option.value}
                className={active ? 'choice active' : 'choice'}
                aria-pressed={active}
                onClick={() => patchPicker({ emojiSize: option.value })}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <h3 className='subhead'>Emojis per row</h3>
        <div className='choices' role='group' aria-label='Emojis per row'>
          {EMOJI_PICKER_COLUMNS.map((count) => {
            const active = picker.columns === count
            return (
              <button
                type='button'
                key={count}
                className={active ? 'choice active' : 'choice'}
                aria-pressed={active}
                onClick={() => patchPicker({ columns: count })}
              >
                {String(count)}
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <h3 className='subhead'>Picker height</h3>
        <div className='choices' role='group' aria-label='Picker height'>
          {EMOJI_PICKER_HEIGHTS.map((option) => {
            const active = picker.pickerHeight === option.value
            return (
              <button
                type='button'
                key={option.value}
                className={active ? 'choice active' : 'choice'}
                aria-pressed={active}
                onClick={() => patchPicker({ pickerHeight: option.value })}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <h3 className='subhead'>Default category</h3>
        <div className='choices' role='group' aria-label='Default category'>
          {EMOJI_CATEGORIES.map((category) => {
            const active = picker.defaultCategory === category
            return (
              <button
                type='button'
                key={category}
                className={active ? 'choice active' : 'choice'}
                aria-pressed={active}
                onClick={() => patchPicker({ defaultCategory: category })}
              >
                {CATEGORY_LABELS[category]}
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <h3 className='subhead'>Display and behavior</h3>
        <div className='menu-list' role='group' aria-label='Emoji picker display and behavior'>
          {BEHAVIOR_TOGGLES.map((item) => {
            const checked = picker[item.key]
            return (
              <div key={item.key} className='menu-row'>
                <div className='menu-row-main'>
                  <span>{item.label}</span>
                </div>
                <input
                  type='checkbox'
                  className='toggle'
                  aria-label={item.label}
                  checked={checked}
                  onChange={() => patchPicker({ [item.key]: !checked })}
                />
              </div>
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
