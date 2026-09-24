import type { PushBrowserPort } from '@/lib/pushBrowserPort'
import { urlBase64ToUint8Array } from '@/lib/webpush'
import type { PushSubscriptionJSON } from '@/types/index'

/**
 * pushRegistration が依存する API クライアントの最小形。
 * createApiClient() の戻り値はこれより広いので、呼び出し側で渡すときは
 * 必要な 3 メソッドだけを満たせばよい。
 */
export interface PushRegistrationApiClient {
  getVapidPublicKey(): Promise<{ public_key: string }>
  subscribePush(subscription: PushSubscriptionJSON): Promise<unknown>
  unsubscribePush(endpoint: string): Promise<unknown>
}

export type PushResolveResult = 'unsupported' | 'denied' | 'unsubscribed' | 'subscribed' | 'error'
export type PushSubscribeResult = 'subscribed' | 'denied' | 'unsubscribed' | 'error'
export type PushUnsubscribeResult = 'unsubscribed' | 'error'

export interface PushRegistration {
  /** 機能検出 → 許可確認 → 既存購読の確認を行い、いずれかの値を返す */
  resolve(): Promise<PushResolveResult>
  /** 許可要求 → SW 登録 → VAPID 取得 → 購読作成 → サーバ登録 */
  subscribe(): Promise<PushSubscribeResult>
  /** 端末側の購読解除 → サーバ行の削除（設定画面のボタン用） */
  unsubscribe(): Promise<PushUnsubscribeResult>
  /** 既存購読があるときだけサーバへ再送する。無ければ何もしない */
  reregister(): Promise<void>
  /** サーバ行だけ削除する。端末側の購読は残す（主体離脱用） */
  detachFromSubject(): Promise<void>
}

interface CreatePushRegistrationDeps {
  port: PushBrowserPort
  client: PushRegistrationApiClient
}

/**
 * 端末の購読とサーバ登録の整合を所有する協調オブジェクトを作る。
 * 状態は持たない（呼び出しのたびに port / client へ問い合わせる）。
 */
export function createPushRegistration({ port, client }: CreatePushRegistrationDeps): PushRegistration {
  async function resolve(): Promise<PushResolveResult> {
    try {
      if (!port.isSupported()) return 'unsupported'
      if (port.getPermission() === 'denied') return 'denied'
      const existing = await port.getExistingSubscription()
      return existing ? 'subscribed' : 'unsubscribed'
    } catch {
      return 'error'
    }
  }

  async function subscribe(): Promise<PushSubscribeResult> {
    try {
      const permission = await port.requestPermission()
      if (permission === 'denied') return 'denied'
      if (permission !== 'granted') return 'unsubscribed'

      await port.registerServiceWorker('/sw.js')

      const { public_key } = await client.getVapidPublicKey()
      const applicationServerKey = urlBase64ToUint8Array(public_key)

      const subscription = await port.subscribe({ applicationServerKey })
      await client.subscribePush(subscription)

      return 'subscribed'
    } catch {
      return 'error'
    }
  }

  async function unsubscribe(): Promise<PushUnsubscribeResult> {
    try {
      const existing = await port.getExistingSubscription()
      if (!existing) return 'unsubscribed'

      await port.unsubscribe(existing.endpoint)
      await client.unsubscribePush(existing.endpoint)

      return 'unsubscribed'
    } catch {
      return 'error'
    }
  }

  async function reregister(): Promise<void> {
    try {
      if (!port.isSupported()) return
      if (port.getPermission() === 'denied') return
      const existing = await port.getExistingSubscription()
      if (!existing) return
      await client.subscribePush(existing)
    } catch {
      // 再送は失敗しても呼び出し側へ伝えない（決定 24: 再試行の状態を持たない）。
    }
  }

  async function detachFromSubject(): Promise<void> {
    if (!port.isSupported()) return
    const existing = await port.getExistingSubscription()
    if (!existing) return
    await client.unsubscribePush(existing.endpoint)
  }

  return { resolve, subscribe, unsubscribe, reregister, detachFromSubject }
}
