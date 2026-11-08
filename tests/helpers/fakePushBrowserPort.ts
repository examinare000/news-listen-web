/**
 * テスト用の偽 PushBrowserPort ファクトリ。
 *
 * デフォルトは「対応済み・許可済み・購読なし」の状態を返す。
 * オーバーライドで任意の状態・エラーをシミュレートできる。
 * fake は production に置かない（unit のテストが値で import できるよう、依存は `import type` だけにする）。
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
import type { PushBrowserPort } from '@/lib/notifications/application/ports'

type FakePushBrowserPortOverrides = Partial<PushBrowserPort>

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
