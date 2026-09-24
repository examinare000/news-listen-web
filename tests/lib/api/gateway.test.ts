// ApiGateway（Result 化・deadline）の契約テスト。
// 対応: reports/spec.md §3.4 T-T12-1〜8・T-T13-1〜3・T-W9、reports/plan.md A1-1・A2-1。
// verifies: CI-T12, verifies: CI-T13, verifies: [CI-W9]
//
// RED 理由: `@/lib/api/gateway` がまだ存在しない（本 step ではプロダクションコードを作らない）。
// 呼出し式は spec §3.0 の束縛（createGw() = createGateway()）に従う。
//
// このファイルには互換 adapter（TP1）を指す既存 module の関数名・例外クラス名の文字列を
// コメントを含めて書かない（CI-W8 第 8 版・T-W8 (5)）。
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { createGateway } from '@/lib/api/gateway'
import type { ApiFailure, ApiGateway, GatewayRequest, Result } from '@/lib/api/gateway'

const RAW_KEY = Symbol.for('news-listen.web.gateway.raw')

function makeGateway() {
  return createGateway()
}

function okResponse(body: unknown, status = 200) {
  return {
    ok: true,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: { get: () => null },
  }
}

function errorResponse(status: number, body: unknown, retryAfter: string | null = null) {
  return {
    ok: false,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: { get: (k: string) => (k === 'Retry-After' ? retryAfter : null) },
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

// ==========================================================
// T-T12-1〜7: verifies: CI-T12
// ==========================================================
describe('ApiGateway.request — verifies: CI-T12', () => {
  test.each([
    ['401', 401, 'unauthorized'],
    ['403', 403, 'forbidden'],
    ['404', 404, 'not_found'],
    ['409', 409, 'conflict'],
    ['400', 400, 'validation'],
    ['422', 422, 'validation'],
    ['500', 500, 'server'],
    ['503', 503, 'server'],
    ['418', 418, 'unknown'],
  ] as const)('T-T12-1 (%s): status→kind の写像（verifies: CI-T12-2）', async (_label, status, kind) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(status, { detail: 'x' })))

    const r = await makeGateway().request('/api/backend/x')

    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.failure.kind).toBe(kind)
      if (kind === 'server' || kind === 'unknown') {
        expect((r.failure as { status: number }).status).toBe(status)
      }
      if (kind === 'validation') {
        expect((r.failure as { detail: string }).detail).toBe('x')
      }
    }
  })

  test('T-T12-2: 422 の detail 抽出規則（verifies: CI-T12-2）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(errorResponse(422, { detail: [{ msg: 'Value error, bad' }] })),
    )
    const r1 = await makeGateway().request('/api/backend/x', { method: 'POST', body: {} })
    expect(r1.ok).toBe(false)
    if (!r1.ok) expect((r1.failure as { detail: string }).detail).toBe('bad')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(422, { detail: 'plain' })))
    const r2 = await makeGateway().request('/api/backend/x', { method: 'POST', body: {} })
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect((r2.failure as { detail: string }).detail).toBe('plain')

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: () => Promise.reject(new SyntaxError('bad json')),
        text: () => Promise.resolve('not json'),
        headers: { get: () => null },
      }),
    )
    const r3 = await makeGateway().request('/api/backend/x', { method: 'POST', body: {} })
    expect(r3.ok).toBe(false)
    if (!r3.ok) expect((r3.failure as { detail: string }).detail).toBe('Unknown error')
  })

  test('T-T12-2 (null 本文): 非 2xx で json() が null でも reject せず Result になる（verifies: CI-T12-1, CI-T12-2）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(422, null)))
    const r = await makeGateway().request('/api/backend/x', { method: 'POST', body: {} })
    expect(r).toEqual({ ok: false, failure: { kind: 'validation', detail: 'Unknown error' } })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(500, null)))
    const r500 = await makeGateway().request('/api/backend/x')
    expect(r500).toEqual({ ok: false, failure: { kind: 'server', status: 500 } })
  })

  test('T-T12-3: 429 の retryAfterSeconds・scope（verifies: CI-T12-3）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(errorResponse(429, { detail: 'too many' }, '30')),
    )
    const withRetry = await makeGateway().request('/api/backend/x', { method: 'POST', body: {} })
    expect(withRetry.ok).toBe(false)
    if (!withRetry.ok) {
      expect(withRetry.failure.kind).toBe('rate_limited')
      if (withRetry.failure.kind === 'rate_limited') {
        expect(withRetry.failure.retryAfterSeconds).toBe(30)
        expect(withRetry.failure.scope).toBe('unknown')
      }
    }

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(429, { detail: 'too many' }, null)))
    const noHeader = await makeGateway().request('/api/backend/x', { method: 'POST', body: {} })
    expect(noHeader.ok).toBe(false)
    if (!noHeader.ok && noHeader.failure.kind === 'rate_limited') {
      expect(noHeader.failure.retryAfterSeconds).toBeUndefined()
    }

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(errorResponse(429, { detail: 'too many' }, 'Wed, 21 Oct 2015 07:28:00 GMT')),
    )
    const nonNumeric = await makeGateway().request('/api/backend/x', { method: 'POST', body: {} })
    expect(nonNumeric.ok).toBe(false)
    if (!nonNumeric.ok && nonNumeric.failure.kind === 'rate_limited') {
      expect(nonNumeric.failure.retryAfterSeconds).toBeUndefined()
    }
  })

  test('T-T12-4: fetch の reject は throw せず network の Result になる（verifies: CI-T12-1, CI-T12-2）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const r = await makeGateway().request('/api/backend/x')

    expect(r).toEqual({ ok: false, failure: { kind: 'network' } })
  })

  test('T-T12-5 (1): noContent の 204 は ok(undefined) で json は呼ばれない（verifies: CI-T12-4）', async () => {
    const json = vi.fn(() => Promise.reject(new Error('must not be called')))
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 204, json, text: () => Promise.resolve(''), headers: { get: () => null } }),
    )
    const r = await makeGateway().request('/api/backend/x', { method: 'DELETE', noContent: true })
    expect(r).toEqual({ ok: true, value: undefined })
    expect(json).not.toHaveBeenCalled()
  })

  test('T-T12-5 (2): noContent なしの 204 は unknown(204) の失敗で json は呼ばれない（verifies: CI-T12-4）', async () => {
    const json = vi.fn(() => Promise.reject(new Error('must not be called')))
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 204, json, text: () => Promise.resolve(''), headers: { get: () => null } }),
    )
    const r = await makeGateway().request('/api/backend/x', { method: 'DELETE' })
    expect(r).toEqual({ ok: false, failure: { kind: 'unknown', status: 204 } })
    expect(json).not.toHaveBeenCalled()
  })

  test('T-T12-5 (3): noContent の 200(JSON本文あり) は本文を読まず ok(undefined)（verifies: CI-T12-4）', async () => {
    const json = vi.fn(() => Promise.resolve({ a: 1 }))
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json, text: () => Promise.resolve('{"a":1}'), headers: { get: () => null } }),
    )
    const r = await makeGateway().request('/api/backend/x', { method: 'POST', noContent: true })
    expect(r).toEqual({ ok: true, value: undefined })
    expect(json).not.toHaveBeenCalled()
  })

  test('T-T12-5 (4): noContent の 200(非JSON本文) も本文を読まず ok(undefined)（verifies: CI-T12-4）', async () => {
    const json = vi.fn(() => Promise.reject(new SyntaxError('bad')))
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json, text: () => Promise.resolve('not json'), headers: { get: () => null } }),
    )
    const r = await makeGateway().request('/api/backend/x', { method: 'POST', noContent: true })
    expect(r).toEqual({ ok: true, value: undefined })
    expect(json).not.toHaveBeenCalled()
  })

  test('T-T12-5 (5): noContent の非 2xx は OP-G1 と同じ写像（verifies: CI-T12-4）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(404, { detail: 'not found' })))
    const r = await makeGateway().request('/api/backend/x', { method: 'DELETE', noContent: true })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.failure.kind).toBe('not_found')
  })

  test('T-T12-6: 200 の JSON 本文は ok(value)、非 JSON は unknown(200)（verifies: CI-T12-5, CI-T12-1）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ hello: 'world' })))
    const ok = await makeGateway().request<{ hello: string }>('/api/backend/x')
    expect(ok).toEqual({ ok: true, value: { hello: 'world' } })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError('bad')),
        text: () => Promise.resolve('not json'),
        headers: { get: () => null },
      }),
    )
    const bad = await makeGateway().request('/api/backend/x')
    expect(bad).toEqual({ ok: false, failure: { kind: 'unknown', status: 200 } })
  })

  test('T-T12-7: 送信 init（CSRF・Content-Type・credentials・body）（verifies: CI-T12-6）', async () => {
    document.cookie = 'csrf_token=tok'
    const fetchMock = vi.fn().mockResolvedValue(okResponse({}))
    vi.stubGlobal('fetch', fetchMock)

    await makeGateway().request('/api/backend/x', { method: 'POST', body: { a: 1 } })
    const postInit = fetchMock.mock.calls[0][1] as RequestInit
    const postHeaders = postInit.headers as Record<string, string>
    expect(postHeaders['X-CSRF-Token']).toBe('tok')
    expect(postInit.body).toBe('{"a":1}')
    expect(postInit.credentials).toBe('include')
    expect(postHeaders['Content-Type']).toBe('application/json')

    fetchMock.mockClear()
    await makeGateway().request('/api/backend/x')
    const getInit = fetchMock.mock.calls[0][1] as RequestInit
    const getHeaders = getInit.headers as Record<string, string>
    expect(getHeaders['X-CSRF-Token']).toBeUndefined()

    fetchMock.mockClear()
    await makeGateway().request('/api/backend/x', { method: 'POST' })
    const noBodyInit = fetchMock.mock.calls[0][1] as RequestInit
    expect(noBodyInit.body).toBeUndefined()

    document.cookie = 'csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
  })
})

// ==========================================================
// T-T12-8: 型テスト（実行時には何も検査しない。npm run typecheck / typecheck:ts7 が判定する）
// verifies: [CI-T12-7, CI-T12-4]
// ==========================================================
describe('ApiGateway 型テスト（typecheck で判定）— verifies: [CI-T12-7, CI-T12-4]', () => {
  type Podcast = { id: string }

  // 呼ばれない関数。fetch を呼ばない。wide は引数で受ける（初期値付き変数は初期化で絞り込まれるため使わない）。
  async function typeOnly(g: ApiGateway, wide: GatewayRequest) {
    // @ts-expect-error (a) GatewayRequest は Result<T> の overload に届かない
    void g.request<Podcast>('/x', wide)
    // @ts-expect-error (a') 型引数なしでも GatewayRequest はどちらの overload にも代入できない
    void g.request('/x', wide)
    // @ts-expect-error (b) 型引数を明示した noContent: true は Result<T> に届かない
    void g.request<Podcast>('/x', { noContent: true })
    // @ts-expect-error (c) noContent: false はどちらの overload も受け付けない
    void g.request('/x', { noContent: false })

    const v: Result<void, ApiFailure> = await g.request('/x', { method: 'DELETE', noContent: true })
    const p: Result<Podcast, ApiFailure> = await g.request<Podcast>('/x', { method: 'POST', body: { a: 1 } })

    function wrapped(path: string, init: import('@/lib/api/gateway').GatewayNoContentRequest): Promise<Result<void, ApiFailure>>
    function wrapped<T>(path: string, init?: import('@/lib/api/gateway').GatewayJsonRequest): Promise<Result<T, ApiFailure>>
    function wrapped(path: string, init?: GatewayRequest): Promise<Result<unknown, ApiFailure>> {
      return init?.noContent === true ? g.request(path, init) : g.request<unknown>(path, init)
    }
    const w: ApiGateway = { request: wrapped }

    return { v, p, w }
  }

  test('型テスト（typecheck で判定）', () => {
    expect(typeof typeOnly).toBe('function')
  })

  test('ApiFailure の switch 網羅（never に落ちる型テスト）', () => {
    function assertNever(x: never): never {
      throw new Error(`unreachable: ${JSON.stringify(x)}`)
    }
    function describeFailure(f: ApiFailure): string {
      switch (f.kind) {
        case 'network':
        case 'timeout':
        case 'unauthorized':
        case 'forbidden':
        case 'conflict':
          return f.kind
        case 'not_found':
          return `not_found:${f.subject ?? ''}`
        case 'rate_limited':
          return `rate_limited:${f.scope}`
        case 'validation':
          return `validation:${f.detail}`
        case 'server':
        case 'unknown':
          return `${f.kind}:${f.status}`
        default:
          return assertNever(f)
      }
    }
    expect(describeFailure({ kind: 'network' })).toBe('network')
  })
})

// ==========================================================
// T-T13-1〜3: verifies: CI-T13
// ==========================================================
describe('ApiGateway.request — deadline — verifies: CI-T13', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('T-T13-1: 30,000ms で timeout に決着する。29,999ms では未解決（verifies: CI-T13-1, CI-T13-4）', async () => {
    let capturedSignal: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        capturedSignal = init?.signal ?? undefined
        return new Promise(() => {
          // 永久に pending（signal を無視する）
        })
      }),
    )

    let settled: Result<unknown, ApiFailure> | undefined
    const pending = makeGateway()
      .request('/api/backend/x')
      .then((r) => {
        settled = r
        return r
      })

    await vi.advanceTimersByTimeAsync(29_999)
    expect(settled).toBeUndefined()

    await vi.advanceTimersByTimeAsync(1)
    const r = await pending
    expect(r).toEqual({ ok: false, failure: { kind: 'timeout' } })
    expect(capturedSignal?.aborted).toBe(true)
  })

  test('T-T13-2: 応答ヘッダ受信後の本文読込停止でも 30,000ms で timeout（verifies: CI-T13-2）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => new Promise(() => {}),
        text: () => new Promise(() => {}),
        headers: { get: () => null },
      }),
    )

    const pending = makeGateway().request('/api/backend/x')
    await vi.advanceTimersByTimeAsync(30_000)
    const r = await pending
    expect(r).toEqual({ ok: false, failure: { kind: 'timeout' } })
  })

  test('T-T13-3: 決着後は deadline タイマーが残らない（verifies: CI-T13-3）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ ok: true })))
    await makeGateway().request('/api/backend/x')
    expect(vi.getTimerCount()).toBe(0)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(404, { detail: 'x' })))
    await makeGateway().request('/api/backend/x')
    expect(vi.getTimerCount()).toBe(0)

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await makeGateway().request('/api/backend/x')
    expect(vi.getTimerCount()).toBe(0)

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise(() => {})),
    )
    const timeoutPending = makeGateway().request('/api/backend/x')
    await vi.advanceTimersByTimeAsync(30_000)
    await timeoutPending
    expect(vi.getTimerCount()).toBe(0)
  })
})

// ==========================================================
// T-W9: 失敗オブジェクトの raw プロパティ（non-enumerable・呼出ごとに別オブジェクト）
// verifies: [CI-W9]
// ==========================================================
describe('ApiGateway 失敗オブジェクトの raw プロパティ — verifies: [CI-W9]', () => {
  test('404: raw は non-enumerable な own プロパティで、公開の Result には現れない', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(404, { detail: 'x' })))

    const r = await makeGateway().request('/api/backend/x')
    expect(r.ok).toBe(false)
    if (r.ok) return
    const failure = r.failure

    expect(Object.keys(failure)).toEqual(['kind'])
    expect(JSON.stringify(failure)).toBe('{"kind":"not_found"}')

    const descriptor = Object.getOwnPropertyDescriptor(failure, RAW_KEY)
    expect(descriptor?.enumerable).toBe(false)
    expect(descriptor?.value).toEqual({
      type: 'error',
      status: 404,
      detail: 'x',
      retryAfterSeconds: undefined,
    })
  })

  test('同じ応答で 2 回呼んだ失敗オブジェクトは別物（呼出ごとに新規生成）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(404, { detail: 'x' })))

    const r1 = await makeGateway().request('/api/backend/x')
    const r2 = await makeGateway().request('/api/backend/x')
    expect(r1.ok).toBe(false)
    expect(r2.ok).toBe(false)
    if (r1.ok || r2.ok) return
    expect(r1.failure).not.toBe(r2.failure)
  })

  test('成功時は raw の own プロパティを持たない', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ a: 1 })))

    const r = await makeGateway().request('/api/backend/x')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(Object.getOwnPropertyDescriptor(r, RAW_KEY)).toBeUndefined()
  })
})
