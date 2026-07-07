/**
 * Service Worker: Web Push 通知 + PWA オフラインキャッシュ（issue #167）。
 *
 * 設計方針: 薄く保つ。
 * ロジックはクライアント側（hooks/useWebPushSubscription.ts, lib/audioCache.ts）に寄せており、
 * Service Worker は Push イベントの受信・通知表示と、shell/API のキャッシュ戦略配線のみを担当する。
 */

// バージョンを上げるとキャッシュ名が変わり、activate で旧世代がまとめて削除される。
const SW_VERSION = 'v1'
const STATIC_CACHE = `shell-static-${SW_VERSION}`
const PAGES_CACHE = `shell-pages-${SW_VERSION}`
const API_CACHE = `api-${SW_VERSION}`
const CURRENT_CACHES = new Set([STATIC_CACHE, PAGES_CACHE, API_CACHE])

// review指摘1: 世代交代の削除対象は SW が管理する「shell-」「api-」名前空間のみに限定する。
// 「CURRENT_CACHES に無い名前を無差別に消す」実装だと、SW とは無関係な audio-v1
// （lib/audioCache.ts が単独管理するオフライン音声キャッシュ）まで SW_VERSION 更新のたびに
// 消えてしまう。prefix ホワイトリストにすることで audio- 名前空間を構造的に保護する。
// lib/swCacheCleanup.ts 側にも同じ 'shell-' / 'api-' prefix が重複定義されている
// （sw.js はクラシックスクリプトのため import できない）。変更する際は両方を揃えること。
function isManagedBySW(name) {
  return name.startsWith('shell-') || name.startsWith('api-')
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => isManagedBySW(name) && !CURRENT_CACHES.has(name))
          .map((name) => caches.delete(name)),
      ),
    ),
  )
})

// キャッシュ未ヒット時のみネットワークへ。ハッシュ付きファイル名で不変な /_next/static/* 向け。
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request.url)
  if (cached) return cached
  const response = await fetch(request)
  if (response && response.ok) await cache.put(request.url, response.clone())
  return response
}

// 常に新鮮さを優先し、オフライン時のみ最後に成功したレスポンスへフォールバックする。
// ナビゲーションと GET /api/backend/podcasts（一覧）で使用。
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  try {
    const response = await fetch(request)
    if (response && response.ok) await cache.put(request.url, response.clone())
    return response
  } catch (err) {
    const cached = await cache.match(request.url)
    if (cached) return cached
    throw err
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)

  // クロスオリジン（署名付き音声 URL 等）は SW では扱わず素通し。
  if (url.origin !== self.location.origin) return

  // オフライン再生用の音声/メタデータは lib/audioCache.ts が Cache Storage を単独管理する。
  // SW が横取りすると二重管理になるため素通しする。
  if (url.pathname.startsWith('/_audio/') || url.pathname.startsWith('/_audio-meta/')) return

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request, STATIC_CACHE))
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, PAGES_CACHE))
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/backend/podcasts') {
    event.respondWith(networkFirst(request, API_CACHE))
    return
  }

  // 上記以外はブラウザのデフォルト fetch 挙動に委ねる（意図的に介入しない）。
})

self.addEventListener('push', (event) => {
  let title = 'News Listen'
  let body = '新しいニュースがあります'
  let url = '/'

  if (event.data) {
    try {
      const data = event.data.json()
      if (data.title) title = data.title
      if (data.body) body = data.body
      if (data.url) url = data.url
    } catch {
      // JSON パース失敗時はデフォルト値を使用
    }
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  // data.url は相対パス（例 "/feed"）。client.url は絶対 URL なので、
  // 比較・遷移のため origin 起点の絶対 URL に解決する。
  const targetUrl = new URL(
    event.notification.data?.url ?? '/',
    self.location.origin,
  ).href

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // 同一 URL の既存ウィンドウがあればフォーカス
        for (const client of clientList) {
          if (client.url === targetUrl && 'focus' in client) {
            return client.focus()
          }
        }
        // 既存ウィンドウがあれば遷移させてフォーカス（重複ウィンドウを防ぐ）
        const existing = clientList.find((c) => 'focus' in c)
        if (existing) {
          if ('navigate' in existing) existing.navigate(targetUrl)
          return existing.focus()
        }
        // ウィンドウが無ければ新規に開く
        if (clients.openWindow) {
          return clients.openWindow(targetUrl)
        }
      })
  )
})
