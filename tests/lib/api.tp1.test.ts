// TP1（createApiClient 互換 adapter）のピン。
// 対応: reports/plan.md G0-1・A3-1、reports/spec.md T-W6・T-W7・T-W20。
// T-W7・T-W20 は公開形（SG-W11）・TP1 の経路（SG-W12）・名前（SG-W13）に依存しない、
// 現行コード（lib/api.ts の request()）で green のピン。A3（TP1 の gateway 化）の後も
// 無変更で green のままであることが SR-5（204 の逆変換）・SR-6（body の二重エンコード）の
// 回帰検出になる（spec.md §3.4 の注記）。
// T-W6（verifies: [CI-W6, CI-T13]）は現行コードに deadline が無いため RED（A3-1・SR-7）。
// GREEN にするのは implement（A3-2）で TP1 を gateway 経由の deadline 付きに置き換えたとき。
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApiClient, ApiError } from '@/lib/api'

function makeClient() {
  return createApiClient()
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('TP1 pin: verifies: [CI-W6, CI-T13]', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('30 秒応答が無い場合は ApiError(0, "Network error") で reject する（RED: 現行 request() に deadline が無い）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise(() => {
        // 永久に pending（signal を無視する fetch を模擬）
      })),
    )

    const pending = makeClient().getFeed()
    const assertion = expect(pending).rejects.toMatchObject(
      expect.objectContaining(new ApiError(0, 'Network error')) as object,
    )
    await vi.advanceTimersByTimeAsync(30_000)
    await assertion
  })
})

describe('TP1 pin: verifies: [CI-W7]', () => {
  test('200 で本文が JSON として読めない場合は parse エラーで reject する（ApiError ではない）', async () => {
    const parseError = new SyntaxError('Unexpected token in JSON')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(parseError),
        text: () => Promise.resolve('not json'),
      }),
    )

    await expect(makeClient().getFeed()).rejects.toBe(parseError)
  })

  test('204 は json() を呼ばずに undefined で resolve する', async () => {
    const json = vi.fn(() => Promise.reject(new Error('must not parse JSON body on 204 No Content')))
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json,
        text: () => Promise.resolve(''),
      }),
    )

    await expect(makeClient().deleteAccount('current-pw')).resolves.toBeUndefined()
    expect(json).not.toHaveBeenCalled()
  })
})

describe('TP1 pin: verifies: [CI-W20]', () => {
  test('body ありの操作は JSON 文字列 1 回だけエンコードして fetch に渡す（二重エンコードしない）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve('{}'),
    })
    vi.stubGlobal('fetch', fetchMock)

    await makeClient().updatePosition('a', 150)

    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(typeof init.body).toBe('string')
    expect(JSON.parse(init.body as string)).toEqual({ position_seconds: 150 })
  })

  test('body なしの操作は init.body が undefined のまま fetch に渡る', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ articles: [] }),
      text: () => Promise.resolve('{"articles":[]}'),
    })
    vi.stubGlobal('fetch', fetchMock)

    await makeClient().getFeed()

    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.body).toBeUndefined()
  })
})
