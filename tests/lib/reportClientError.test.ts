import { describe, test, expect, beforeEach, vi } from 'vitest'
import { reportClientError } from '@/lib/reportClientError'

// issue #83: クライアントエラーを backend /client-errors（BFF 経由）へ送る。

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('reportClientError', () => {
  test('BFF 経由で POST /api/backend/client-errors に送る', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    reportClientError({ source: 'web', kind: 'render', message: 'boom' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(path).toBe('/api/backend/client-errors')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(JSON.parse(init.body as string)).toEqual({ source: 'web', kind: 'render', message: 'boom' })
  })

  test('送信失敗（reject）でも例外を投げない', () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
    expect(() => reportClientError({ source: 'web', kind: 'window', message: 'x' })).not.toThrow()
  })

  test('fetch 自体が throw しても握りつぶす', () => {
    vi.stubGlobal('fetch', vi.fn(() => {
      throw new Error('sync throw')
    }))
    expect(() => reportClientError({ source: 'web', kind: 'global' })).not.toThrow()
  })
})
