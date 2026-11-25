/**
 * What the engine reads YouTube with, set by main.ts before it imports `./index`, whose modules read it at import.
 * `fetch` is the engine's lanes (lanes.ts); `anonymousFetch` uses only unauthenticated catalog/direct lanes (never the
 * signed-in session lane); `cookie` the FKN page's `document.cookie` when its jar holds a session, from which
 * youtubei.js signs its requests (SAPISIDHASH); `signedOut` turns true when an answer says that session has ended.
 * The defaults read nothing signed in, and fetch with the frame's own fetch.
 */
export const realm: { fetch: typeof fetch, anonymousFetch: typeof fetch, cookie?: string, signedOut: boolean } = {
  fetch: (input, init) => globalThis.fetch(input, init),
  anonymousFetch: (input, init) => globalThis.fetch(input, init),
  cookie: undefined,
  signedOut: false,
}

const SESSION_COOKIE = /(?:^|;\s*)SAPISID=/

/**
 * The session the FKN page's jar holds, from its `document.cookie`: signed in with a SAPISID, signed out without one.
 * A read that failed or ran out (the page unavailable, a card not answered yet) says nothing about the jar, so it is
 * neither: that load runs signed out and `signedOut` stays false.
 */
export const readSession = async (cookie: () => Promise<string>): Promise<{ cookie?: string, signedOut: boolean }> => {
  let value: string
  try {
    value = await cookie()
  } catch {
    return { signedOut: false }
  }
  return SESSION_COOKIE.test(value) ? { cookie: value, signedOut: false } : { signedOut: true }
}
