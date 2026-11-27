export type TheaterMode = 'default' | 'theater' | 'fullscreen'

export const THEATER_MODES: readonly { value: TheaterMode, label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'theater', label: 'Theater' },
  { value: 'fullscreen', label: 'Fullscreen theater' },
]

/** Accepts legacy boolean `true` as `'theater'` and drops invalid values. */
export const coerceTheaterMode = (value: unknown): TheaterMode =>
  value === 'theater' || value === true
    ? 'theater'
    : value === 'fullscreen'
      ? 'fullscreen'
      : 'default'

/** Advances through Default -> Theater -> Fullscreen theater -> Default. */
export const nextTheaterMode = (mode: TheaterMode): TheaterMode =>
  mode === 'default'
    ? 'theater'
    : mode === 'theater'
      ? 'fullscreen'
      : 'default'

export const isTheaterActive = (mode: TheaterMode) => mode !== 'default'
