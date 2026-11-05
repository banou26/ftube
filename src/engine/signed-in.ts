/**
 * `localStorage['yt-client:signed-in']`, set once a sign-in through FKN's window ended signed in. It decides the jar
 * of the FKN page (`'persistent'` with it, `'ephemeral'` without), so a browser without it never attaches a page on
 * FKN's shared jar. A boolean, never an identity. Cleared on sign-out, and by the engine only on an answer that says
 * the jar holds no session (realm.ts), never on a timeout. Storage that cannot be read reads signed out.
 */
export const SIGNED_IN_KEY = 'yt-client:signed-in'

export const readSignedIn = () => {
  try {
    return localStorage.getItem(SIGNED_IN_KEY) === '1'
  } catch {
    return false
  }
}

export const markSignedIn = () => {
  try {
    localStorage.setItem(SIGNED_IN_KEY, '1')
  } catch {}
}

export const clearSignedIn = () => {
  try {
    localStorage.removeItem(SIGNED_IN_KEY)
  } catch {}
}
