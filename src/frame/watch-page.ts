import { readAgain } from '../read-again'
import { realm } from './realm'

/**
 * A watch page's attestation challenge and the `ytcfg` it was issued with, which BotGuard reads as
 * `yt.config_` (its `EVENT_ID` among it). The two are only used together. Measured on an enforced
 * video: sessions on att/get's challenge with no `yt.config_` stopped at the preview limit 10 of 10
 * times signed out (2026-10-10) and 40 of 40 signed in (2026-10-13); sessions on the page's played
 * through 10 of 10 and 39 of 39.
 */
export type PageChallenge = {
  config: Record<string, unknown>
  program: string
  globalName: string
  interpreterUrl: string
}

const ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' }

// a single-quoted JS string literal from its opening quote, or undefined until its closing quote has arrived
const readQuoted = (text: string, open: number) => {
  const parts: string[] = []
  let from = open + 1
  for (let index = from; index < text.length; index += 1) {
    const character = text[index]
    if (character === '\'') {
      parts.push(text.slice(from, index))
      return parts.join('')
    }
    if (character !== '\\') continue
    parts.push(text.slice(from, index))
    const kind = text[index + 1] ?? ''
    if (kind === 'x' || kind === 'u') {
      const width = kind === 'x' ? 2 : 4
      parts.push(String.fromCharCode(parseInt(text.slice(index + 2, index + 2 + width), 16)))
      index += 1 + width
    } else {
      parts.push(ESCAPES[kind] ?? kind)
      index += 1
    }
    from = index + 1
  }
  return undefined
}

/** The JSON object whose opening brace is at `open`, or undefined until its closing brace has arrived. */
export const readJsonObject = (text: string, open: number) => {
  let depth = 0
  let quoted = false
  let escaped = false
  for (let index = open; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') quoted = false
    } else if (character === '"') quoted = true
    else if (character === '{') depth += 1
    else if (character === '}' && --depth === 0) return JSON.parse(text.slice(open, index + 1)) as Record<string, unknown>
  }
  return undefined
}

const HOME_URL = 'https://www.youtube.com/?app=desktop'
const PLAYER_RESPONSE_START = /\b(?:ytInitialPlayerResponse|window\[['"]ytInitialPlayerResponse['"]\])\s*=\s*\{/g

const readPlayerResponse = (html: string) => {
  PLAYER_RESPONSE_START.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = PLAYER_RESPONSE_START.exec(html)) !== null) {
    try {
      const parsed = readJsonObject(html, match.index + match[0].length - 1)
      if (parsed) return parsed
    } catch {
      // Skip non-JSON brace blocks (e.g. inline scripts following `ytInitialPlayerResponse = null`) and keep scanning.
    }
  }
  return undefined
}

/**
 * The challenge and config of a watch page once both are in `html`, undefined until then. The page
 * carries the challenge as `window.ytAtN({'R': '<the att/get answer, as a JS string>'})`, after
 * `ytInitialPlayerResponse`, and its config as its first `ytcfg.set({...})`. Throws on a page whose
 * challenge is incomplete, or that carries no complete ytcfg.
 */
export const readPageChallenge = (html: string): PageChallenge | undefined => {
  const call = html.indexOf('window.ytAtN({')
  if (call < 0) return undefined
  const key = /'R'\s*:\s*'/g
  key.lastIndex = call
  const found = key.exec(html)
  if (!found) return undefined
  const raw = readQuoted(html, found.index + found[0].length - 1)
  if (raw === undefined) return undefined
  const challenge = (JSON.parse(raw) as {
    bgChallenge?: { program?: string, globalName?: string, interpreterUrl?: { privateDoNotAccessOrElseTrustedResourceUrlWrappedValue?: string } }
  }).bgChallenge
  const interpreterUrl = challenge?.interpreterUrl?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue
  if (!challenge?.program || !challenge.globalName || !interpreterUrl) throw new Error('youtube: the watch page\'s challenge is incomplete')
  const set = html.indexOf('ytcfg.set({')
  if (set < 0) throw new Error('youtube: the watch page carries no ytcfg')
  const config = readJsonObject(html, set + 'ytcfg.set('.length)
  if (!config) throw new Error('youtube: the watch page\'s ytcfg is incomplete')
  return {
    config,
    program: challenge.program,
    globalName: challenge.globalName,
    interpreterUrl: interpreterUrl.startsWith('//') ? `https:${interpreterUrl}` : interpreterUrl,
  }
}

const pagePlayers = new WeakMap<object, string>()

// the page's first ytcfg carries it ahead of the player response, with its slashes escaped
const readPagePlayerId = (html: string) => html.match(/"PLAYER_JS_URL"\s*:\s*"([^"]+)"/)?.[1]
  ?.replace(/\\\//g, '/')
  .match(/\/s\/player\/([\w-]+)\//)?.[1]

/** The id of the player the watch page answering `raw` was rendered with, from its PLAYER_JS_URL; undefined when it names none. */
export const pagePlayerOf = (raw: object) => pagePlayers.get(raw)

const fetchYoutubePage = async (url: string, visitorData: string | undefined) => {
  const response = await readAgain(
    () => realm.fetch(url, {
      headers: visitorData ? { 'X-Goog-Visitor-Id': visitorData } : {},
    }),
    ({ status }) => status === 429 || status >= 500,
    ({ status }) => console.warn(`youtube: the watch page returned ${status}, reading it again`),
  )
  if (response.ok) return response
  void response.body?.cancel().catch(() => {})
  throw new Error(`youtube: the watch page returned ${response.status}`)
}

const watchUrl = (videoId: string, playerParams: string | undefined) => {
  const params = playerParams ? `&pp=${encodeURIComponent(playerParams)}` : ''
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}${params}&app=desktop`
}

// Each part (PLAYER_JS_URL, ytInitialPlayerResponse, window.ytAtN) resolves as soon as its chunk arrives so player deciphering and BotGuard start without waiting for the rest of the document.
const readWatchPage = (
  videoId: string,
  visitorData: Promise<string> | undefined,
  playerParams: string | undefined,
  onPlayerId?: (playerId: string) => void,
) => {
  const playerResponse = Promise.withResolvers<Record<string, unknown>>()
  const challenge = Promise.withResolvers<PageChallenge>()
  void (async () => {
    const response = await fetchYoutubePage(watchUrl(videoId, playerParams), await visitorData)
    const reader = response.body?.getReader()
    const decoder = new TextDecoder()
    let html = reader ? '' : await response.text()
    let player: Record<string, unknown> | undefined
    let playerId: string | undefined
    let foundChallenge: PageChallenge | undefined
    for (;;) {
      const chunk = reader ? await reader.read() : { done: true as const }
      html += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true })
      if (!playerId) {
        playerId = readPagePlayerId(html)
        if (playerId) onPlayerId?.(playerId)
      }
      if (!player) {
        player = readPlayerResponse(html)
        if (player) {
          playerId ??= readPagePlayerId(html)
          if (playerId) pagePlayers.set(player, playerId)
          playerResponse.resolve(player)
        }
      }
      if (!foundChallenge) {
        foundChallenge = readPageChallenge(html)
        if (foundChallenge) challenge.resolve(foundChallenge)
      }
      if (player && foundChallenge) {
        void reader?.cancel().catch(() => {})
        return
      }
      if (chunk.done) throw new Error(player ? 'youtube: the watch page carries no challenge' : 'youtube: player response is missing')
    }
  })().catch((error: unknown) => {
    playerResponse.reject(error)
    challenge.reject(error)
  })
  void playerResponse.promise.catch(() => {})
  void challenge.promise.catch(() => {})
  return { playerResponse: playerResponse.promise, challenge: challenge.promise }
}

const readChallengeOnlyPage = (
  url: string,
  visitorData: Promise<string> | undefined,
  onPlayerId?: (playerId: string) => void,
) => {
  const challenge = Promise.withResolvers<PageChallenge>()
  void (async () => {
    const response = await fetchYoutubePage(url, await visitorData)
    const reader = response.body?.getReader()
    const decoder = new TextDecoder()
    let html = reader ? '' : await response.text()
    let playerId: string | undefined
    for (;;) {
      const chunk = reader ? await reader.read() : { done: true as const }
      html += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true })
      if (!playerId) {
        playerId = readPagePlayerId(html)
        if (playerId) onPlayerId?.(playerId)
      }
      const page = readPageChallenge(html)
      if (page) {
        challenge.resolve(page)
        void reader?.cancel().catch(() => {})
        return
      }
      if (chunk.done) throw new Error('youtube: the watch page carries no challenge')
    }
  })().catch((error: unknown) => {
    challenge.reject(error)
  })
  void challenge.promise.catch(() => {})
  return challenge.promise
}

let lastRead: { videoId: string, visitorData: Promise<string> | undefined, playerParams: string | undefined } | undefined
let lastWarm: { visitorData: Promise<string> | undefined } | undefined
let unusedChallenge: Promise<PageChallenge> | undefined
let hasStartedRead = false
const firstRead = Promise.withResolvers<void>()

/**
 * A watch page's player response, read as the visitor `visitorData` names when given (omitting `X-Goog-Visitor-Id`
 * when absent), and with a card's inline playback params as its `pp` when `playerParams` is given. The page's
 * challenge is kept for the next BotGuard session (`takePageChallenge`), and `onPlayerId` fires as soon as
 * `PLAYER_JS_URL` arrives in the stream.
 */
export const fetchPlayerResponse = (
  videoId: string,
  visitorData?: Promise<string>,
  playerParams?: string,
  onPlayerId?: (playerId: string) => void,
) => {
  const page = readWatchPage(videoId, visitorData, playerParams, onPlayerId)
  hasStartedRead = true
  lastRead = { videoId, visitorData, playerParams }
  unusedChallenge = page.challenge
  firstRead.resolve()
  return page.playerResponse
}

/**
 * Reads youtube.com's home HTML once before any watch page has been opened to feed its `window.ytAtN` challenge and
 * `PLAYER_JS_URL` to BotGuard and the player cache while the viewer is browsing non-watch pages. Returns false if a
 * watch read or warmup has already started.
 */
export const warmChallengePage = (
  visitorData?: Promise<string>,
  onPlayerId?: (playerId: string) => void,
) => {
  if (hasStartedRead) return false
  hasStartedRead = true
  lastWarm = { visitorData }
  unusedChallenge = readChallengeOnlyPage(HOME_URL, visitorData, onPlayerId)
  firstRead.resolve()
  return true
}

/**
 * The challenge for a new BotGuard session: the last page read when no session took it yet, else a
 * new read of the last video's page. Before any watch page was read, it waits for the first.
 */
export const takePageChallenge = async () => {
  await firstRead.promise
  const challenge = unusedChallenge ?? (lastRead
    ? readWatchPage(lastRead.videoId, lastRead.visitorData, lastRead.playerParams).challenge
    : readChallengeOnlyPage(HOME_URL, lastWarm?.visitorData))
  unusedChallenge = undefined
  return challenge
}
