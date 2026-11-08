import type { NotificationsGateway, PushBrowserPort } from './ports'
import type { PushResolveResult } from './readModels'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

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
  detachFromSubject(): Promise<Result<void, ApiFailure>>
}

interface CreatePushRegistrationDeps {
  port: PushBrowserPort
  client: NotificationsGateway
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

      const vapid = await client.getVapidPublicKey()
      if (!vapid.ok) return 'error'
      const { applicationServerKey } = vapid.value

      const subscription = await port.subscribe({ applicationServerKey })
      const subscribed = await client.subscribePush(subscription)
      if (!subscribed.ok) return 'error'

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
      const removed = await client.unsubscribePush(existing.endpoint)
      if (!removed.ok) return 'error'

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

  async function detachFromSubject(): Promise<Result<void, ApiFailure>> {
    if (!port.isSupported()) return { ok: true, value: undefined }
    const existing = await port.getExistingSubscription()
    if (!existing) return { ok: true, value: undefined }
    const removed = await client.unsubscribePush(existing.endpoint)
    return removed.ok ? { ok: true, value: undefined } : removed
  }

  return { resolve, subscribe, unsubscribe, reregister, detachFromSubject }
}
