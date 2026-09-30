import type { ApiFailure } from '@/lib/api/gateway'
import type { CacheStore, CacheWriteFailure } from '@/lib/playback/ports'

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
      return { kind: 'rate_limited', retryAfterSeconds: undefined, scope: 'unknown' }
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
