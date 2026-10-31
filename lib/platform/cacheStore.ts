import type { ApiFailure, Result } from '@/lib/api/gateway'

export interface CacheBucket {
  put(key: string, response: Response): Promise<void>
  match(key: string): Promise<Response | undefined>
  delete(key: string): Promise<boolean>
  keys(): Promise<ReadonlyArray<{ readonly url: string }>>
}

export type CacheWriteFailure =
  | { kind: 'download_failed'; failure: ApiFailure }
  | { kind: 'storage_full' }

export interface CacheStore {
  open(cacheName: string): Promise<CacheBucket>
  delete(cacheName: string): Promise<boolean>
  has(cacheName: string): Promise<boolean>
  keys(): Promise<ReadonlyArray<string>>
  /** URL の応答を取得し、成功時のみ key で格納する。失敗は reject せず Result で返す。 */
  putFromUrl(cacheName: string, key: string, url: string): Promise<Result<void, CacheWriteFailure>>
}

// gateway の statusToFailure と同じ表。gateway は音声 URL（署名付きストレージ）の
// エラー本文契約を持たないため detail は読まず、Retry-After も解釈しない。
function statusToFailure(status: number): ApiFailure {
  switch (status) {
    case 401:
      return { kind: 'unauthorized' }
    case 403:
      return { kind: 'forbidden' }
    case 404:
      return { kind: 'not_found' }
    case 409:
      return { kind: 'conflict' }
    case 429:
      // WHY: 音声 URL の取得の失敗は backend のエラー本文を持たない。validation の detail: '' と同じ扱い（web-dec-47）
      return { kind: 'rate_limited', retryAfterSeconds: undefined, scope: 'unknown', detail: '' }
    case 400:
    case 422:
      return { kind: 'validation', detail: '' }
    default:
      return status >= 500 && status <= 599 ? { kind: 'server', status } : { kind: 'unknown', status }
  }
}

const networkFailure: CacheWriteFailure = { kind: 'download_failed', failure: { kind: 'network' } }

/** Cache Storage が無い環境では null（unsupported をここで一度だけ表す）。 */
export function createBrowserCacheStore(): CacheStore | null {
  if (typeof caches === 'undefined') return null
  return {
    open: (cacheName) => caches.open(cacheName),
    delete: (cacheName) => caches.delete(cacheName),
    has: (cacheName) => caches.has(cacheName),
    keys: () => caches.keys(),
    async putFromUrl(cacheName, key, url) {
      let response: Response
      try {
        response = await fetch(url)
      } catch {
        return { ok: false, failure: networkFailure }
      }
      if (!response.ok) {
        return { ok: false, failure: { kind: 'download_failed', failure: statusToFailure(response.status) } }
      }
      try {
        const bucket = await caches.open(cacheName)
        await bucket.put(key, response)
        return { ok: true, value: undefined }
      } catch (e) {
        if (e instanceof Error && e.name === 'QuotaExceededError') {
          return { ok: false, failure: { kind: 'storage_full' } }
        }
        return { ok: false, failure: networkFailure }
      }
    },
  }
}
