/**
 * `headers` with the browser's languages as Accept-Language when they name none, in the browser's own form and order.
 * A request that leaves through FKN carries only the headers it names, and YouTube answers it in that language: a
 * watch page read with none recommends no captions to a Japanese browser that youtube.com recommends Japanese ones to.
 */
export const withLanguage = (headers: Record<string, string> = {}, languages: readonly string[] = navigator.languages) => {
  if (Object.keys(headers).some((name) => name.toLowerCase() === 'accept-language')) return { ...headers }
  return {
    ...headers,
    'accept-language': languages
      .map((language, index) => index === 0 ? language : `${language};q=${Math.max(0.1, 1 - index * 0.1).toFixed(1)}`)
      .join(','),
  }
}
