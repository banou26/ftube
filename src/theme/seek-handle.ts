export type SeekIconName =
  | 'Play'
  | 'Circle'
  | 'Disc'
  | 'Disc3'
  | 'Music'
  | 'Music2'
  | 'Headphones'
  | 'Radio'
  | 'Tv'
  | 'Film'
  | 'Clapperboard'
  | 'Volume2'
  | 'FastForward'
  | 'Sparkle'
  | 'Star'
  | 'Heart'
  | 'Diamond'
  | 'Hexagon'
  | 'Pentagon'
  | 'Triangle'
  | 'Square'
  | 'Octagon'
  | 'Sparkles'
  | 'Crown'
  | 'Award'
  | 'Trophy'
  | 'Medal'
  | 'Shield'
  | 'Flame'
  | 'Zap'
  | 'Sun'
  | 'Moon'
  | 'Cloud'
  | 'Snowflake'
  | 'Leaf'
  | 'Flower2'
  | 'Clover'
  | 'Feather'
  | 'PawPrint'
  | 'Cat'
  | 'Dog'
  | 'Fish'
  | 'Bird'
  | 'Bug'
  | 'Rocket'
  | 'Plane'
  | 'Car'
  | 'Bike'
  | 'Ship'
  | 'Compass'
  | 'Anchor'
  | 'Gamepad2'
  | 'Ghost'
  | 'Skull'
  | 'Smile'
  | 'Coffee'
  | 'Pizza'
  | 'Gem'
  | 'Key'
  | 'Bell'
  | 'Flag'
  | 'Target'
  | 'Crosshair'
  | 'Palette'
  | 'Camera'
  | 'Lightbulb'
  | 'Hourglass'

export type SeekIconCategory = 'Media' | 'Shapes' | 'Nature' | 'Travel' | 'Play'

export type SeekIconEntry = {
  name: SeekIconName
  label: string
  category: SeekIconCategory
}

export type SeekHandle =
  | { kind: 'default' }
  | { kind: 'emoji', value: string }
  | { kind: 'icon', value: SeekIconName }

export const SEEK_ICON_CATEGORIES: readonly SeekIconCategory[] = [
  'Media',
  'Shapes',
  'Nature',
  'Travel',
  'Play',
]

export const SEEK_ICONS: readonly SeekIconEntry[] = [
  { name: 'Play', label: 'Play', category: 'Media' },
  { name: 'FastForward', label: 'Fast forward', category: 'Media' },
  { name: 'Disc', label: 'Disc', category: 'Media' },
  { name: 'Disc3', label: 'Vinyl', category: 'Media' },
  { name: 'Music', label: 'Music', category: 'Media' },
  { name: 'Music2', label: 'Note', category: 'Media' },
  { name: 'Headphones', label: 'Headphones', category: 'Media' },
  { name: 'Radio', label: 'Radio', category: 'Media' },
  { name: 'Tv', label: 'TV', category: 'Media' },
  { name: 'Film', label: 'Film', category: 'Media' },
  { name: 'Clapperboard', label: 'Clapperboard', category: 'Media' },
  { name: 'Volume2', label: 'Volume', category: 'Media' },
  { name: 'Camera', label: 'Camera', category: 'Media' },

  { name: 'Circle', label: 'Circle', category: 'Shapes' },
  { name: 'Star', label: 'Star', category: 'Shapes' },
  { name: 'Heart', label: 'Heart', category: 'Shapes' },
  { name: 'Diamond', label: 'Diamond', category: 'Shapes' },
  { name: 'Hexagon', label: 'Hexagon', category: 'Shapes' },
  { name: 'Pentagon', label: 'Pentagon', category: 'Shapes' },
  { name: 'Triangle', label: 'Triangle', category: 'Shapes' },
  { name: 'Square', label: 'Square', category: 'Shapes' },
  { name: 'Octagon', label: 'Octagon', category: 'Shapes' },
  { name: 'Sparkle', label: 'Sparkle', category: 'Shapes' },
  { name: 'Sparkles', label: 'Sparkles', category: 'Shapes' },
  { name: 'Target', label: 'Target', category: 'Shapes' },
  { name: 'Crosshair', label: 'Crosshair', category: 'Shapes' },

  { name: 'Flame', label: 'Flame', category: 'Nature' },
  { name: 'Zap', label: 'Lightning', category: 'Nature' },
  { name: 'Sun', label: 'Sun', category: 'Nature' },
  { name: 'Moon', label: 'Moon', category: 'Nature' },
  { name: 'Cloud', label: 'Cloud', category: 'Nature' },
  { name: 'Snowflake', label: 'Snowflake', category: 'Nature' },
  { name: 'Leaf', label: 'Leaf', category: 'Nature' },
  { name: 'Flower2', label: 'Flower', category: 'Nature' },
  { name: 'Clover', label: 'Clover', category: 'Nature' },
  { name: 'Feather', label: 'Feather', category: 'Nature' },
  { name: 'PawPrint', label: 'Paw print', category: 'Nature' },
  { name: 'Cat', label: 'Cat', category: 'Nature' },
  { name: 'Dog', label: 'Dog', category: 'Nature' },
  { name: 'Fish', label: 'Fish', category: 'Nature' },
  { name: 'Bird', label: 'Bird', category: 'Nature' },
  { name: 'Bug', label: 'Bug', category: 'Nature' },

  { name: 'Rocket', label: 'Rocket', category: 'Travel' },
  { name: 'Plane', label: 'Plane', category: 'Travel' },
  { name: 'Car', label: 'Car', category: 'Travel' },
  { name: 'Bike', label: 'Bike', category: 'Travel' },
  { name: 'Ship', label: 'Ship', category: 'Travel' },
  { name: 'Compass', label: 'Compass', category: 'Travel' },
  { name: 'Anchor', label: 'Anchor', category: 'Travel' },
  { name: 'Flag', label: 'Flag', category: 'Travel' },

  { name: 'Crown', label: 'Crown', category: 'Play' },
  { name: 'Award', label: 'Award', category: 'Play' },
  { name: 'Trophy', label: 'Trophy', category: 'Play' },
  { name: 'Medal', label: 'Medal', category: 'Play' },
  { name: 'Shield', label: 'Shield', category: 'Play' },
  { name: 'Gamepad2', label: 'Gamepad', category: 'Play' },
  { name: 'Ghost', label: 'Ghost', category: 'Play' },
  { name: 'Skull', label: 'Skull', category: 'Play' },
  { name: 'Smile', label: 'Smile', category: 'Play' },
  { name: 'Coffee', label: 'Coffee', category: 'Play' },
  { name: 'Pizza', label: 'Pizza', category: 'Play' },
  { name: 'Gem', label: 'Gem', category: 'Play' },
  { name: 'Key', label: 'Key', category: 'Play' },
  { name: 'Bell', label: 'Bell', category: 'Play' },
  { name: 'Palette', label: 'Palette', category: 'Play' },
  { name: 'Lightbulb', label: 'Lightbulb', category: 'Play' },
  { name: 'Hourglass', label: 'Hourglass', category: 'Play' },
]

const ICON_SET = new Set<string>(SEEK_ICONS.map(entry => entry.name))

export const isSeekIconName = (value: unknown): value is SeekIconName =>
  typeof value === 'string' && ICON_SET.has(value)

export const normalizeSeekEmoji = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 16) return undefined
  if (/[\r\n<>]/.test(trimmed)) return undefined
  return trimmed
}

export const coerceSeekHandle = (raw: unknown): SeekHandle => {
  if (!raw || typeof raw !== 'object') return { kind: 'default' }
  const entry = raw as { kind?: unknown, value?: unknown }
  if (entry.kind === 'emoji') {
    const emoji = normalizeSeekEmoji(entry.value)
    return emoji ? { kind: 'emoji', value: emoji } : { kind: 'default' }
  }
  if (entry.kind === 'icon' && isSeekIconName(entry.value)) {
    return { kind: 'icon', value: entry.value }
  }
  return { kind: 'default' }
}

export const filterSeekIcons = (query: string, category?: SeekIconCategory): readonly SeekIconEntry[] => {
  const term = query.trim().toLowerCase()
  if (!term) return category ? SEEK_ICONS.filter(entry => entry.category === category) : SEEK_ICONS
  return SEEK_ICONS.filter(entry =>
    entry.label.toLowerCase().includes(term) || entry.name.toLowerCase().includes(term),
  )
}
