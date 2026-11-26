import type { Group } from './store'

import { DEFAULT_EMOJI, groupTreeOrder, NAME_LIMIT } from './store'

/** Channel metadata used to suggest an existing or new group without external API keys. */
export type ChannelGroupHints = {
  id: string
  name: string
  handle?: string | null
  description?: string | null
  tags?: readonly string[] | null
  isVerifiedArtist?: boolean | null
}

/** Top menu suggestion for adding a channel to an existing group or creating a new one. */
export type GroupSuggestion =
  | { kind: 'existing', group: Group }
  | { kind: 'new', name: string, emoji: string }

type Topic = {
  name: string
  emoji: string
  aliases: readonly string[]
  descriptionKeywords?: readonly string[]
}

// Ordered so more specific categories (F1, Mathematics, 3D, Programming) beat broad parents when equal
const TOPICS: readonly Topic[] = [
  { name: 'F1', emoji: '🚗', aliases: ['f1', 'formula 1', 'formula one', 'formula racing', 'grand prix', 'motorsport'] },
  { name: 'Cars', emoji: '🚗', aliases: ['car', 'automotive', 'automobile', 'auto', 'voiture', 'jdm', 'drifting', 'drag racing', 'muscle car', 'tuner car', 'project car', 'engine swap', 'turbo', 'supercharger', 'truck', 'racing', 'rally', 'off road'], descriptionKeywords: ['automotive', 'car reviews', 'project cars', 'motorsport', 'car culture'] },
  { name: 'ASMR', emoji: '🎧', aliases: ['asmr', 'relaxation', 'relax', 'sleep', 'stress relief', 'whisper', 'tingle'] },
  { name: 'Mathematics', emoji: '🔬', aliases: ['mathematics', 'math', 'maths', 'mathematiques', 'calculus', 'linear algebra', 'algebra', 'geometry', 'topology', 'probability'], descriptionKeywords: ['mathematics', 'math', 'calculus', 'geometry'] },
  { name: '3D', emoji: '🎨', aliases: ['3d', '3d modeling', '3d animation', 'cgi', 'vfx', 'blender 3d', 'sculpture'], descriptionKeywords: ['3d creation', '3d modeling', '3d animation', 'cgi'] },
  { name: 'Programming', emoji: '💻', aliases: ['programming', 'coding', 'software development', 'software engineering', 'web development', 'web dev', 'javascript', 'typescript', 'python', 'rustlang', 'rust programming', 'golang', 'react', 'angular', 'firebase', 'linux', 'devops', 'computer science', 'developer'], descriptionKeywords: ['programming', 'software engineering', 'web development', 'code tutorials'] },
  { name: 'Trailers', emoji: '🎬', aliases: ['trailer', 'movie trailer', 'film trailer', 'game trailer', 'teaser'], descriptionKeywords: ['trailers'] },
  { name: 'Gaming', emoji: '🎮', aliases: ['gaming', 'video game', 'videogame', 'videogaming', 'gamer', 'game', 'jeu video', 'jeux video', 'retrogaming', 'retro gaming', 'esport', 'console', 'playstation', 'xbox', 'nintendo', 'pc gaming', 'megadrive', 'speedrun', 'e3'], descriptionKeywords: ['gaming', 'video games', 'videogames', 'gamer', 'esports'] },
  { name: 'Tech', emoji: '💻', aliases: ['tech', 'technology', 'computer hardware', 'hardware', 'computer', 'consumer electronics', 'electronics', 'smartphone', 'gadget', 'laptop', 'pc build', 'motherboard', 'intel', 'amd', 'nvidia', 'gpu', 'cpu', 'gadget review'], descriptionKeywords: ['consumer electronics', 'tech videos', 'tech reviews', 'computer hardware', 'smartphones'] },
  { name: 'Music', emoji: '🎵', aliases: ['music', 'musician', 'singer', 'song', 'album', 'band', 'rock', 'pop', 'hip hop', 'rap', 'jazz', 'electronic music', 'classical music', 'dj', 'soundtrack', 'musique'], descriptionKeywords: ['official music', 'music video', 'singer', 'songwriter', 'musician', 'album', 'discography', 'record label'] },
  { name: 'Movies', emoji: '🎬', aliases: ['movie', 'film', 'cinema', 'series', 'television', 'anime', 'documentary'], descriptionKeywords: ['movie reviews', 'film analysis', 'cinema', 'filmmaker'] },
  { name: 'Cooking', emoji: '🍳', aliases: ['cooking', 'food', 'recipe', 'culinary', 'baking', 'chef', 'cuisine', 'kitchen'], descriptionKeywords: ['cooking', 'recipes', 'culinary', 'baking'] },
  { name: 'Science', emoji: '🔬', aliases: ['science', 'physics', 'chemistry', 'biology', 'astronomy', 'astrophysics', 'space science', 'outer space', 'engineering', 'scientific'], descriptionKeywords: ['science', 'physics', 'astronomy', 'biology', 'chemistry'] },
  { name: 'News', emoji: '📰', aliases: ['news', 'journalism', 'politics', 'current events', 'world news', 'actualites'], descriptionKeywords: ['journalism', 'breaking news', 'world news', 'current events'] },
  { name: 'Sports', emoji: '⚽', aliases: ['sport', 'football', 'soccer', 'basketball', 'nba', 'nfl', 'tennis', 'baseball', 'hockey', 'ufc', 'mma', 'athletics'], descriptionKeywords: ['sports', 'football', 'soccer', 'basketball'] },
  { name: 'Fitness', emoji: '🏋️', aliases: ['fitness', 'workout', 'gym', 'bodybuilding', 'exercise', 'strength training', 'weight training', 'health', 'nutrition'], descriptionKeywords: ['fitness', 'workout', 'bodybuilding'] },
  { name: 'Travel', emoji: '✈️', aliases: ['travel', 'tourism', 'aviation', 'airline', 'backpacking', 'adventure', 'voyage'], descriptionKeywords: ['travel vlog', 'backpacking', 'aviation', 'travel guide'] },
  { name: 'Comedy', emoji: '😂', aliases: ['comedy', 'humor', 'humour', 'sketch', 'standup', 'satire', 'parody'], descriptionKeywords: ['sketch comedy', 'standup comedy', 'satire', 'comedian'] },
  { name: 'Education', emoji: '📚', aliases: ['education', 'learning', 'history', 'philosophy', 'documentary', 'lecture', 'explain'], descriptionKeywords: ['educational', 'history', 'philosophy'] },
  { name: 'Art', emoji: '🎨', aliases: ['art', 'drawing', 'painting', 'illustration', 'design', 'graphic design', 'digital art'], descriptionKeywords: ['digital art', 'illustration', 'graphic design', 'painting'] },
  { name: 'Photography', emoji: '📷', aliases: ['photography', 'camera', 'filmmaking', 'videography', 'cinematography', 'photo'], descriptionKeywords: ['photography', 'filmmaking', 'cinematography'] },
  { name: 'DIY', emoji: '🛠️', aliases: ['diy', 'maker', 'woodworking', 'craft', 'electronics diy', 'repair', 'restoration'], descriptionKeywords: ['woodworking', 'diy projects'] },
  { name: 'Podcasts', emoji: '🎤', aliases: ['podcast', 'interview', 'talk show', 'discussion'], descriptionKeywords: ['podcast'] },
  { name: 'Pets', emoji: '🐶', aliases: ['pet', 'dog', 'cat', 'puppy', 'kitten', 'animal', 'wildlife'], descriptionKeywords: ['dogs', 'cats', 'wildlife'] },
  { name: 'Nature', emoji: '🌱', aliases: ['nature', 'gardening', 'plant', 'ecology', 'botany', 'farming'], descriptionKeywords: ['gardening', 'botany'] },
  { name: 'Business', emoji: '💼', aliases: ['business', 'finance', 'investing', 'economics', 'startup', 'entrepreneurship', 'marketing'], descriptionKeywords: ['investing', 'economics', 'entrepreneurship', 'personal finance'] },
]

const UPPERCASE_TERMS = new Set(['3d', 'ai', 'asmr', 'diy', 'f1', 'fx', 'irl', 'jdm', 'mma', 'nba', 'nfl', 'pc', 'rpg', 'tech', 'tv', 'ufc', 'uk', 'us', 'usa', 'vfx', 'vr'])

const BOILERPLATE_TAGS = new Set([
  '1080p',
  '4k',
  '60fps',
  '8k',
  'best',
  'channel',
  'cheat',
  'clip',
  'compilation',
  'daily',
  'entertainment',
  'episode',
  'featured',
  'for sleep',
  'full',
  'full video',
  'funny',
  'funny video',
  'gameplay',
  'gear',
  'give up',
  'guide',
  'hd',
  'how to',
  'live',
  'meme',
  'new',
  'official',
  'official audio',
  'official channel',
  'official video',
  'popular',
  'review',
  'short',
  'show',
  'stream',
  'subscribe',
  'test',
  'top',
  'trending',
  'tutorial',
  'tv',
  'uhd',
  'unboxing',
  'video',
  'vlog',
  'walkthrough',
  'youtube',
  'youtuber',
])

const DOMAIN_TAG_RE = /(?:https?:\/\/|www\.|\.(?:com|net|org|io|co|tv|gg|me|fr|de|jp|uk)\b)/i
const DIGITS_ONLY_RE = /^\d+$/

const singularizeWord = (word: string): string => {
  if (word.length <= 3 || word.endsWith('ss') || word.endsWith('us') || word.endsWith('is')) return word
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`
  if (word.endsWith('s') && !['asmr', 'news', 'ios', '3ds'].includes(word)) return word.slice(0, -1)
  return word
}

// Keeping singularization per word lets "Video Games" match "Gaming" / "Video Game" cleanly
const normalizePhrase = (raw: string): string =>
  raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(singularizeWord)
    .join(' ')

const canonicalAliasSet = (() => {
  const aliases = new Set<string>()
  const aliasWords = new Set<string>()
  for (const topic of TOPICS) {
    const normName = normalizePhrase(topic.name)
    aliases.add(normName)
    for (const w of normName.split(' ')) aliasWords.add(w)
    for (const alias of topic.aliases) {
      const norm = normalizePhrase(alias)
      aliases.add(norm)
      for (const w of norm.split(' ')) aliasWords.add(w)
    }
  }
  return { aliases, aliasWords }
})()

const topicForNormalized = (norm: string): Topic | undefined => {
  if (!norm) return undefined
  for (const topic of TOPICS) {
    if (normalizePhrase(topic.name) === norm) return topic
    if (topic.aliases.some(alias => normalizePhrase(alias) === norm)) return topic
  }
  return undefined
}

// Handles, full channel names, and brand words are vanity tags unless they explicitly name a real topic (e.g. "ASMR", "Formula 1")
const buildChannelVanityFilter = (channel: ChannelGroupHints) => {
  const fullForms = new Set<string>()
  const compactForms = new Set<string>()
  const words = new Set<string>()

  const addSource = (value: string | null | undefined) => {
    if (!value) return
    const cleaned = value.replace(/^@/, '')
    const norm = normalizePhrase(cleaned)
    if (!norm) return
    fullForms.add(norm)
    compactForms.add(norm.replace(/\s+/g, ''))
    for (const token of norm.split(' ')) {
      if (token.length >= 4 && !canonicalAliasSet.aliasWords.has(token)) words.add(token)
    }
  }

  addSource(channel.name)
  addSource(channel.handle)
  return { fullForms, compactForms, words }
}

const isRelevantTag = (raw: string, vanity: ReturnType<typeof buildChannelVanityFilter>): boolean => {
  const trimmed = raw.trim()
  if (trimmed.length < 2 || trimmed.length > 28) return false
  if (DOMAIN_TAG_RE.test(trimmed)) return false
  const norm = normalizePhrase(trimmed)
  if (!norm || norm.length < 2 || DIGITS_ONLY_RE.test(norm)) return false
  const tokens = norm.split(' ')
  if (tokens.length > 3) return false
  if (BOILERPLATE_TAGS.has(norm)) return false
  // Allow an exact canonical topic alias even if it overlaps part of a handle (e.g. @Formula1 -> "Formula 1")
  if (canonicalAliasSet.aliases.has(norm)) return true
  const compact = norm.replace(/\s+/g, '')
  if (vanity.fullForms.has(norm) || vanity.compactForms.has(compact)) return false
  if (tokens.some(token => vanity.words.has(token))) return false
  return true
}

const containsWholePhrase = (haystack: string, needle: string): boolean => {
  if (!haystack || !needle) return false
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`).test(haystack)
}

const formatGroupName = (raw: string): string => {
  const words = raw
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase()
      if (UPPERCASE_TERMS.has(lower)) return lower.toUpperCase()
      if (/^[A-Z0-9]{2,}$/.test(word)) return word
      return word.charAt(0).toUpperCase() + word.slice(1)
    })
  return words.join(' ').slice(0, NAME_LIMIT)
}

const topicScoresFromSignals = (cleanTags: readonly string[], channel: ChannelGroupHints): Map<Topic, number> => {
  const scores = new Map<Topic, number>()
  const add = (topic: Topic, points: number) => scores.set(topic, (scores.get(topic) ?? 0) + points)

  cleanTags.forEach((tag, index) => {
    const norm = normalizePhrase(tag)
    const positionBonus = Math.max(0, 12 - index)
    let matched = false
    for (const topic of TOPICS) {
      if (normalizePhrase(topic.name) === norm || topic.aliases.some(alias => normalizePhrase(alias) === norm)) {
        add(topic, (scores.has(topic) ? 14 : 50) + positionBonus)
        matched = true
        break
      }
    }
    if (!matched) {
      for (const topic of TOPICS) {
        if (topic.aliases.some(alias => {
          const normAlias = normalizePhrase(alias)
          return normAlias.length >= 4 && containsWholePhrase(norm, normAlias)
        })) {
          add(topic, scores.has(topic) ? 10 : 32)
        }
      }
    }
  })

  if (channel.isVerifiedArtist) {
    const music = TOPICS.find(topic => topic.name === 'Music')
    if (music) add(music, 75)
  }

  // Only consult the channel description for new-topic scoring when tags carry no strong signal
  if (scores.size === 0 && channel.description) {
    const normDesc = normalizePhrase(channel.description)
    for (const topic of TOPICS) {
      let descHits = 0
      for (const kw of topic.descriptionKeywords ?? []) {
        if (containsWholePhrase(normDesc, normalizePhrase(kw))) descHits += 1
      }
      if (descHits > 0) add(topic, 42 + descHits * 10)
    }
  }

  return scores
}

/** Suggests an existing matching group or a new topic group for a channel, or `undefined` when no relevant match exists. */
export const suggestGroup = (channel: ChannelGroupHints, groups: readonly Group[]): GroupSuggestion | undefined => {
  const vanity = buildChannelVanityFilter(channel)
  const cleanTags = (channel.tags ?? []).filter(tag => isRelevantTag(tag, vanity))
  const normCleanTags = cleanTags.map(normalizePhrase)
  const topicScores = topicScoresFromSignals(cleanTags, channel)
  const normDesc = channel.description ? normalizePhrase(channel.description) : ''

  let topTopic: Topic | undefined
  let topTopicScore = 0
  for (const [topic, score] of topicScores) {
    if (score > topTopicScore) {
      topTopic = topic
      topTopicScore = score
    }
  }

  // Follow UI tree order so ties or specificity prefer nested matching subgroups cleanly
  const ordered = groupTreeOrder(groups)
  type Candidate = { group: Group, depth: number, score: number, alreadyIn: boolean }
  const candidates: Candidate[] = []

  for (const { group, depth } of ordered) {
    const normName = normalizePhrase(group.name)
    if (!normName) continue
    let score = 0

    const exactIdx = normCleanTags.indexOf(normName)
    const groupTopic = topicForNormalized(normName)
    const groupTopicScore = groupTopic ? (topicScores.get(groupTopic) ?? 0) : 0
    // A late secondary tag must not match an unrelated existing group when another topic clearly dominates
    const diluted = Boolean(
      topTopic
      && topTopic !== groupTopic
      && (exactIdx === -1 || exactIdx >= 3)
      && topTopicScore >= Math.max(80, groupTopicScore * 2.5),
    )

    if (!diluted) {
      if (exactIdx !== -1) {
        score += 100 + Math.max(0, 10 - exactIdx)
      } else {
        const phraseHits = normCleanTags.filter(tag => containsWholePhrase(tag, normName)).length
        if (phraseHits > 0) score += 60 + Math.min(30, (phraseHits - 1) * 15)
      }

      if (groupTopicScore > 0) {
        score += Math.min(90, groupTopicScore + 10)
      }
    }

    // Description alone is too noisy ("business inquiries", "music by ..."); only let it strengthen a tag or topic match
    if (score > 0 && !diluted && normDesc && (normName.length >= 3 || UPPERCASE_TERMS.has(normName))) {
      if (containsWholePhrase(normDesc, normName)) {
        score += 20
      }
    }

    if (score >= 45) {
      candidates.push({
        group,
        depth,
        score,
        alreadyIn: group.channels.some(kept => kept.id === channel.id),
      })
    }
  }

  candidates.sort((a, b) => (b.score - a.score) || (b.depth - a.depth))
  const bestOverall = candidates[0]
  const bestEligible = candidates.find(candidate => !candidate.alreadyIn)

  if (bestEligible) {
    // If the channel is already in its top-matching group, only suggest another unjoined group on a strong direct hit
    if (!bestOverall?.alreadyIn || bestEligible.score >= 80) {
      return { kind: 'existing', group: bestEligible.group }
    }
    return undefined
  }
  if (bestOverall?.alreadyIn) return undefined

  const existingNormNames = new Set(groups.map(group => normalizePhrase(group.name)))

  if (topTopic && topTopicScore >= 45 && !existingNormNames.has(normalizePhrase(topTopic.name))) {
    return { kind: 'new', name: topTopic.name, emoji: topTopic.emoji }
  }

  // Fallback to the cleanest raw tag when it is compact, readable, and not already a group name
  const fallbackTag = cleanTags.find((tag) => {
    const norm = normalizePhrase(tag)
    const words = norm.split(' ')
    return norm.length >= 2
      && tag.length <= 22
      && words.length <= 2
      && !existingNormNames.has(norm)
      && /^[a-z0-9\s+#-]+$/i.test(tag)
  })
  if (fallbackTag) {
    return { kind: 'new', name: formatGroupName(fallbackTag), emoji: DEFAULT_EMOJI }
  }

  return undefined
}
