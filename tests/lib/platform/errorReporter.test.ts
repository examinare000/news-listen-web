import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { createErrorReporter } from '@/lib/platform/errorReporter'
import type { ClientErrorReport } from '@/lib/platform/application/errorReporting'
import { createGateway } from '@/lib/api/gateway'
import type { ApiFailure, ApiGateway, GatewayJsonRequest, GatewayNoContentRequest, GatewayRequest, Result } from '@/lib/api/gateway'

// web-usecase-21: エラー通報を ApiGateway 経由で送る adapter（fire-and-forget・失敗は握る）。

const PATH = '/api/backend/client-errors'

interface RecordedCall {
  path: string
  init: GatewayRequest | undefined
}

// double（createGatewayDouble）は init 全体を記録しないので、keepalive・noContent を見るため手書きする。
function recordingGateway(
  respond: () => Promise<Result<unknown, ApiFailure>> = () => Promise.resolve({ ok: true, value: undefined }),
): ApiGateway & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  function request(path: string, init: GatewayNoContentRequest): Promise<Result<void, ApiFailure>>
  function request<T>(path: string, init?: GatewayJsonRequest): Promise<Result<T, ApiFailure>>
  function request(path: string, init?: GatewayRequest): Promise<Result<unknown, ApiFailure>> {
    calls.push({ path, init })
    return respond()
  }
  return { calls, request }
}

function bodyOf(call: RecordedCall): ClientErrorReport {
  return call.init?.body as ClientErrorReport
}

const baseReport: ClientErrorReport = { source: 'web', kind: 'render', message: 'boom', context: { digest: 'd1' } }

describe('createErrorReporter — web-usecase-21', () => {
  test('gateway.request を path・POST・keepalive・noContent 付きでちょうど 1 回呼ぶ', () => {
    const gw = recordingGateway()

    createErrorReporter(gw)(baseReport)

    expect(gw.calls).toHaveLength(1)
    expect(gw.calls[0].path).toBe(PATH)
    expect(gw.calls[0].init).toEqual({ method: 'POST', body: baseReport, keepalive: true, noContent: true })
  })

  test('message が 4001 字のとき先頭 4000 字に切り詰めて送る', () => {
    const gw = recordingGateway()
    const message = 'a'.repeat(4000) + 'b'

    createErrorReporter(gw)({ source: 'web', kind: 'window', message })

    expect(bodyOf(gw.calls[0]).message).toBe('a'.repeat(4000))
  })

  test('message がちょうど 4000 字のときは変えずに送る', () => {
    const gw = recordingGateway()
    const message = 'c'.repeat(4000)

    createErrorReporter(gw)({ source: 'web', kind: 'window', message })

    expect(bodyOf(gw.calls[0]).message).toBe(message)
  })

  test('message が無い report には message key を足さない', () => {
    const gw = recordingGateway()

    createErrorReporter(gw)({ source: 'web', kind: 'global' })

    expect('message' in (bodyOf(gw.calls[0]) as object)).toBe(false)
  })

  test('切り詰めても呼び手の report object を書き換えない', () => {
    const gw = recordingGateway()
    const report: ClientErrorReport = { source: 'web', kind: 'render', message: 'x'.repeat(4001) }

    createErrorReporter(gw)(report)

    expect(report.message).toHaveLength(4001)
    expect(Object.keys(report).sort()).toEqual(['kind', 'message', 'source'])
  })

  test('request が失敗の Result に解決しても throw せず undefined を返す', () => {
    const gw = recordingGateway(() => Promise.resolve({ ok: false, failure: { kind: 'server', status: 500 } }))

    let returned: unknown = 'unset'
    expect(() => {
      returned = createErrorReporter(gw)(baseReport)
    }).not.toThrow()
    expect(returned).toBeUndefined()
  })

  describe('未処理の reject を残さない', () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason)
    }

    beforeEach(() => {
      unhandled.length = 0
      process.on('unhandledRejection', onUnhandled)
    })
    afterEach(() => {
      process.off('unhandledRejection', onUnhandled)
      vi.unstubAllGlobals()
    })

    const nextMacrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

    test('request が reject しても throw せず、unhandledRejection を残さない', async () => {
      const gw = recordingGateway(() => Promise.reject(new Error('rejected')))

      expect(() => createErrorReporter(gw)(baseReport)).not.toThrow()
      await nextMacrotask()

      expect(unhandled).toEqual([])
    })

    test('実物の gateway で fetch が同期 throw しても throw せず、unhandledRejection を残さない', async () => {
      vi.stubGlobal('fetch', vi.fn(() => {
        throw new Error('sync throw')
      }))

      expect(() => createErrorReporter(createGateway())(baseReport)).not.toThrow()
      await nextMacrotask()

      expect(unhandled).toEqual([])
    })
  })

  test('request が同期で throw しても握る', () => {
    const throwing: ApiGateway = {
      request: () => {
        throw new Error('sync request throw')
      },
    }

    expect(() => createErrorReporter(throwing)(baseReport)).not.toThrow()
  })

  describe('実物の gateway と組む', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    test('fetch に path・POST・credentials・keepalive・Content-Type・JSON の body が渡る', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202, json: () => Promise.resolve({}), headers: { get: () => null } })
      vi.stubGlobal('fetch', fetchMock)

      createErrorReporter(createGateway())(baseReport)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(path).toBe(PATH)
      expect(init.method).toBe('POST')
      expect(init.credentials).toBe('include')
      expect(init.keepalive).toBe(true)
      expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
      expect(JSON.parse(init.body as string)).toEqual(baseReport)
    })

    test('fetch が reject しても throw しない', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))

      expect(() => createErrorReporter(createGateway())(baseReport)).not.toThrow()
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    })
  })

  test('同じ report を 2 回呼ぶと 2 回送る（重複排除しない）', () => {
    const gw = recordingGateway()
    const report = createErrorReporter(gw)

    report(baseReport)
    report(baseReport)

    expect(gw.calls).toHaveLength(2)
  })
})
