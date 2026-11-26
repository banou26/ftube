import type { TrimRange } from './trim'

import { muxMp4, muxMp4Audio } from './mp4-muxer'
import { trimWebmAudio } from './webm-trimmer'

export type MuxWorkerRequest =
  | { kind: 'mp4', videoBuffers: ArrayBuffer[], audioBuffers: ArrayBuffer[], trim?: TrimRange, mimeType: string }
  | { kind: 'm4a', audioBuffers: ArrayBuffer[], trim?: TrimRange, mimeType: string }
  | { kind: 'webm-trim', audioBuffers: ArrayBuffer[], trim: TrimRange, mimeType: string }

export type MuxWorkerResponse =
  | { ok: true, blob: Blob }
  | { ok: false, error: string }

if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
  self.addEventListener('message', (event: MessageEvent<MuxWorkerRequest>) => {
    try {
      const msg = event.data
      let parts: Uint8Array[]
      if (msg.kind === 'mp4') {
        parts = muxMp4(
          msg.videoBuffers.map((buf) => new Uint8Array(buf)),
          msg.audioBuffers.map((buf) => new Uint8Array(buf)),
          msg.trim,
        )
      } else if (msg.kind === 'm4a') {
        parts = muxMp4Audio(
          msg.audioBuffers.map((buf) => new Uint8Array(buf)),
          msg.trim,
        )
      } else {
        parts = trimWebmAudio(
          msg.audioBuffers.map((buf) => new Uint8Array(buf)),
          msg.trim,
        )
      }
      // Build the output Blob in the worker so only a lightweight Blob handle crosses back to the UI thread.
      const blob = new Blob(parts as BlobPart[], { type: msg.mimeType })
      self.postMessage({ ok: true, blob } satisfies MuxWorkerResponse)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      self.postMessage({ ok: false, error: message } satisfies MuxWorkerResponse)
    }
  })
}
