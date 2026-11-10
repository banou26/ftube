import type { FrameApi, FrameMethod, FrameProgress, FrameRequest, FrameResponse } from '../frame/protocol'
import type { EngineReady, HostBootstrap, HostHello } from './protocol'

import { FRAME_METHODS } from '../frame/protocol'
import { startAgentHost } from './agent-host'
import { buildId, ENGINE_BUILD_MISMATCH, reloadOnceForBuild } from './engine-build'
import { abortPlatformEgress, startPlatform } from './platform'
import { ENGINE_PATH, ENGINE_READY, HOST_BOOTSTRAP, HOST_HELLO } from './protocol'
import { stepEnabled } from './step-flag'

let engine: Promise<FrameApi> | undefined
let engineFrame: HTMLIFrameElement | undefined
let engineConnection: ReturnType<typeof createFrameApi> | undefined
let engineCleanup: (() => void) | undefined
let engineReject: ((error: Error) => void) | undefined
let engineGeneration = 0

type PendingCall = {
  method: FrameMethod
  startedAt: number
  timeout?: ReturnType<typeof setTimeout>
  resolve(value: unknown): void
  reject(reason?: unknown): void
}

const createFrameApi = (port: MessagePort, onFatal: (error: Error) => void) => {
  let requestId = 0
  let closed = false
  const pending = new Map<number, PendingCall>()
  const close = (error: Error) => {
    if (closed) return
    closed = true
    port.close()
    for (const request of pending.values()) {
      clearTimeout(request.timeout)
      request.reject(error)
    }
    pending.clear()
  }
  const fail = (error: Error) => {
    close(error)
    onFatal(error)
  }
  const armTimeout = (id: number, request: PendingCall) => {
    clearTimeout(request.timeout)
    const timeoutMs = request.method === 'requestSegment' ? 20_000 : 90_000
    request.timeout = setTimeout(() => {
      if (!pending.has(id)) return
      const error = new Error(`yt-client: ${request.method} timed out after ${timeoutMs / 1_000}s of inactivity`)
      document.documentElement.dataset.playbackRecovery = error.message
      fail(error)
    }, timeoutMs)
  }
  port.addEventListener('message', (event) => {
    const response = event.data as FrameProgress | FrameResponse
    const request = pending.get(response.id)
    if (!request) return
    if ('progress' in response) {
      document.documentElement.dataset.frameProgress = response.progress
      armTimeout(response.id, request)
      return
    }
    document.documentElement.dataset.frameResponse = response.error ? 'error' : 'done'
    clearTimeout(request.timeout)
    pending.delete(response.id)
    document.documentElement.dataset.frameResponseMs = String(Math.round(performance.now() - request.startedAt))
    if (response.error) request.reject(new Error(response.error))
    else request.resolve(response.result)
  })
  port.addEventListener('messageerror', () => fail(new Error('yt-client: frame API message failed')))
  port.start()

  const call = (method: FrameMethod, args: unknown[]) => new Promise<unknown>((resolve, reject) => {
    if (closed) {
      reject(new Error('yt-client: frame API is closed'))
      return
    }
    const id = ++requestId
    const startedAt = performance.now()
    document.documentElement.dataset.frameRequest = method
    document.documentElement.dataset.frameRequestId = String(id)
    document.documentElement.dataset.frameRequestStartedAt = String(Math.round(startedAt))
    const request = { method, startedAt, resolve, reject }
    pending.set(id, request)
    armTimeout(id, request)
    try {
      port.postMessage({ id, method, args } as FrameRequest)
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)))
    }
  })

  return {
    api: Object.fromEntries(
      FRAME_METHODS.map((method) => [method, (...args: unknown[]) => call(method, args)]),
    ) as FrameApi,
    close,
  }
}

const invalidateEngine = (generation: number, error: Error) => {
  if (generation !== engineGeneration) return
  // the egress worker outlives the engine, so its in-flight work has to be dropped explicitly
  abortPlatformEgress()
  engineCleanup?.()
  engineCleanup = undefined
  const connection = engineConnection
  engineConnection = undefined
  connection?.close(error)
  engineReject?.(error)
  engineReject = undefined
  engineFrame?.remove()
  engineFrame = undefined
  engine = undefined
}

const fromAnotherBuild = (generation: number, engineBuild: unknown) => {
  if (generation !== engineGeneration) return
  invalidateEngine(generation, new Error(ENGINE_BUILD_MISMATCH))
  reloadOnceForBuild(engineBuild)
}

/**
 * The engine, booting it in a hidden same-origin frame (`ENGINE_PATH`) once per generation: the FrameApi once the
 * frame said ENGINE_READY. The FKN page it reaches YouTube's session and BotGuard through outlives the generation.
 */
export const startEngine = () => {
  if (engine) return engine
  const generation = ++engineGeneration
  engine = new Promise((resolve, reject) => {
    engineReject = reject
    const platformReady = startPlatform()
    // answerHello is the real handler; this only keeps a platform failure from surfacing as an unhandled rejection
    platformReady.catch(() => {})
    const agentHost = startAgentHost()
    const direct = stepEnabled('direct')

    const frame = document.createElement('iframe')
    engineFrame = frame
    frame.hidden = true
    frame.src = ENGINE_PATH
    let engineBuild: unknown
    const answerHello = async () => {
      try {
        const platform = await platformReady
        if (generation !== engineGeneration) return
        const egress = platform.openEgressPort()
        const extFetch = platform.openExtFetchPort()
        const agent = agentHost.openBridge()
        frame.contentWindow?.postMessage(
          { type: HOST_BOOTSTRAP, build: buildId(), signedIn: agentHost.signedIn, direct } satisfies HostBootstrap,
          location.origin,
          [egress, extFetch, agent],
        )
      } catch (error) {
        invalidateEngine(generation, error instanceof Error ? error : new Error(String(error)))
      }
    }
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.contentWindow) return
      if (event.data?.type === HOST_HELLO) {
        engineBuild = (event.data as Partial<HostHello>).build
        if (engineBuild !== buildId()) fromAnotherBuild(generation, engineBuild)
        else void answerHello()
        return
      }
      const ready = event.data as Partial<EngineReady> | undefined
      if (ready?.type !== ENGINE_READY) return
      engineCleanup?.()
      engineCleanup = undefined
      if (ready.error === ENGINE_BUILD_MISMATCH) {
        fromAnotherBuild(generation, engineBuild)
        return
      }
      if (ready.error) {
        invalidateEngine(generation, new Error(ready.error))
        return
      }
      const port = event.ports[0]
      if (!port) {
        invalidateEngine(generation, new Error('yt-client: frame API port is missing'))
        return
      }
      if (generation !== engineGeneration) {
        port.close()
        return
      }
      engineReject = undefined
      document.documentElement.dataset.ytSignedIn = String(ready.signedIn === true)
      engineConnection = createFrameApi(port, (error) => invalidateEngine(generation, error))
      resolve(engineConnection.api)
    }
    window.addEventListener('message', onMessage)
    engineCleanup = () => window.removeEventListener('message', onMessage)
    document.body.appendChild(frame)
  })
  return engine
}

export const resetEngine = () => invalidateEngine(engineGeneration, new Error('yt-client: engine reset'))
