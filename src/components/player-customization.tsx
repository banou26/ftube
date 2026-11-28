import type { ComponentChildren, FunctionComponent } from 'preact'
import type { Settings } from '../settings'
import type {
  PlayerBarControlId,
  PlayerBarSide,
  PlayerSettingsMenuItemId,
} from '../player/control-layout'

import { css } from '@emotion/react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  AudioLines,
  Bookmark,
  Captions,
  Clock,
  Gauge,
  GripVertical,
  Languages,
  Maximize,
  MessageSquareQuote,
  Moon,
  PictureInPicture2,
  Play,
  RectangleHorizontal,
  Settings as SettingsIcon,
  SkipForward,
  SlidersHorizontal,
  Tv,
  Volume2,
} from 'lucide-react'
import { useRef, useState } from 'preact/hooks'

import {
  isBarControlVisible,
  moveBarControlByStep,
  moveBarControlToSide,
  PLAYER_BAR_CONTROL_META,
  PLAYER_SETTINGS_MENU_ITEMS,
  toggleBarControlVisibility,
  toggleSettingsMenuItem,
} from '../player/control-layout'
import { resetPlayerCustomization, updateSettings } from '../settings'
import { showUndoableToast } from '../undo'

type IconComp = FunctionComponent<{ size?: number, strokeWidth?: number, className?: string }>

const CONTROL_ICONS: Record<PlayerBarControlId, IconComp> = {
  play: Play,
  next: SkipForward,
  volume: Volume2,
  time: Clock,
  chapter: Bookmark,
  autoplay: RectangleHorizontal,
  captions: Captions,
  settings: SettingsIcon,
  pip: PictureInPicture2,
  theater: RectangleHorizontal,
  fullscreen: Maximize,
}

const MENU_ICONS: Record<PlayerSettingsMenuItemId, IconComp> = {
  stableVolume: AudioLines,
  ambientMode: Tv,
  annotations: MessageSquareQuote,
  pip: PictureInPicture2,
  subtitles: Captions,
  audioTrack: Languages,
  sleepTimer: Moon,
  playbackSpeed: Gauge,
  quality: SlidersHorizontal,
}

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
    gap: 1rem;
    padding: 1.2rem;
    border-radius: 0.8rem;
    background: #141414;
    border: 1px solid var(--border);
    color: #ffffff;
  }

  .preview-rail {
    position: relative;
    height: 0.4rem;
    width: 100%;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.24);
  }

  .preview-rail-fill {
    height: 100%;
    width: 38%;
    border-radius: 999px;
    background: var(--brand-red, #ff0033);
  }

  .preview-bar {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    min-height: 3.4rem;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .preview-bar::-webkit-scrollbar {
    display: none;
  }

  .preview-left {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-width: 0;
  }

  .preview-spacer {
    flex: 1 1 0.8rem;
  }

  .preview-right {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0 0.6rem;
    height: 3rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.12);
    flex: none;
  }

  .preview-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    height: 3rem;
    padding: 0 0.8rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.12);
    font-size: 1.15rem;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    flex: none;
  }

  .preview-right .preview-pill {
    height: 2.6rem;
    padding: 0 0.5rem;
    background: transparent;
  }

  .preview-switch {
    display: inline-flex;
    align-items: center;
    width: 2.2rem;
    height: 1.3rem;
    padding: 0.15rem;
    border-radius: 999px;
    background: #ffffff;
  }

  .preview-switch-dot {
    width: 1rem;
    height: 1rem;
    margin-left: auto;
    border-radius: 50%;
    background: #141414;
  }

  .columns {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1.2rem;
  }

  .side-column {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-width: 0;
    padding: 1rem;
    border-radius: 0.8rem;
    border: 1px solid var(--border);
    background: var(--bg-subtle);
  }

  .side-column.drop-active {
    border-color: var(--accent);
  }

  .side-title {
    margin: 0 0 0.4rem;
    font-size: 1.35rem;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .control-list {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .control-row {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    min-height: 4rem;
    padding: 0.6rem 0.8rem;
    border-radius: 0.6rem;
    border: 1px solid var(--border-subtle);
    background: var(--bg-base);
    color: var(--text-primary);
    cursor: grab;
  }

  .control-row.dragging {
    opacity: 0.5;
  }

  .control-row.drop-before {
    box-shadow: inset 0 2px 0 var(--accent);
  }

  .control-row.drop-after {
    box-shadow: inset 0 -2px 0 var(--accent);
  }

  .control-row.dimmed .row-main {
    opacity: 0.55;
  }

  .grip {
    flex: none;
    color: var(--text-secondary);
  }

  .row-main {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.8rem;
  }

  .row-icon {
    flex: none;
    color: var(--text-secondary);
  }

  .row-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 1.35rem;
    color: var(--text-primary);
  }

  .row-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    flex: none;
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.8rem;
    height: 2.8rem;
    padding: 0;
    border: 1px solid var(--border-subtle);
    border-radius: 0.5rem;
    background: var(--bg-chip);
    color: var(--text-primary);
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .icon-btn:hover:not(:disabled) {
    background: var(--bg-chip-hover);
  }

  .icon-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .icon-btn:focus-visible {
    outline: 2px solid var(--accent-focus);
    outline-offset: 1px;
  }

  .empty-dropzone {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 4.8rem;
    border: 1px dashed var(--border-strong);
    border-radius: 0.6rem;
    font-size: 1.3rem;
    color: var(--text-secondary);
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
    display: flex;
    align-items: center;
    gap: 1rem;
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

  @media (max-width: 680px) {
    .columns {
      grid-template-columns: minmax(0, 1fr);
    }
  }
`

const renderPreviewControl = (id: PlayerBarControlId): ComponentChildren => {
  const Icon = CONTROL_ICONS[id]
  if (id === 'time') {
    return <span key={id} className='preview-pill'>02:14 / 08:30</span>
  }
  if (id === 'chapter') {
    return <span key={id} className='preview-pill'>Intro</span>
  }
  if (id === 'autoplay') {
    return (
      <span key={id} className='preview-pill'>
        <span className='preview-switch'><span className='preview-switch-dot' /></span>
      </span>
    )
  }
  return (
    <span key={id} className='preview-pill' aria-label={PLAYER_BAR_CONTROL_META[id].label}>
      <Icon size={14} strokeWidth={1.8} aria-hidden='true' />
    </span>
  )
}

type DropTarget = {
  side: PlayerBarSide
  index: number
  overId?: PlayerBarControlId
  position?: 'before' | 'after'
}

type Props = {
  settings: Settings
  onUpdate: (patch: Partial<Settings>) => void
}

/**
 * Settings panel tab for choosing which controls appear in the main player bar, reordering them
 * across left and right groups, and choosing which entries appear in the player settings menu.
 */
export const PlayerCustomization = ({ settings, onUpdate }: Props) => {
  const layout = settings.playerBarLayout
  const hiddenMenu = new Set<PlayerSettingsMenuItemId>(settings.playerMenuHidden)
  const draggingRef = useRef<PlayerBarControlId | null>(null)
  const [draggingId, setDraggingId] = useState<PlayerBarControlId | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)

  const readDraggedId = (event: DragEvent): PlayerBarControlId | null => {
    if (draggingRef.current) return draggingRef.current
    const transferred = event.dataTransfer?.getData('text/plain')
    if (transferred && Object.hasOwn(PLAYER_BAR_CONTROL_META, transferred)) {
      return transferred as PlayerBarControlId
    }
    return null
  }

  const clearDrag = () => {
    draggingRef.current = null
    setDraggingId(null)
    setDropTarget(null)
  }

  const commitDrop = (event: DragEvent, side: PlayerBarSide, index: number) => {
    event.preventDefault()
    event.stopPropagation()
    const dragged = readDraggedId(event)
    clearDrag()
    if (!dragged) return
    onUpdate({ playerBarLayout: moveBarControlToSide(layout, dragged, side, index) })
  }

  const leftVisible = layout.left.filter(id => isBarControlVisible(layout, id))
  const rightVisible = layout.right.filter(id => isBarControlVisible(layout, id))

  const handleReset = () => {
    const previous = {
      playerBarLayout: settings.playerBarLayout,
      playerMenuHidden: settings.playerMenuHidden,
    }
    resetPlayerCustomization()
    showUndoableToast('Player customization reset to default', {
      label: 'Reset player customization',
      undo: () => {
        updateSettings(previous)
      },
    })
  }

  return (
    <section css={style} aria-label='Player customization'>
      <div className='preview-box' aria-label='Player bar preview'>
        <div className='preview-rail' aria-hidden='true'>
          <div className='preview-rail-fill' />
        </div>
        <div className='preview-bar'>
          <div className='preview-left' data-preview-side='left'>
            {leftVisible.map(renderPreviewControl)}
          </div>
          <span className='preview-spacer' />
          {rightVisible.length > 0
            ? (
              <div className='preview-right' data-preview-side='right'>
                {rightVisible.map(renderPreviewControl)}
              </div>
            )
            : undefined}
        </div>
      </div>

      <div>
        <h3 className='subhead'>Player bar controls</h3>
        <div className='columns'>
          {(['left', 'right'] as const).map((side) => {
            const list = layout[side]
            const otherSide: PlayerBarSide = side === 'left' ? 'right' : 'left'
            const sideLabel = side === 'left' ? 'Left side' : 'Right side'
            const sideActive = dropTarget?.side === side && !dropTarget.overId
            return (
              <div
                key={side}
                className={sideActive ? 'side-column drop-active' : 'side-column'}
                data-bar-side={side}
                role='group'
                aria-label={`${sideLabel} player controls`}
                onDragEnter={(event: DragEvent) => {
                  if (!readDraggedId(event)) return
                  event.preventDefault()
                }}
                onDragOver={(event: DragEvent) => {
                  if (!readDraggedId(event)) return
                  event.preventDefault()
                  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
                  setDropTarget({ side, index: list.length })
                }}
                onDrop={(event: DragEvent) => commitDrop(event, side, list.length)}
              >
                <h4 className='side-title'>{sideLabel}</h4>
                <div className='control-list'>
                  {list.length === 0
                    ? <div className='empty-dropzone'>No controls on this side</div>
                    : list.map((id, index) => {
                      const meta = PLAYER_BAR_CONTROL_META[id]
                      const Icon = CONTROL_ICONS[id]
                      const visible = isBarControlVisible(layout, id)
                      const isBefore = dropTarget?.side === side && dropTarget.overId === id && dropTarget.position === 'before'
                      const isAfter = dropTarget?.side === side && dropTarget.overId === id && dropTarget.position === 'after'
                      const rowClass = [
                        'control-row',
                        draggingId === id ? 'dragging' : '',
                        isBefore ? 'drop-before' : '',
                        isAfter ? 'drop-after' : '',
                        !visible ? 'dimmed' : '',
                      ].filter(Boolean).join(' ')
                      return (
                        <div
                          key={id}
                          className={rowClass}
                          data-bar-control-row={id}
                          draggable
                          onDragStart={(event: DragEvent) => {
                            draggingRef.current = id
                            setDraggingId(id)
                            if (event.dataTransfer) {
                              event.dataTransfer.effectAllowed = 'move'
                              event.dataTransfer.setData('text/plain', id)
                            }
                          }}
                          onDragOver={(event: DragEvent) => {
                            if (!readDraggedId(event)) return
                            event.preventDefault()
                            event.stopPropagation()
                            const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
                            const before = event.clientY < box.top + box.height / 2
                            setDropTarget({
                              side,
                              index: before ? index : index + 1,
                              overId: id,
                              position: before ? 'before' : 'after',
                            })
                          }}
                          onDrop={(event: DragEvent) => {
                            const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
                            const before = event.clientY < box.top + box.height / 2
                            commitDrop(event, side, before ? index : index + 1)
                          }}
                          onDragEnd={clearDrag}
                        >
                          <GripVertical size={15} strokeWidth={1.8} className='grip' aria-hidden='true' />
                          <input
                            type='checkbox'
                            className='toggle'
                            aria-label={`Show ${meta.label} in player bar`}
                            checked={visible}
                            onChange={() => onUpdate({ playerBarLayout: toggleBarControlVisibility(layout, id) })}
                          />
                          <div className='row-main'>
                            <Icon size={16} strokeWidth={1.8} className='row-icon' aria-hidden='true' />
                            <span className='row-label'>{meta.label}</span>
                          </div>
                          <div className='row-actions'>
                            <button
                              type='button'
                              className='icon-btn'
                              aria-label={`Move ${meta.label} earlier`}
                              disabled={index === 0}
                              onClick={() => onUpdate({ playerBarLayout: moveBarControlByStep(layout, id, -1) })}
                            >
                              <ArrowUp size={14} strokeWidth={2} aria-hidden='true' />
                            </button>
                            <button
                              type='button'
                              className='icon-btn'
                              aria-label={`Move ${meta.label} later`}
                              disabled={index === list.length - 1}
                              onClick={() => onUpdate({ playerBarLayout: moveBarControlByStep(layout, id, 1) })}
                            >
                              <ArrowDown size={14} strokeWidth={2} aria-hidden='true' />
                            </button>
                            <button
                              type='button'
                              className='icon-btn'
                              aria-label={`Move ${meta.label} to ${otherSide} side`}
                              onClick={() => onUpdate({ playerBarLayout: moveBarControlToSide(layout, id, otherSide) })}
                            >
                              {side === 'left'
                                ? <ArrowRight size={14} strokeWidth={2} aria-hidden='true' />
                                : <ArrowLeft size={14} strokeWidth={2} aria-hidden='true' />}
                            </button>
                          </div>
                        </div>
                      )
                    })}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div>
        <h3 className='subhead'>Player settings menu</h3>
        <div className='menu-list' role='group' aria-label='Player settings menu items'>
          {PLAYER_SETTINGS_MENU_ITEMS.map((item) => {
            const Icon = MENU_ICONS[item.id]
            const checked = !hiddenMenu.has(item.id)
            return (
              <div key={item.id} className='menu-row' data-menu-item-row={item.id}>
                <div className='menu-row-main'>
                  <Icon size={18} strokeWidth={1.6} className='row-icon' aria-hidden='true' />
                  <span>{item.label}</span>
                </div>
                <input
                  type='checkbox'
                  className='toggle'
                  aria-label={`Show ${item.label} in settings menu`}
                  checked={checked}
                  onChange={() => onUpdate({ playerMenuHidden: toggleSettingsMenuItem(settings.playerMenuHidden, item.id) })}
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
