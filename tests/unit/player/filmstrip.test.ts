import type { Storyboard } from '../../../src/frame/storyboard'

import { describe, expect, it } from 'vite-plus/test'

import {
  FILMSTRIP_PULL_UP_PX,
  buildFilmstripWindow,
  filmstripTimeDelta,
} from '../../../src/player/filmstrip'

const BOARD: Storyboard = {
  templateUrl: 'https://img.example/sb_L2_$M.jpg',
  thumbnailWidth: 160,
  thumbnailHeight: 90,
  thumbnailCount: 60,
  intervalMs: 2_000,
  columns: 5,
  rows: 5,
  sheetCount: 3,
}

describe('filmstrip', () => {
  it('defines a positive pull-up threshold and scales horizontal drag delta linearly', () => {
    expect(FILMSTRIP_PULL_UP_PX).toBeGreaterThanOrEqual(20)
    expect(filmstripTimeDelta(142, 142, 2)).toBe(2)
    expect(filmstripTimeDelta(-71, 142, 2)).toBe(-1)
    expect(filmstripTimeDelta(10, 0, 2)).toBe(0)
  })

  it('centers the active timestamp tile and stays within thumbnailCount bounds', () => {
    const start = buildFilmstripWindow(BOARD, 120, 0, 800, 80)
    expect(start.tileWidth).toBe(142)
    expect(start.tileHeight).toBe(79.875)
    expect(start.sheetWidth).toBe(710)
    expect(start.secondsPerTile).toBe(2)
    expect(start.tiles.every(tile => tile.index >= 0 && tile.index < 60)).toBe(true)
    expect(start.tiles[0]!.index).toBe(0)
    expect(start.tiles[0]!.leftPx).toBe(400 - start.tileWidth / 2)

    const midSheet2 = buildFilmstripWindow(BOARD, 120, 50, 800, 80)
    const centerTile = midSheet2.tiles.find(tile => tile.index === 25)!
    const nextTile = midSheet2.tiles.find(tile => tile.index === 26)!
    expect(centerTile.url).toBe('https://img.example/sb_L2_1.jpg')
    expect(centerTile.bgX).toBe(0)
    expect(centerTile.bgY).toBe(0)
    expect(centerTile.leftPx).toBe(400 - midSheet2.tileWidth / 2)
    expect(nextTile.bgX).toBe(midSheet2.tileWidth)
    expect(nextTile.bgY).toBe(0)

    const halfTile = buildFilmstripWindow(BOARD, 120, 51, 800, 80)
    const halfCenter = halfTile.tiles.find(tile => tile.index === 25)!
    expect(halfCenter.leftPx).toBe(400 - halfTile.tileWidth)
  })
})
