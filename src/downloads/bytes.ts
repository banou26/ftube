/** Soft browser-memory warning threshold shown in the download picker (512 MiB). */
export const LARGE_DOWNLOAD_WARNING_BYTES = 512 * 1024 * 1024

/** Hard upper bound enforced across the engine download loop and browser store to prevent tab OOM (1 GiB). */
export const MAX_DOWNLOAD_BYTES = 1024 * 1024 * 1024

export const MAX_DOWNLOAD_ERROR = 'Download exceeds the 1 GB browser memory limit. Pick a lower quality or trim a shorter clip.'

/** Concatenates an array of byte views into a single contiguous `Uint8Array`. */
export const concatChunks = (chunks: readonly Uint8Array[]): Uint8Array => {
  if (chunks.length === 1) return chunks[0]!
  let total = 0
  for (const chunk of chunks) total += chunk.byteLength
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/** Returns an unshared `ArrayBuffer` matching `chunk`'s exact byte slice so transfers never copy or detach extra bytes. */
export const toStandaloneBuffer = (chunk: Uint8Array): ArrayBuffer => {
  if (chunk.byteOffset === 0 && chunk.byteLength === chunk.buffer.byteLength && chunk.buffer instanceof ArrayBuffer) {
    return chunk.buffer
  }
  return chunk.slice().buffer
}
