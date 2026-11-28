import type { AmbientArea, AmbientFillMode } from '../player/ambient-options'

import { css } from '@emotion/react'

import {
  AMBIENT_AREA_OPTIONS,
  AMBIENT_FILL_MODE_OPTIONS,
  coerceAmbientArea,
  coerceAmbientFillMode,
  coerceAmbientSpread,
  computeAmbientGlowVars,
} from '../player/ambient-options'

const PREVIEW_SCALE = 0.22

const previewCss = css`
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  max-width: 42rem;
  padding: 1.2rem;
  border: 1px solid var(--border-subtle);
  border-radius: 1rem;
  background: var(--bg-subtle);

  .preview-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .preview-title {
    font-size: 1.25rem;
    font-weight: 500;
    color: var(--text-primary);
  }

  .preview-summary {
    font-size: 1.2rem;
    font-variant-numeric: tabular-nums;
    color: var(--text-secondary);
  }

  .viewport {
    position: relative;
    overflow: hidden;
    height: 17.5rem;
    border: 1px solid var(--border-subtle);
    border-radius: 0.8rem;
    background: #0d0f14;
    color: rgba(255, 255, 255, 0.85);
  }

  .mini-header,
  .mini-sidebar {
    position: relative;
    z-index: 2;
    background: rgba(15, 17, 23, 0.72);
    border-color: rgba(255, 255, 255, 0.08);
  }

  .mini-header {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    height: 2.2rem;
    padding: 0 0.8rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .mini-pill {
    height: 0.9rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.16);
  }

  .mini-pill.short {
    width: 3.4rem;
  }

  .mini-pill.search {
    width: 9rem;
    margin-left: auto;
    margin-right: auto;
  }

  .mini-body {
    position: relative;
    display: grid;
    grid-template-columns: 3.2rem minmax(0, 1fr);
    height: calc(100% - 2.2rem);
  }

  .mini-sidebar {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.8rem 0.6rem;
    border-right: 1px solid rgba(255, 255, 255, 0.08);
  }

  .mini-rail-bar {
    height: 0.6rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.14);
  }

  .mini-content {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 5.8rem;
    gap: 0.9rem;
    padding: 1.4rem 1.8rem 1.2rem;
    align-items: start;
  }

  .mini-stage-wrap {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }

  .mini-player-box {
    position: relative;
    aspect-ratio: 16 / 9;
    border-radius: 0.5rem;
  }

  .mini-glow {
    pointer-events: none;
    position: absolute;
    border-radius: 0.8rem;
  }

  .mini-frame {
    position: relative;
    z-index: 2;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.16);
    background:
      radial-gradient(circle at 22% 35%, rgba(45, 212, 191, 0.9), transparent 54%),
      radial-gradient(circle at 78% 28%, rgba(251, 146, 60, 0.88), transparent 52%),
      radial-gradient(circle at 74% 82%, rgba(236, 72, 153, 0.88), transparent 56%),
      linear-gradient(135deg, #103b4d 0%, #3d2148 52%, #592235 100%);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
  }

  .mini-scrubber {
    position: absolute;
    left: 0.6rem;
    right: 0.6rem;
    bottom: 0.5rem;
    height: 0.25rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.28);
    overflow: hidden;
  }

  .mini-scrubber::before {
    content: '';
    display: block;
    width: 44%;
    height: 100%;
    background: #ff4e45;
  }

  .mini-meta {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }

  .mini-line {
    height: 0.65rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.15);
  }

  .mini-line.title {
    width: 78%;
    height: 0.8rem;
    background: rgba(255, 255, 255, 0.24);
  }

  .mini-line.sub {
    width: 48%;
  }

  .mini-upnext {
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }

  .mini-rec {
    height: 2.3rem;
    border-radius: 0.35rem;
    background: rgba(255, 255, 255, 0.1);
  }

  @media (max-width: 520px) {
    .viewport {
      height: 15rem;
    }

    .mini-content {
      grid-template-columns: minmax(0, 1fr);
      padding: 1.2rem;
    }

    .mini-upnext {
      display: none;
    }
  }
`

const scaleCssRem = (value: string, factor: number): string => {
  const match = /^(-?\d+(?:\.\d+)?)rem$/.exec(value)
  if (!match) return value
  return `${(Number(match[1]) * factor).toFixed(2)}rem`
}

const scaleBlurFilter = (filter: string, factor: number): string =>
  filter.replace(/blur\((-?\d+(?:\.\d+)?)rem\)/, (_, num: string) =>
    `blur(${Math.max(0.7, Number(num) * factor).toFixed(2)}rem)`,
  )

const fillBackgroundForMode = (mode: AmbientFillMode): string => {
  if (mode === 'average') {
    return 'radial-gradient(circle at 50% 50%, rgba(164, 92, 146, 0.88), rgba(102, 74, 134, 0.86))'
  }
  if (mode === 'stretch') {
    return 'linear-gradient(135deg, rgba(45, 212, 191, 0.78) 0%, rgba(124, 58, 237, 0.74) 48%, rgba(249, 115, 22, 0.8) 100%)'
  }
  if (mode === 'vivid') {
    return `
      radial-gradient(circle at 14% 48%, rgba(34, 211, 238, 0.98), transparent 48%),
      radial-gradient(circle at 86% 36%, rgba(251, 146, 60, 0.98), transparent 48%),
      radial-gradient(circle at 68% 88%, rgba(244, 63, 94, 0.96), transparent 52%),
      linear-gradient(135deg, rgba(20, 184, 166, 0.82), rgba(190, 24, 93, 0.82))
    `
  }
  return `
    radial-gradient(circle at 10% 50%, rgba(45, 212, 191, 0.92), transparent 46%),
    radial-gradient(circle at 90% 35%, rgba(251, 146, 60, 0.92), transparent 46%),
    radial-gradient(circle at 70% 92%, rgba(236, 72, 153, 0.9), transparent 50%)
  `
}

/** Reactive miniature Watch page preview reflecting the current Ambient mode settings. */
export const AmbientPreview = (
  { area, spread, fillMode }: {
    area: AmbientArea
    spread: number
    fillMode: AmbientFillMode
  },
) => {
  const safeArea = coerceAmbientArea(area)
  const safeSpread = coerceAmbientSpread(spread)
  const safeFill = coerceAmbientFillMode(fillMode)
  const vars = computeAmbientGlowVars(safeArea, safeSpread, safeFill, 'watch')

  const areaLabel = AMBIENT_AREA_OPTIONS.find(option => option.value === safeArea)?.label ?? safeArea
  const fillLabel = AMBIENT_FILL_MODE_OPTIONS.find(option => option.value === safeFill)?.label ?? safeFill

  const isFullPage = safeArea === 'full-page'
  const glowStyle = {
    top: isFullPage ? '0px' : scaleCssRem(vars.top, PREVIEW_SCALE),
    right: isFullPage ? '0px' : scaleCssRem(vars.right, PREVIEW_SCALE),
    bottom: isFullPage ? '0px' : scaleCssRem(vars.bottom, PREVIEW_SCALE),
    left: isFullPage ? '0px' : scaleCssRem(vars.left, PREVIEW_SCALE),
    maskImage: vars.mask === 'none' ? undefined : vars.mask,
    WebkitMaskImage: vars.mask === 'none' ? undefined : vars.mask,
    filter: scaleBlurFilter(vars.filter, PREVIEW_SCALE),
    opacity: String(Math.min(1, 0.68 * vars.opacityScale)),
    background: fillBackgroundForMode(safeFill),
  }

  const glowElement = (
    <div
      className='mini-glow'
      aria-hidden='true'
      data-ambient-preview-glow={isFullPage ? 'full-page' : 'stage'}
      style={glowStyle}
    />
  )

  return (
    <div
      css={previewCss}
      data-ambient-preview='true'
      data-ambient-area={safeArea}
      data-ambient-spread={String(safeSpread)}
      data-ambient-fill-mode={safeFill}
    >
      <div className='preview-head'>
        <span className='preview-title'>Live preview</span>
        <span className='preview-summary'>{`${areaLabel} / ${safeSpread}% / ${fillLabel}`}</span>
      </div>
      <div className='viewport'>
        {isFullPage ? glowElement : undefined}
        <div className='mini-header'>
          <span className='mini-pill short' />
          <span className='mini-pill search' />
        </div>
        <div className='mini-body'>
          <div className='mini-sidebar'>
            <span className='mini-rail-bar' />
            <span className='mini-rail-bar' />
            <span className='mini-rail-bar' />
          </div>
          <div className='mini-content'>
            <div className='mini-stage-wrap'>
              <div className='mini-player-box'>
                {isFullPage ? undefined : glowElement}
                <div className='mini-frame'>
                  <div className='mini-scrubber' />
                </div>
              </div>
              <div className='mini-meta'>
                <span className='mini-line title' />
                <span className='mini-line sub' />
              </div>
            </div>
            <div className='mini-upnext'>
              <div className='mini-rec' />
              <div className='mini-rec' />
              <div className='mini-rec' />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
