/** One slice of YouTube Most Replayed engagement intensity along the video timeline. */
export type HeatMarker = {
  startMs: number
  durationMs: number
  intensity: number
}

/** SVG coordinate point on the normalized heatmap timeline. */
export type HeatmapPoint = {
  x: number
  y: number
  ratio: number
  intensity: number
}

/** Precomputed smooth SVG geometry and peak metadata for a seek-bar Most Replayed curve. */
export type HeatmapGeometry = {
  areaPath: string
  strokePath: string
  points: HeatmapPoint[]
  peakRatio: number
  maxIntensity: number
}

/** Width of the heatmap SVG coordinate space. */
export const HEATMAP_VIEWBOX_WIDTH = 1000

/** Height of the heatmap SVG coordinate space. */
export const HEATMAP_VIEWBOX_HEIGHT = 100

const MIN_BASELINE_HEIGHT = 6
const MAX_PEAK_HEIGHT = 96

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

const roundCoord = (value: number) => Number(value.toFixed(2))

/**
 * Validates and normalizes raw heat markers, dropping malformed entries, non-finite numbers,
 * negative timestamps, zero durations, or out-of-range scores, and rejecting all-zero or
 * single-point inputs so invalid payloads fall back cleanly to the standard seek bar.
 */
export const sanitizeHeatMarkers = (markers: readonly HeatMarker[] | null | undefined): HeatMarker[] => {
  if (!Array.isArray(markers) || markers.length < 2) return []
  const cleaned: HeatMarker[] = []
  let maxIntensity = 0
  for (const marker of markers) {
    if (!marker || typeof marker !== 'object') continue
    const { startMs, durationMs, intensity } = marker
    if (
      typeof startMs !== 'number' || !Number.isFinite(startMs) || startMs < 0
      || typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0
      || typeof intensity !== 'number' || !Number.isFinite(intensity) || intensity < 0 || intensity > 1.001
    ) {
      continue
    }
    const clampedIntensity = clamp(intensity, 0, 1)
    if (clampedIntensity > maxIntensity) maxIntensity = clampedIntensity
    cleaned.push({ startMs, durationMs, intensity: clampedIntensity })
  }
  if (cleaned.length < 2 || maxIntensity <= 0) return []
  cleaned.sort((a, b) => a.startMs - b.startMs)
  return cleaned
}

type Vertex = { x: number, y: number }

// Fritsch-Carlson monotone cubic Hermite tangents ensure smooth peaks without vertical overshoot.
const computeTangents = (vertices: readonly Vertex[]): number[] => {
  const n = vertices.length
  const slopes: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const dx = vertices[i + 1]!.x - vertices[i]!.x
    slopes.push(dx > 0 ? (vertices[i + 1]!.y - vertices[i]!.y) / dx : 0)
  }

  const tangents = new Array<number>(n).fill(0)
  tangents[0] = slopes[0] ?? 0
  tangents[n - 1] = slopes[n - 2] ?? 0

  for (let i = 1; i < n - 1; i++) {
    const dPrev = slopes[i - 1]!
    const dNext = slopes[i]!
    if (dPrev * dNext <= 0) {
      tangents[i] = 0
      continue
    }
    const hPrev = vertices[i]!.x - vertices[i - 1]!.x
    const hNext = vertices[i + 1]!.x - vertices[i]!.x
    const w1 = 2 * hNext + hPrev
    const w2 = hNext + 2 * hPrev
    tangents[i] = (w1 + w2) / (w1 / dPrev + w2 / dNext)
  }

  for (let i = 0; i < n - 1; i++) {
    const d = slopes[i]!
    if (d === 0) {
      tangents[i] = 0
      tangents[i + 1] = 0
      continue
    }
    const alpha = tangents[i]! / d
    const beta = tangents[i + 1]! / d
    const norm = Math.hypot(alpha, beta)
    if (norm > 3) {
      const scale = 3 / norm
      tangents[i] = scale * alpha * d
      tangents[i + 1] = scale * beta * d
    }
  }

  return tangents
}

/**
 * Builds SVG stroke and filled area paths spanning `[0, 1000] x [0, 100]` aligned with the seek
 * bar timeline of `durationSeconds`. Higher normalized replay intensity yields taller visual peaks
 * (smaller SVG `y`). Returns undefined when inputs cannot form a valid timeline curve.
 */
export const buildHeatmapGeometry = (
  markers: readonly HeatMarker[] | null | undefined,
  durationSeconds: number,
): HeatmapGeometry | undefined => {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return undefined
  const clean = sanitizeHeatMarkers(markers)
  if (clean.length < 2) return undefined

  const totalMs = durationSeconds * 1_000
  const points: HeatmapPoint[] = []
  let maxIntensity = 0
  let peakRatio = 0

  for (const marker of clean) {
    if (marker.startMs >= totalMs) continue
    const ratio = clamp((marker.startMs + marker.durationMs / 2) / totalMs, 0, 1)
    const x = roundCoord(ratio * HEATMAP_VIEWBOX_WIDTH)
    const height = MIN_BASELINE_HEIGHT + marker.intensity * (MAX_PEAK_HEIGHT - MIN_BASELINE_HEIGHT)
    const y = roundCoord(HEATMAP_VIEWBOX_HEIGHT - height)
    if (marker.intensity > maxIntensity) {
      maxIntensity = marker.intensity
      peakRatio = ratio
    }
    const prev = points.at(-1)
    if (prev && Math.abs(x - prev.x) < 0.01) {
      if (marker.intensity > prev.intensity) {
        prev.intensity = marker.intensity
        prev.y = y
        prev.ratio = ratio
      }
      continue
    }
    points.push({ x, y, ratio, intensity: marker.intensity })
  }

  if (points.length < 2 || maxIntensity <= 0) return undefined

  const vertices: Vertex[] = points.map(({ x, y }) => ({ x, y }))
  if (vertices[0]!.x > 0) vertices.unshift({ x: 0, y: vertices[0]!.y })
  if (vertices.at(-1)!.x < HEATMAP_VIEWBOX_WIDTH) {
    vertices.push({ x: HEATMAP_VIEWBOX_WIDTH, y: vertices.at(-1)!.y })
  }

  const tangents = computeTangents(vertices)
  const segments: string[] = []
  for (let i = 0; i < vertices.length - 1; i++) {
    const p0 = vertices[i]!
    const p1 = vertices[i + 1]!
    const thirdDx = (p1.x - p0.x) / 3
    const cp1x = roundCoord(p0.x + thirdDx)
    const cp1y = roundCoord(p0.y + tangents[i]! * thirdDx)
    const cp2x = roundCoord(p1.x - thirdDx)
    const cp2y = roundCoord(p1.y - tangents[i + 1]! * thirdDx)
    segments.push(`C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${roundCoord(p1.x)} ${roundCoord(p1.y)}`)
  }

  const first = vertices[0]!
  const last = vertices.at(-1)!
  const strokePath = `M ${roundCoord(first.x)} ${roundCoord(first.y)} ${segments.join(' ')}`
  const areaPath = `M 0 ${HEATMAP_VIEWBOX_HEIGHT} L ${roundCoord(first.x)} ${roundCoord(first.y)} ${segments.join(' ')} L ${roundCoord(last.x)} ${HEATMAP_VIEWBOX_HEIGHT} Z`

  return {
    areaPath,
    strokePath,
    points,
    peakRatio,
    maxIntensity,
  }
}
