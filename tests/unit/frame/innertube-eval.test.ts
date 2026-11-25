import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { Platform } from 'youtubei.js/web'

const decipher = vi.fn(async (_script: string) => ({ n: 'from-agent', sig: 'agent-sig' }))

vi.mock('../../../src/frame/agent', () => ({
  engineAgent: () => ({ decipher }),
  reportEngine: () => {},
}))

describe('Platform.shim.eval', () => {
  beforeEach(() => {
    vi.resetModules()
    decipher.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('evaluates directly outside CSP/sandbox origins without invoking the agent', async () => {
    vi.stubGlobal('location', { hostname: 'youtube.fkn.app' })
    await import('../../../src/frame/innertube')
    const result = await Platform.shim.eval({ output: 'return { n: "direct" }' } as never, {})
    expect(result).toEqual({ n: 'direct' })
    expect(decipher).not.toHaveBeenCalled()
  })

  it('falls back to the attached page agent when Function construction raises EvalError under CSP', async () => {
    vi.stubGlobal('location', { hostname: '127.0.0.1' })
    const RealFunction = globalThis.Function
    vi.stubGlobal('Function', function BlockedFunction() {
      throw new EvalError("Refused to evaluate a string as JavaScript because 'unsafe-eval' is not allowed")
    } as unknown as FunctionConstructor)
    await import('../../../src/frame/innertube')
    const result = await Platform.shim.eval({ output: 'return { n: "csp" }' } as never, {})
    expect(result).toEqual({ n: 'from-agent', sig: 'agent-sig' })
    expect(decipher).toHaveBeenCalledWith('return { n: "csp" }')
    vi.stubGlobal('Function', RealFunction)
  })

  it('routes sdbx.app tenant origins straight to the page agent without attempting Function evaluation', async () => {
    vi.stubGlobal('location', { hostname: '0abc123.sdbx.app' })
    const spy = vi.fn()
    vi.stubGlobal('Function', spy as unknown as FunctionConstructor)
    await import('../../../src/frame/innertube')
    const result = await Platform.shim.eval({ output: 'return { n: "sdbx" }' } as never, {})
    expect(result).toEqual({ n: 'from-agent', sig: 'agent-sig' })
    expect(spy).not.toHaveBeenCalled()
    expect(decipher).toHaveBeenCalledWith('return { n: "sdbx" }')
  })
})
