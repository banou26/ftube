import { BinaryWriter, WireType } from '@bufbuild/protobuf/wire'

const varint = (bytes: Uint8Array, start: number) => {
  let value = 0
  let at = start
  for (let shift = 0; ; shift += 7) {
    const byte = bytes[at++] ?? 0
    value += (byte & 0x7f) * 2 ** shift
    if (byte < 0x80) return { value, at }
  }
}

/** The field a path of field numbers leads to in a protobuf message: a varint's value, or a length-delimited field's bytes. */
export const protoField = (message: Uint8Array, [field, ...rest]: number[]): Uint8Array | number | undefined => {
  let found: Uint8Array | number | undefined
  let at = 0
  while (at < message.length) {
    const key = varint(message, at)
    const wire = key.value % 8
    let value: Uint8Array | number
    if (wire === 0) {
      const read = varint(message, key.at)
      value = read.value
      at = read.at
    } else if (wire === 2) {
      const length = varint(message, key.at)
      value = message.subarray(length.at, length.at + length.value)
      at = length.at + length.value
    } else if (wire === 1 || wire === 5) {
      at = key.at + (wire === 1 ? 8 : 4)
      continue
    } else {
      return undefined
    }
    if (Math.floor(key.value / 8) === field) found = value
  }
  if (rest.length === 0) return found
  return found instanceof Uint8Array ? protoField(found, rest) : undefined
}

/**
 * The bytes of an upstream token: base64 or base64url, percent-encoded or not. Throws on text that is neither.
 * A space reads as `+`, which is what a query string makes of a bare one.
 */
export const base64Bytes = (text: string) =>
  Uint8Array.from(
    atob(decodeURIComponent(text).replaceAll(' ', '+').replaceAll('-', '+').replaceAll('_', '/')),
    (char) => char.charCodeAt(0),
  )

/** Encodes `FEhashtag` browse params (field 93 wrapping `{ 1: tag, 2: 0, 3: 1 | 3 }`). */
export const encodeHashtagParams = (tag: string, tab: 'ALL' | 'SHORTS' = 'ALL') => {
  const bytes = new BinaryWriter()
    .tag(93, WireType.LengthDelimited)
    .fork()
    .tag(1, WireType.LengthDelimited)
    .string(tag)
    .tag(2, WireType.Varint)
    .int32(0)
    .tag(3, WireType.Varint)
    .int32(tab === 'SHORTS' ? 3 : 1)
    .join()
    .finish()
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return encodeURIComponent(btoa(binary))
}

/** Encodes fallback InnerTube `send_message` params when `actionPanel` did not supply them. */
export const encodeLiveMessageParams = (videoId: string, channelId = '') => {
  const bytes = new BinaryWriter()
    .tag(1, WireType.LengthDelimited)
    .fork()
    .tag(5, WireType.LengthDelimited)
    .fork()
    .tag(1, WireType.LengthDelimited)
    .string(channelId)
    .tag(2, WireType.LengthDelimited)
    .string(videoId)
    .join()
    .join()
    .tag(2, WireType.Varint)
    .int32(1)
    .tag(3, WireType.Varint)
    .int32(4)
    .finish()
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(encodeURIComponent(btoa(binary)))
}
