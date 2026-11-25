import type { Page } from '@playwright/test'

import { expect } from './test'

/** Pauses inside a cue of the captions on screen, so the cue stays drawn. */
export const holdOnCue = (page: Page) => expect.poll(() => page.locator('video').evaluate((element) => {
  const video = element as HTMLVideoElement
  const cue = [...video.textTracks].find(track => track.mode === 'showing')?.cues?.[3]
  if (!cue) return false
  video.pause()
  video.currentTime = (cue.startTime + cue.endTime) / 2
  return true
}), { timeout: 60_000 }).toBe(true)

/**
 * Reads the drawn cue from the player's caption overlay: its size against the overlay's base font size,
 * that base size, and its computed look.
 */
export const cueReader = async (page: Page) => async () => page.evaluate(() => {
  const overlay = document.querySelector('[data-caption-overlay]')
  const cue = document.querySelector('[data-caption-cue]')
  if (!overlay || !cue) return undefined
  const cueStyle = getComputedStyle(cue)
  const base = getComputedStyle(overlay)
  return {
    size: Math.round(parseFloat(cueStyle.fontSize) / parseFloat(base.fontSize) * 100),
    visibility: cueStyle.visibility,
    base: parseFloat(base.fontSize),
    color: cueStyle.color,
    background: cueStyle.backgroundColor,
    shadow: cueStyle.textShadow,
    family: cueStyle.fontFamily,
  }
})
