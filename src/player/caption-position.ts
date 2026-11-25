import type { CaptionPosition } from '../settings'

export const DEFAULT_CAPTION_POSITION: CaptionPosition = { x: 0.5, y: 1 }

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

/** Computes normalized `[0, 1]` travel fractions from pointer drag coordinates within the caption layer bounds. */
export const positionFromPointer = ({
  clientX,
  clientY,
  grabOffsetX,
  grabOffsetY,
  layerRect,
  windowRect,
}: {
  clientX: number
  clientY: number
  grabOffsetX: number
  grabOffsetY: number
  layerRect: { left: number, top: number, width: number, height: number }
  windowRect: { width: number, height: number }
}): CaptionPosition => {
  const newLeft = clientX - grabOffsetX - layerRect.left
  const newTop = clientY - grabOffsetY - layerRect.top
  const availW = layerRect.width - windowRect.width
  const availH = layerRect.height - windowRect.height
  return {
    x: availW > 0 ? clamp(newLeft / availW, 0, 1) : DEFAULT_CAPTION_POSITION.x,
    y: availH > 0 ? clamp(newTop / availH, 0, 1) : DEFAULT_CAPTION_POSITION.y,
  }
}

const serializeCueFragment = (node: Node): string => {
  if (node.nodeType === 3) return node.textContent ?? ''
  if (node.nodeType === 1 && (node as Element).tagName === 'BR') return '\n'
  let text = ''
  for (const child of node.childNodes) text += serializeCueFragment(child)
  return text
}

const cueTextOf = (cue: TextTrackCue): string => {
  const vttCue = cue as VTTCue
  if (typeof vttCue.getCueAsHTML === 'function') {
    return serializeCueFragment(vttCue.getCueAsHTML())
  }
  return vttCue.text ?? ''
}

/** Extracts visible cue lines from showing text tracks, decoding HTML entities via `getCueAsHTML`. */
export const extractCueLines = (tracks: TextTrackList | Iterable<TextTrack>): string[] => {
  const lines: string[] = []
  for (const track of tracks) {
    if (track.mode !== 'showing' || !track.activeCues) continue
    for (const cue of track.activeCues) {
      for (const raw of cueTextOf(cue).split(/\r?\n/)) {
        const line = raw.replace(/\r$/, '')
        if (line.trim().length > 0) lines.push(line)
      }
    }
  }
  return lines
}
