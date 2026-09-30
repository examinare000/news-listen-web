// 本番 adapter（lib/platform/*）の契約テスト。
// 対象: createBrowserCacheStore（caches ＋ fetch）・createBrowserKeyValueStore（localStorage）。
// createBrowserAudioElement は jsdom に Audio 実装が無いため実行テスト対象外（typecheck が oracle）。
//
// putFromUrl の失敗写像は BFF gateway（lib/api/gateway.ts）の statusToFailure と同じ表。
// 差は 2 点のみ: detail を本文から読まない（validation は detail ''）、Retry-After を解釈しない。
//
// RED 理由: `@/lib/platform/cacheStore`・`@/lib/platform/keyValueStore` がまだ存在しない。
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'
import { createBrowserCacheStore } from '@/lib/platform/cacheStore'
import { createBrowserKeyValueStore } from '@/lib/platform/keyValueStore'
import { setupMockCaches } from '../../helpers/mockCaches'

const URL_A = 'https://storage.example.com/a.mp3'
const CACHE = 'audio-v1'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('createBrowserCacheStore', () => {
  test('caches が未定義なら null（unsupported を境界で一度だけ表す）', () => {
    expect(typeof caches).toBe('undefined')
    expect(createBrowserCacheStore()).toBeNull()
  })

  test('open / has / keys / delete を caches へ委譲する', async () => {
    setupMockCaches()
    const store = createBrowserCacheStore()
    expect(store).not.toBeNull()
    await store!.open('x')
    expect(await store!.has('x')).toBe(true)
    expect(await store!.keys()).toContain('x')
    expect(await store!.delete('x')).toBe(true)
    expect(await store!.has('x')).toBe(false)
  })
})

describe('CacheStore#putFromUrl（gateway と同じ写像）', () => {
  let mock: ReturnType<typeof setupMockCaches>
  beforeEach(() => {
    mock = setupMockCaches()
  })

  const stubFetch = (impl: (url: string) => Promise<Response>) => {
    const f = vi.fn(impl)
    vi.stubGlobal('fetch', f)
    return f
  }
  const storedText = async () => (await (await mock.open(CACHE)).match('k'))?.text()

  test('200: 応答を key で格納して { ok: true, value: undefined }', async () => {
    const f = stubFetch(() => Promise.resolve(new Response('audio-bytes', { status: 200 })))
    const result = await createBrowserCacheStore()!.putFromUrl(CACHE, 'k', URL_A)
    expect(result).toEqual({ ok: true, value: undefined })
    expect(f.mock.calls[0][0]).toBe(URL_A)
    expect(await storedText()).toBe('audio-bytes')
  })

  const table: Array<[number, unknown]> = [
    [401, { kind: 'unauthorized' }],
    [403, { kind: 'forbidden' }],
    [404, { kind: 'not_found' }],
    [409, { kind: 'conflict' }],
    [429, { kind: 'rate_limited', retryAfterSeconds: undefined, scope: 'unknown' }],
    [400, { kind: 'validation', detail: '' }],
    [422, { kind: 'validation', detail: '' }],
    [503, { kind: 'server', status: 503 }],
    [418, { kind: 'unknown', status: 418 }],
  ]

  test.each(table)('gateway と同じ写像: 非 ok %s → download_failed（格納しない・reject しない）', async (status, failure) => {
    stubFetch(() => Promise.resolve(new Response('err', { status })))
    const result = await createBrowserCacheStore()!.putFromUrl(CACHE, 'k', URL_A)
    expect(result).toEqual({ ok: false, failure: { kind: 'download_failed', failure } })
    expect(await storedText()).toBeUndefined()
  })

  test('fetch が reject → download_failed(network)（reject しない・格納しない）', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    const result = await createBrowserCacheStore()!.putFromUrl(CACHE, 'k', URL_A)
    expect(result).toEqual({
      ok: false,
      failure: { kind: 'download_failed', failure: { kind: 'network' } },
    })
    expect(await storedText()).toBeUndefined()
  })

  test('格納時の QuotaExceededError → storage_full', async () => {
    stubFetch(() => Promise.resolve(new Response('audio-bytes', { status: 200 })))
    const bucket = await mock.open(CACHE)
    vi.spyOn(bucket, 'put').mockRejectedValue(Object.assign(new Error('quota'), { name: 'QuotaExceededError' }))
    const result = await createBrowserCacheStore()!.putFromUrl(CACHE, 'k', URL_A)
    expect(result).toEqual({ ok: false, failure: { kind: 'storage_full' } })
  })

  test('格納時のその他の例外 → download_failed(network)（reject しない）', async () => {
    stubFetch(() => Promise.resolve(new Response('audio-bytes', { status: 200 })))
    const bucket = await mock.open(CACHE)
    vi.spyOn(bucket, 'put').mockRejectedValue(new Error('disk error'))
    const result = await createBrowserCacheStore()!.putFromUrl(CACHE, 'k', URL_A)
    expect(result).toEqual({
      ok: false,
      failure: { kind: 'download_failed', failure: { kind: 'network' } },
    })
  })
})

describe('createBrowserKeyValueStore', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  test('set / get / remove の往復', () => {
    const kv = createBrowserKeyValueStore()
    expect(kv.get('k')).toBeNull()
    expect(kv.set('k', 'v')).toBe(true)
    expect(kv.get('k')).toBe('v')
    kv.remove('k')
    expect(kv.get('k')).toBeNull()
  })

  test('Web Storage が例外を投げても get→null・set→false・remove→例外なし', () => {
    const kv = createBrowserKeyValueStore()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(kv.get('k')).toBeNull()
    expect(kv.set('k', 'v')).toBe(false)
    expect(() => kv.remove('k')).not.toThrow()
  })
})
