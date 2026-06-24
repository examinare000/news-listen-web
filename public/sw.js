/**
 * Service Worker for Web Push notifications.
 *
 * 設計方針: 薄く保つ。
 * ロジックはクライアント側（hooks/useWebPushSubscription.ts）に寄せており、
 * Service Worker は Push イベントの受信と通知表示のみを担当する。
 */

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
