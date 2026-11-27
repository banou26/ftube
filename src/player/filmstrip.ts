import type { Storyboard } from '../frame/storyboard'

export const FILMSTRIP_PULL_UP_PX = 28
export const FILMSTRIP_PULL_DOWN_PX = 24
export const FILMSTRIP_TILE_HEIGHT = 78

export type FilmstripTile = {
  index: number
  time: number
  leftPx: number
  url: string
  bgX: number
  bgY: number
}

export type FilmstripWindow = {
  tiles: FilmstripTile[]
  tileWidth: number
  tileHeight: number
  sheetWidth: number
  secondsPerTile: number
}

/** Converts horizontal pointer displacement into seconds based on tile width and interval. */
export const filmstripTimeDelta = (
  deltaX: number,
  tileWidth: number,
  secondsPerTile: number,
): number => {
  if (tileWidth <= 0 || !Number.isFinite(deltaX) || !Number.isFinite(secondsPerTile)) return 0
  return (deltaX / tileWidth) * secondsPerTile
}

/** Builds visible storyboard frames centered around `centerTime` inside `viewportWidth`. */
export const buildFilmstripWindow = (
  board: Storyboard,
  duration: number,
  centerTime: number,
  viewportWidth: number,
  targetHeight = FILMSTRIP_TILE_HEIGHT,
): FilmstripWindow => {
  const safeHeight = Math.max(24, targetHeight)
  const scale = safeHeight / board.thumbnailHeight
  const tileWidth = Math.max(80, Math.round(board.thumbnailWidth * scale))
  const tileHeight = board.thumbnailHeight * (tileWidth / board.thumbnailWidth)
  const secondsPerTile = board.intervalMs > 0
    ? board.intervalMs / 1_000
    : board.thumbnailCount > 1 && duration > 0
    ? duration / board.thumbnailCount
    : 2
  const sheetWidth = board.columns * tileWidth
  const safeDuration = Math.max(0, duration)
  const clampedTime = Math.max(0, Math.min(safeDuration, centerTime))
  const maxIndex = Math.max(0, board.thumbnailCount - 1)
  const exactIndex = Math.max(0, Math.min(maxIndex, secondsPerTile > 0 ? clampedTime / secondsPerTile : 0))
  const centerIndex = Math.round(exactIndex)
  const halfCount = Math.ceil(Math.max(320, viewportWidth) / tileWidth / 2) + 2
  const startIndex = Math.max(0, centerIndex - halfCount)
  const endIndex = Math.min(maxIndex, centerIndex + halfCount)
  const perSheet = Math.max(1, board.columns * board.rows)

  const tiles: FilmstripTile[] = []
  for (let index = startIndex; index <= endIndex; index++) {
    const sheet = Math.floor(index / perSheet)
    const position = index % perSheet
    tiles.push({
      index,
      time: Math.max(0, Math.min(safeDuration, index * secondsPerTile)),
      leftPx: viewportWidth / 2 + (index - exactIndex) * tileWidth - tileWidth / 2,
      url: board.templateUrl.replace('$M', String(sheet)),
      bgX: (position % board.columns) * tileWidth,
      bgY: Math.floor(position / board.columns) * tileHeight,
    })
  }

  return {
    tiles,
    tileWidth,
    tileHeight,
    sheetWidth,
    secondsPerTile,
  }
}
