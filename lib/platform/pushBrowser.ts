import type { PushBrowserPort } from '@/lib/notifications/application/ports'

/**
 * 実ブラウザ用の PushBrowserPort 実装。
 *
 * 本番コードでのみ使用。テストの fake は `tests/helpers/fakePushBrowserPort.ts`。
 */
export function createRealPushBrowserPort(): PushBrowserPort {
  return {
    isSupported() {
      return 'serviceWorker' in navigator && 'PushManager' in window
    },

    getPermission() {
      return Notification.permission
    },

    async requestPermission() {
      return Notification.requestPermission()
    },

    async registerServiceWorker(scriptUrl: string) {
      await navigator.serviceWorker.register(scriptUrl)
    },

    async getExistingSubscription() {
      const registration = await navigator.serviceWorker.getRegistration()
      if (!registration) return null
      const sub = await registration.pushManager.getSubscription()
      if (!sub) return null
      const json = sub.toJSON()
      if (!json.endpoint || !json.keys?.['p256dh'] || !json.keys?.['auth']) return null
      return {
        endpoint: json.endpoint,
        keys: {
          p256dh: json.keys['p256dh'],
          auth: json.keys['auth'],
        },
      }
    },

    async subscribe({ applicationServerKey }) {
      const registration = await navigator.serviceWorker.ready
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey as BufferSource,
      })
      const json = sub.toJSON()
      if (!json.endpoint || !json.keys?.['p256dh'] || !json.keys?.['auth']) {
        throw new Error('Invalid push subscription: missing required fields')
      }
      return {
        endpoint: json.endpoint,
        keys: {
          p256dh: json.keys['p256dh'],
          auth: json.keys['auth'],
        },
      }
    },

    async unsubscribe(endpoint: string) {
      const registration = await navigator.serviceWorker.ready
      const sub = await registration.pushManager.getSubscription()
      if (!sub || sub.endpoint !== endpoint) return false
      return sub.unsubscribe()
    },
  }
}
