import type { FrameApi, FrameMethod, FrameProgress, FrameRequest, FrameResponse } from '../frame/protocol'
import type { EngineReady, HostBootstrap, HostHello, HostRestart } from './protocol'

import { FRAME_METHODS } from '../frame/protocol'
import { startAgentHost } from './agent-host'
import { buildId, ENGINE_BUILD_MISMATCH, reloadOnceForBuild } from './engine-build'
import { abortPlatformEgress, startPlatform } from './platform'
import { ENGINE_PATH, ENGINE_READY, HOST_BOOTSTRAP, HOST_HELLO, HOST_RESTART } from './protocol'
import { stepEnabled } from './step-flag'

let engine: Promise<FrameApi> | undefined
let engineFrame: HTMLIFrameElement | undefined
let keptFrame: HTMLIFrameElement | undefined
let engineConnection: ReturnType<typeof createFrameApi> | undefined
let engineCleanup: (() => void) | undefined
let engineReject: ((error: Error) => void) | undefined
let engineGeneration = 0
let lastAttemptId = 0

/** How long a fresh engine frame has to say HOST_HELLO before it is treated as dropped and retried. */
export const HELLO_TIMEOUT_MS = 5_000
/** How long a kept frame asked to HOST_RESTART has to answer ENGINE_READY before it is dropped. */
export const RESTART_TIMEOUT_MS = 5_000
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000]

const isTransientLoadError = (message: string) =>
  /failed to fetch|dynamically imported module|importing a module script failed|networkerror|load failed/i.test(message)

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
  if (connection) keptFrame = engineFrame
  else engineFrame?.remove()
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
 * The frame that served the last engine is kept until the next frame says its build: when that is another build, a
 * deploy since this page loaded, the next engine starts again in the kept frame (`HOST_RESTART`), from the code it
 * loaded, rather than this page reloading to take the new build. Without a kept frame the page reloads once.
 *
 * When a start attempt fails to load or answer (for example during a network drop), it retries on `online` or a
 * backoff timer; each attempt carries an id echoed in `ENGINE_READY` so late answers from earlier attempts are ignored.
 * A kept-frame restart that misses its deadline drops the kept frame and falls back to loading a fresh one.
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

    let current: HTMLIFrameElement | undefined
    let activeAttempt = 0
    let awaitingHello = false
    let retryCount = 0
    let engineBuild: unknown
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let onOnlineListener: ((event?: Event) => void) | undefined
    let onFrameLoad: (() => void) | undefined
    let loadedFrame: HTMLIFrameElement | undefined

    const clearDeadline = () => {
      clearTimeout(deadlineTimer)
      deadlineTimer = undefined
    }

    const clearFrameLoad = () => {
      if (loadedFrame && onFrameLoad) loadedFrame.removeEventListener?.('load', onFrameLoad)
      loadedFrame = undefined
      onFrameLoad = undefined
    }

    const clearRetry = () => {
      clearTimeout(retryTimer)
      retryTimer = undefined
      if (onOnlineListener) {
        window.removeEventListener('online', onOnlineListener)
        onOnlineListener = undefined
      }
    }

    const cleanupAll = () => {
      clearDeadline()
      clearFrameLoad()
      clearRetry()
      window.removeEventListener('message', onMessage)
    }

    const scheduleRetry = () => {
      if (generation !== engineGeneration || retryTimer !== undefined) return
      clearDeadline()
      clearFrameLoad()
      const delay = RETRY_DELAYS_MS[Math.min(retryCount, RETRY_DELAYS_MS.length - 1)]!
      retryCount += 1
      const go = (event?: Event) => {
        if (event && ('data' in event || (event.type && event.type !== 'online'))) return
        clearRetry()
        if (generation !== engineGeneration) return
        launchAttempt()
      }
      onOnlineListener = go
      window.addEventListener('online', go)
      retryTimer = setTimeout(() => go(), delay)
    }

    const launchAttempt = () => {
      if (generation !== engineGeneration) return
      clearDeadline()
      clearFrameLoad()
      clearRetry()
      if (current && current !== keptFrame) current.remove()
      const attempt = ++lastAttemptId
      activeAttempt = attempt
      awaitingHello = true
      engineBuild = undefined
      const frame = document.createElement('iframe')
      current = frame
      engineFrame = frame
      frame.hidden = true
      frame.src = ENGINE_PATH
      const failHello = () => {
        if (!awaitingHello || generation !== engineGeneration || attempt !== activeAttempt) return
        awaitingHello = false
        frame.remove()
        if (current === frame) current = undefined
        if (engineFrame === frame) engineFrame = undefined
        scheduleRetry()
      }
      onFrameLoad = () => {
        if (!awaitingHello || generation !== engineGeneration || attempt !== activeAttempt) return
        let errorDocument = false
        try {
          // A same-origin engine.html exposes contentDocument; a failed navigation (chrome-error://) returns null or throws.
          errorDocument = frame.contentDocument === null
        } catch {
          errorDocument = true
        }
        if (errorDocument) failHello()
      }
      loadedFrame = frame
      frame.addEventListener?.('load', onFrameLoad)
      deadlineTimer = setTimeout(failHello, HELLO_TIMEOUT_MS)
      document.body.appendChild(frame)
    }

    const answerHello = async (frame: HTMLIFrameElement, attempt: number) => {
      try {
        const platform = await platformReady
        if (generation !== engineGeneration || attempt !== activeAttempt) return
        const egress = platform.openEgressPort()
        const extFetch = platform.openExtFetchPort()
        const agent = agentHost.openBridge()
        frame.contentWindow?.postMessage(
          { type: HOST_BOOTSTRAP, build: buildId(), signedIn: agentHost.signedIn, direct, attempt } satisfies HostBootstrap,
          location.origin,
          [egress, extFetch, agent],
        )
      } catch (error) {
        invalidateEngine(generation, error instanceof Error ? error : new Error(String(error)))
      }
    }

    const restartIn = (probe: HTMLIFrameElement, kept: HTMLIFrameElement, attempt: number) => {
      probe.remove()
      clearFrameLoad()
      clearDeadline()
      current = kept
      engineFrame = kept
      deadlineTimer = setTimeout(() => {
        if (generation !== engineGeneration || attempt !== activeAttempt) return
        kept.remove()
        if (current === kept) current = undefined
        if (engineFrame === kept) engineFrame = undefined
        launchAttempt()
      }, RESTART_TIMEOUT_MS)
      kept.contentWindow?.postMessage(
        { type: HOST_RESTART, signedIn: agentHost.signedIn, attempt } satisfies HostRestart,
        location.origin,
        [agentHost.openBridge()],
      )
    }

    const onMessage = (event: MessageEvent) => {
      if (!current || event.origin !== location.origin || event.source !== current.contentWindow) return
      if (event.data?.type === HOST_HELLO) {
        awaitingHello = false
        clearDeadline()
        clearFrameLoad()
        const frame = current
        const attempt = activeAttempt
        engineBuild = (event.data as Partial<HostHello>).build
        const kept = keptFrame
        keptFrame = undefined
        if (engineBuild === buildId()) {
          kept?.remove()
          void answerHello(frame, attempt)
        } else if (kept) restartIn(frame, kept, attempt)
        else fromAnotherBuild(generation, engineBuild)
        return
      }
      const ready = event.data as Partial<EngineReady> | undefined
      if (ready?.type !== ENGINE_READY) return
      if (ready.error !== ENGINE_BUILD_MISMATCH && ready.attempt !== undefined && ready.attempt !== activeAttempt) {
        for (const port of event.ports) port.close()
        return
      }
      if (ready.error === ENGINE_BUILD_MISMATCH) {
        cleanupAll()
        engineCleanup = undefined
        fromAnotherBuild(generation, engineBuild)
        return
      }
      if (ready.error && isTransientLoadError(ready.error)) {
        for (const port of event.ports) port.close()
        if (current !== keptFrame) current.remove()
        current = undefined
        engineFrame = undefined
        scheduleRetry()
        return
      }
      cleanupAll()
      engineCleanup = undefined
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
    engineCleanup = cleanupAll
    launchAttempt()
  })
  return engine
}

export const resetEngine = () => invalidateEngine(engineGeneration, new Error('yt-client: engine reset'))
