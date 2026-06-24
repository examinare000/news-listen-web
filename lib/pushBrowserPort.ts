import type { PushSubscriptionJSON } from '@/types/index'

/**
 * ブラウザ Push API を抽象化するポートインターフェース。
 *
 * navigator.serviceWorker / PushManager / Notification の直接参照をここに隔離し、
 * フック（useWebPushSubscription）はこのポートのみに依存する。
 * テストでは createFakePushBrowserPort() を注入することで、
 * navigator グローバル汚染なしに状態機械を完全に検証できる。
 */
export interface PushBrowserPort {
  /** serviceWorker と PushManager の両方をブラウザが対応しているか */
  isSupported(): boolean

  /** 現在の通知許可状態 */
  getPermission(): NotificationPermission

  /** 通知許可をユーザーに要求する */
  requestPermission(): Promise<NotificationPermission>

  /** Service Worker を登録する */
  registerServiceWorker(scriptUrl: string): Promise<void>

  /** 既存の Push 購読を取得する（なければ null）*/
  getExistingSubscription(): Promise<PushSubscriptionJSON | null>

  /** 新規 Push 購読を作成する */
  subscribe(options: { applicationServerKey: Uint8Array }): Promise<PushSubscriptionJSON>

  /** Push 購読を解除する */
  unsubscribe(endpoint: string): Promise<boolean>
}

/**
 * 実ブラウザ用の PushBrowserPort 実装。
 *
 * 本番コードでのみ使用。テストでは createFakePushBrowserPort() を使う。
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
      const registration = await navigator.serviceWorker.ready
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

type FakePushBrowserPortOverrides = Partial<PushBrowserPort>

/**
 * テスト用の偽 PushBrowserPort ファクトリ。
 *
 * デフォルトは「対応済み・許可済み・購読なし」の状態を返す。
 * オーバーライドで任意の状態・エラーをシミュレートできる。
 *
 * @example
 * // 通知拒否状態のシミュレーション
 * const port = createFakePushBrowserPort({ getPermission: () => 'denied' })
 *
 * @example
 * // 既存購読のシミュレーション
 * const port = createFakePushBrowserPort({
 *   getExistingSubscription: async () => ({ endpoint: '...', keys: {...} })
 * })
 */
export function createFakePushBrowserPort(overrides: FakePushBrowserPortOverrides = {}): PushBrowserPort {
  const defaults: PushBrowserPort = {
    isSupported: () => true,
    getPermission: () => 'default',
    requestPermission: async () => 'granted',
    registerServiceWorker: async () => {},
    getExistingSubscription: async () => null,
    subscribe: async () => ({
      endpoint: 'https://fcm.example.com/fake-subscription',
      keys: {
        p256dh: 'fake-p256dh-key',
        auth: 'fake-auth-key',
      },
    }),
    unsubscribe: async () => true,
  }

  return { ...defaults, ...overrides }
}
