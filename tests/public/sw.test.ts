import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupMockCaches } from '../helpers/mockCaches'

/**
 * public/sw.js の振る舞いテスト（issue #167）。
 *
 * sw.js はブラウザの ServiceWorkerGlobalScope 前提のプレーンスクリプトで、import すると
 * トップレベルで `self.addEventListener(...)` が実行され listener が登録される。
 * そこで `self` / `caches` / `clients` / `fetch` をグローバルスタブに差し替えてから
 * 動的 import し、キャプチャしたハンドラへ合成イベントを流して分岐を検証する。
 *
 * `vi.resetModules()` を毎回呼ぶことで、テストごとに新しい fake self へ向けて
 * sw.js を再評価させ、listener の登録をやり直させている（さもないとモジュールキャッシュにより
 * 最初のテストの fake self にしか listener が登録されない）。
 */

interface FakeSelf {
  addEventListener: (type: string, handler: (event: unknown) => void) => void
  listeners: Map<string, Array<(event: unknown) => void>>
  registration: { showNotification: ReturnType<typeof vi.fn> }
  location: { origin: string }
}

function createFakeSelf(): FakeSelf {
  const listeners = new Map<string, Array<(event: unknown) => void>>()
  return {
    addEventListener: (type, handler) => {
      if (!listeners.has(type)) listeners.set(type, [])
      listeners.get(type)!.push(handler)
    },
    listeners,
    registration: { showNotification: vi.fn() },
    location: { origin: 'https://app.example.com' },
  }
}

async function loadSw(fakeSelf: FakeSelf) {
  vi.stubGlobal('self', fakeSelf)
  vi.resetModules()
  // sw.js is registered via `navigator.serviceWorker.register('/sw.js')` (no
  // `{ type: 'module' }`), so it must stay a classic script with no import/export —
  // TS therefore sees it as "not a module" (TS2306) even though Vite happily loads
  // it as one for this dynamic import. The mismatch is a static-analysis artifact only.
  // @ts-expect-error TS2306 — see comment above
  await import('../../public/sw.js')
}

function dispatch(fakeSelf: FakeSelf, type: string, event: unknown) {
  for (const handler of fakeSelf.listeners.get(type) ?? []) {
    handler(event)
  }
}

// fetch イベントハンドラは request.url / .method / .mode しか参照しないため、
// 実 Request を組み立てず duck-typed なオブジェクトで合成する。
function fakeRequest(url: string, init: { method?: string; mode?: string } = {}) {
  return { url, method: init.method ?? 'GET', mode: init.mode ?? 'no-cors' }
}

describe('public/sw.js', () => {
  let fakeSelf: FakeSelf

  beforeEach(async () => {
    setupMockCaches()
    fakeSelf = createFakeSelf()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('activate', () => {
    test('deletes cache names that are not part of the current SW_VERSION generation', async () => {
      await loadSw(fakeSelf)
      await caches.open('shell-static-v0-old')
      await caches.open('shell-static-v1')

      const waitUntilCalls: Promise<unknown>[] = []
      dispatch(fakeSelf, 'activate', { waitUntil: (p: Promise<unknown>) => waitUntilCalls.push(p) })
      await Promise.all(waitUntilCalls)

      await expect(caches.has('shell-static-v0-old')).resolves.toBe(false)
      await expect(caches.has('shell-static-v1')).resolves.toBe(true)
    })

    // review指摘1（must-fix）: audio-v1 は lib/audioCache.ts が単独管理する別名前空間であり、
    // shell/api の世代交代（SW_VERSION 更新）の対象外でなければならない。
    // CURRENT_CACHES に無い名前を無差別に消す実装だと、SW_VERSION を上げた瞬間に
    // ダウンロード済みオフライン音声が丸ごと消えてしまう。
    test('does not delete the audio-v1 cache even though it is absent from CURRENT_CACHES', async () => {
      await loadSw(fakeSelf)
      await caches.open('audio-v1')
      await caches.open('shell-static-v0-old')

      const waitUntilCalls: Promise<unknown>[] = []
      dispatch(fakeSelf, 'activate', { waitUntil: (p: Promise<unknown>) => waitUntilCalls.push(p) })
      await Promise.all(waitUntilCalls)

      await expect(caches.has('audio-v1')).resolves.toBe(true)
      // 既存の世代交代ロジック（shell- 名前空間内の削除）は維持されていることも合わせて確認する。
      await expect(caches.has('shell-static-v0-old')).resolves.toBe(false)
    })
  })

  describe('fetch — /_next/static/* (cache-first)', () => {
    test('serves from network and populates the cache on a miss', async () => {
      await loadSw(fakeSelf)
      const networkResponse = new Response('body', { status: 200 })
      const fetchMock = vi.fn(() => Promise.resolve(networkResponse))
      vi.stubGlobal('fetch', fetchMock)

      const request = fakeRequest('https://app.example.com/_next/static/chunk.js')
      let respondWithPromise: Promise<unknown> | undefined
      dispatch(fakeSelf, 'fetch', {
        request,
        respondWith: (p: Promise<unknown>) => {
          respondWithPromise = p
        },
      })
      await respondWithPromise

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const cache = await caches.open('shell-static-v1')
      await expect(cache.match(request.url)).resolves.toBeDefined()
    })

    test('serves from cache without hitting the network on a hit', async () => {
      await loadSw(fakeSelf)
      const cache = await caches.open('shell-static-v1')
      await cache.put('https://app.example.com/_next/static/chunk.js', new Response('cached'))
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      const request = fakeRequest('https://app.example.com/_next/static/chunk.js')
      let respondWithPromise: Promise<unknown> | undefined
      dispatch(fakeSelf, 'fetch', {
        request,
        respondWith: (p: Promise<unknown>) => {
          respondWithPromise = p
        },
      })
      await respondWithPromise

      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('fetch — navigation requests (network-first)', () => {
    test('caches the fresh network response', async () => {
      await loadSw(fakeSelf)
      const networkResponse = new Response('<html/>', { status: 200 })
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(networkResponse)))

      const request = fakeRequest('https://app.example.com/feed', { mode: 'navigate' })
      let respondWithPromise: Promise<unknown> | undefined
      dispatch(fakeSelf, 'fetch', {
        request,
        respondWith: (p: Promise<unknown>) => {
          respondWithPromise = p
        },
      })
      await respondWithPromise

      const cache = await caches.open('shell-pages-v1')
      await expect(cache.match(request.url)).resolves.toBeDefined()
    })

    test('falls back to the cache when the network fails', async () => {
      await loadSw(fakeSelf)
      const request = fakeRequest('https://app.example.com/feed', { mode: 'navigate' })
      const cache = await caches.open('shell-pages-v1')
      await cache.put(request.url, new Response('<html>cached page</html>'))
      vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))

      let respondWithPromise: Promise<Response> | undefined
      dispatch(fakeSelf, 'fetch', {
        request,
        respondWith: (p: Promise<Response>) => {
          respondWithPromise = p
        },
      })
      const response = await respondWithPromise
      expect(await response!.text()).toBe('<html>cached page</html>')
    })
  })

  describe('fetch — GET /api/backend/podcasts (network-first)', () => {
    test('caches the fresh podcast list response', async () => {
      await loadSw(fakeSelf)
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{"podcasts":[]}'))))

      const request = fakeRequest('https://app.example.com/api/backend/podcasts')
      let respondWithPromise: Promise<unknown> | undefined
      dispatch(fakeSelf, 'fetch', {
        request,
        respondWith: (p: Promise<unknown>) => {
          respondWithPromise = p
        },
      })
      await respondWithPromise

      const cache = await caches.open('api-v1')
      await expect(cache.match(request.url)).resolves.toBeDefined()
    })
  })

  describe('fetch — passthrough (SW does not intercept)', () => {
    test('cross-origin requests (e.g. signed audio URLs) are left untouched', async () => {
      await loadSw(fakeSelf)
      const request = fakeRequest('https://storage.example.com/signed/episode.mp3')
      const respondWith = vi.fn()
      dispatch(fakeSelf, 'fetch', { request, respondWith })

      expect(respondWith).not.toHaveBeenCalled()
    })

    test('/_audio/ and /_audio-meta/ requests are left untouched (owned by lib/audioCache.ts)', async () => {
      await loadSw(fakeSelf)
      const respondWith = vi.fn()

      dispatch(fakeSelf, 'fetch', { request: fakeRequest('https://app.example.com/_audio/p1'), respondWith })
      dispatch(fakeSelf, 'fetch', { request: fakeRequest('https://app.example.com/_audio-meta/p1'), respondWith })

      expect(respondWith).not.toHaveBeenCalled()
    })
  })

  describe('push (regression — issue #167 introduces the first test coverage)', () => {
    test('shows a notification with title/body/url from the push payload', async () => {
      await loadSw(fakeSelf)
      const waitUntilCalls: Promise<unknown>[] = []
      dispatch(fakeSelf, 'push', {
        data: { json: () => ({ title: 'T', body: 'B', url: '/feed' }) },
        waitUntil: (p: Promise<unknown>) => waitUntilCalls.push(p),
      })
      await Promise.all(waitUntilCalls)

      expect(fakeSelf.registration.showNotification).toHaveBeenCalledWith(
        'T',
        expect.objectContaining({ body: 'B', data: { url: '/feed' } }),
      )
    })

    test('falls back to defaults when there is no payload', async () => {
      await loadSw(fakeSelf)
      const waitUntilCalls: Promise<unknown>[] = []
      dispatch(fakeSelf, 'push', { data: null, waitUntil: (p: Promise<unknown>) => waitUntilCalls.push(p) })
      await Promise.all(waitUntilCalls)

      expect(fakeSelf.registration.showNotification).toHaveBeenCalledWith(
        'News Listen',
        expect.objectContaining({ body: '新しいニュースがあります', data: { url: '/' } }),
      )
    })

    test('falls back to defaults when the payload is not valid JSON', async () => {
      await loadSw(fakeSelf)
      const waitUntilCalls: Promise<unknown>[] = []
      dispatch(fakeSelf, 'push', {
        data: {
          json: () => {
            throw new Error('invalid JSON')
          },
        },
        waitUntil: (p: Promise<unknown>) => waitUntilCalls.push(p),
      })
      await Promise.all(waitUntilCalls)

      expect(fakeSelf.registration.showNotification).toHaveBeenCalledWith(
        'News Listen',
        expect.objectContaining({ body: '新しいニュースがあります' }),
      )
    })
  })

  describe('notificationclick (regression)', () => {
    test('focuses an existing window already at the target URL', async () => {
      await loadSw(fakeSelf)
      const existingClient = { url: 'https://app.example.com/feed', focus: vi.fn(() => Promise.resolve()) }
      vi.stubGlobal('clients', {
        matchAll: vi.fn(() => Promise.resolve([existingClient])),
        openWindow: vi.fn(),
      })

      const notification = { close: vi.fn(), data: { url: '/feed' } }
      const waitUntilCalls: Promise<unknown>[] = []
      dispatch(fakeSelf, 'notificationclick', {
        notification,
        waitUntil: (p: Promise<unknown>) => waitUntilCalls.push(p),
      })
      await Promise.all(waitUntilCalls)

      expect(notification.close).toHaveBeenCalled()
      expect(existingClient.focus).toHaveBeenCalled()
    })

    test('opens a new window when there is no existing client', async () => {
      await loadSw(fakeSelf)
      const openWindow = vi.fn()
      vi.stubGlobal('clients', { matchAll: vi.fn(() => Promise.resolve([])), openWindow })

      const notification = { close: vi.fn(), data: { url: '/feed' } }
      const waitUntilCalls: Promise<unknown>[] = []
      dispatch(fakeSelf, 'notificationclick', {
        notification,
        waitUntil: (p: Promise<unknown>) => waitUntilCalls.push(p),
      })
      await Promise.all(waitUntilCalls)

      expect(openWindow).toHaveBeenCalledWith('https://app.example.com/feed')
    })
  })
})
