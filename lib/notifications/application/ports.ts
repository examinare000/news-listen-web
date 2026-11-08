import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

/** 端末の Push 購読。サーバへ送る DTO とは別の application の型（DTO への写しは gateway）。 */
export interface PushSubscriptionRecord {
  readonly endpoint: string
  readonly keys: {
    readonly p256dh: string
    readonly auth: string
  }
}

/** サーバの VAPID 公開鍵。gateway が base64url を bytes にして返す。 */
export interface VapidKeyRecord {
  readonly applicationServerKey: Uint8Array
}

/**
 * ブラウザ Push API を抽象化するポート。
 *
 * navigator.serviceWorker / PushManager / Notification の直接参照を実装（lib/platform/pushBrowser.ts）に隔離する。
 * テストの fake は `tests/helpers/fakePushBrowserPort.ts`。
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
  getExistingSubscription(): Promise<PushSubscriptionRecord | null>

  /** 新規 Push 購読を作成する */
  subscribe(options: { readonly applicationServerKey: Uint8Array }): Promise<PushSubscriptionRecord>

  /** Push 購読を解除する */
  unsubscribe(endpoint: string): Promise<boolean>
}

/**
 * Notifications の gateway。各メソッドは throw せず Result を返す。
 * 例外: getVapidPublicKey は、鍵の変換（base64url → bytes）の失敗だけ reject する。
 * 呼び手は `try` の中で呼ぶこと。
 */
export interface NotificationsGateway {
  getVapidPublicKey(): Promise<Result<VapidKeyRecord, ApiFailure>>
  subscribePush(subscription: PushSubscriptionRecord): Promise<Result<void, ApiFailure>>
  unsubscribePush(endpoint: string): Promise<Result<void, ApiFailure>>
}
