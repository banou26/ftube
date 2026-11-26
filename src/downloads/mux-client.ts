import type { MuxWorkerRequest, MuxWorkerResponse } from './mux-worker'
import type { TrimRange } from './trim'

import { toStandaloneBuffer } from './bytes'

export type MuxJob =
  | { kind: 'mp4', videoChunks: Uint8Array[], audioChunks: Uint8Array[], trim?: TrimRange, mimeType: string }
  | { kind: 'm4a', audioChunks: Uint8Array[], trim?: TrimRange, mimeType: string }
  | { kind: 'webm-trim', audioChunks: Uint8Array[], trim: TrimRange, mimeType: string }

/**
 * Remuxes or trims downloaded media chunks off the main thread in a dedicated Web Worker
 * (falling back directly in Node test environments lacking `Worker`), returning the resulting `Blob`
 * while transferring source buffers out and terminating the worker heap on completion or cancellation.
 */
export const muxInWorker = async (job: MuxJob, signal?: AbortSignal): Promise<Blob> => {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')

  if (typeof Worker === 'undefined') {
    let parts: Uint8Array[]
    if (job.kind === 'mp4') {
      const { muxMp4 } = await import('./mp4-muxer')
      parts = muxMp4(job.videoChunks, job.audioChunks, job.trim)
    } else if (job.kind === 'm4a') {
      const { muxMp4Audio } = await import('./mp4-muxer')
      parts = muxMp4Audio(job.audioChunks, job.trim)
    } else {
      const { trimWebmAudio } = await import('./webm-trimmer')
      parts = trimWebmAudio(job.audioChunks, job.trim)
    }
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    return new Blob(parts as BlobPart[], { type: job.mimeType })
  }

  let request: MuxWorkerRequest
  let transfer: ArrayBuffer[]
  if (job.kind === 'mp4') {
    const videoBuffers = job.videoChunks.map(toStandaloneBuffer)
    const audioBuffers = job.audioChunks.map(toStandaloneBuffer)
    job.videoChunks.length = 0
    job.audioChunks.length = 0
    request = { kind: 'mp4', videoBuffers, audioBuffers, trim: job.trim, mimeType: job.mimeType }
    transfer = [...videoBuffers, ...audioBuffers]
  } else {
    const audioBuffers = job.audioChunks.map(toStandaloneBuffer)
    job.audioChunks.length = 0
    request = job.kind === 'm4a'
      ? { kind: 'm4a', audioBuffers, trim: job.trim, mimeType: job.mimeType }
      : { kind: 'webm-trim', audioBuffers, trim: job.trim, mimeType: job.mimeType }
    transfer = audioBuffers
  }

  const worker = new Worker(new URL('./mux-worker.ts', import.meta.url), { type: 'module' })
  return await new Promise<Blob>((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort)
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
      worker.removeEventListener('messageerror', onMessageError)
      worker.terminate()
    }
    const finishReject = (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const onAbort = () => finishReject(new DOMException('Cancelled', 'AbortError'))
    const onMessage = (event: MessageEvent<MuxWorkerResponse>) => {
      if (settled) return
      settled = true
      cleanup()
      const data = event.data
      if (data?.ok) resolve(data.blob)
      else reject(new Error(data?.error || 'Mux worker failed'))
    }
    const onError = (event: ErrorEvent) => {
      finishReject(event.error instanceof Error ? event.error : new Error(event.message || 'Mux worker error'))
    }
    const onMessageError = () => {
      finishReject(new Error('Mux worker returned an unreadable message'))
    }

    signal?.addEventListener('abort', onAbort, { once: true })
    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
    worker.addEventListener('messageerror', onMessageError)
    worker.postMessage(request, transfer)
  })
}
