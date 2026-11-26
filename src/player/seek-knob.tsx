import type { HTMLAttributes } from 'preact'
import type { SeekHandle } from '../theme/seek-handle'

import { css } from '@emotion/react'
import { useEffect, useState } from 'preact/hooks'

type IconModule = typeof import('../theme/seek-icons')

let cachedModule: IconModule | undefined
let pendingLoad: Promise<IconModule> | undefined

const loadIconModule = (): Promise<IconModule> => {
  if (cachedModule) return Promise.resolve(cachedModule)
  if (!pendingLoad) {
    pendingLoad = import('../theme/seek-icons').then((mod) => {
      cachedModule = mod
      return mod
    })
  }
  return pendingLoad
}

const handleStyle = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  user-select: none;

  &[data-seek-handle='default'] {
    width: 1.2rem;
    height: 1.2rem;
    border-radius: 50%;
    background: var(--brand-red);
  }

  &[data-seek-handle='emoji'] {
    font-size: 1.8rem;
    line-height: 1;
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.75));
  }

  &[data-seek-handle='icon'] {
    color: var(--brand-red);
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.85)) drop-shadow(0 0 1px rgba(0, 0, 0, 0.9));
  }
`

type Props = {
  handle: SeekHandle
  className?: string
  style?: HTMLAttributes<HTMLSpanElement>['style']
  size?: number
}

/** Renders the configured seek scrubber handle (default red dot, custom emoji, or Lucide icon). */
export const SeekKnob = ({ handle, className = 'knob', style, size = 16 }: Props) => {
  const [icons, setIcons] = useState<IconModule | undefined>(() => cachedModule)

  useEffect(() => {
    if (handle.kind !== 'icon' || icons) return
    let cancelled = false
    void loadIconModule().then((mod) => {
      if (!cancelled) setIcons(mod)
    })
    return () => {
      cancelled = true
    }
  }, [handle.kind, icons])

  if (handle.kind === 'emoji') {
    return (
      <span
        className={className}
        css={handleStyle}
        data-seek-handle='emoji'
        style={style}
        aria-hidden='true'
      >
        {handle.value}
      </span>
    )
  }

  if (handle.kind === 'icon') {
    const Icon = icons?.SEEK_ICON_COMPONENTS[handle.value]
    return (
      <span
        className={className}
        css={handleStyle}
        data-seek-handle='icon'
        style={style}
        aria-hidden='true'
      >
        {Icon ? <Icon size={size} strokeWidth={2.2} aria-hidden /> : undefined}
      </span>
    )
  }

  return (
    <span
      className={className}
      css={handleStyle}
      data-seek-handle='default'
      style={style}
      aria-hidden='true'
    />
  )
}
