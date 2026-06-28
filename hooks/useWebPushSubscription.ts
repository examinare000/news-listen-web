'use client'

import { useState, useEffect, useCallback } from 'react'
import { createApiClient } from '@/lib/api'
import { createRealPushBrowserPort } from '@/lib/pushBrowserPort'
import { urlBase64ToUint8Array } from '@/lib/webpush'
import type { PushBrowserPort } from '@/lib/pushBrowserPort'
import type { PushSubscriptionState } from '@/types/index'

interface UseWebPushSubscriptionOptions {
  /** テスト時に差し替えるポート（省略時は実ブラウザポートを使用）*/
  port?: PushBrowserPort
}

interface UseWebPushSubscriptionResult {
  state: PushSubscriptionState
  subscribe: () => Promise<void>
  unsubscribe: () => Promise<void>
}

/**
 * Web Push 購読の状態機械を管理するフック。
 *
 * ブラウザ Push API へのアクセスは PushBrowserPort ポートに委譲し、
 * フック自身は状態遷移ロジックのみを担当する。
 * ポート注入により、jsdom 環境（navigator なし）でも状態機械を完全にテストできる。
 */
export function useWebPushSubscription({
  port: portProp,
}: UseWebPushSubscriptionOptions = {}): UseWebPushSubscriptionResult {
  const [pushState, setPushState] = useState<PushSubscriptionState>('unsubscribed')
  // ポートはレンダリングをまたいで同一インスタンスを保持
  const [port] = useState<PushBrowserPort>(() => portProp ?? createRealPushBrowserPort())

  // 初期化: 機能検出 → 権限確認 → 既存購読確認
  useEffect(() => {
    let cancelled = false

    async function init() {
      if (!port.isSupported()) {
        if (!cancelled) setPushState('unsupported')
        return
      }

      if (port.getPermission() === 'denied') {
        if (!cancelled) setPushState('denied')
        return
      }

      try {
        const existing = await port.getExistingSubscription()
        if (!cancelled) {
          setPushState(existing ? 'subscribed' : 'unsubscribed')
        }
      } catch {
        if (!cancelled) setPushState('error')
      }
    }

    void init()
    return () => { cancelled = true }
  }, [port])

  const subscribe = useCallback(async () => {
    setPushState('subscribing')
    try {
      // 通知許可を要求
      const permission = await port.requestPermission()
      if (permission === 'denied') {
        setPushState('denied')
        return
      }
      if (permission !== 'granted') {
        setPushState('unsubscribed')
        return
      }

      // SW 登録
      await port.registerServiceWorker('/sw.js')

      // VAPID 公開鍵取得
      const client = createApiClient()
      const { public_key } = await client.getVapidPublicKey()
      const applicationServerKey = urlBase64ToUint8Array(public_key)

      // Push 購読作成
      const subscription = await port.subscribe({ applicationServerKey })

      // バックエンドに登録
      await client.subscribePush(subscription)

      setPushState('subscribed')
    } catch {
      setPushState('error')
    }
  }, [port])

  const unsubscribe = useCallback(async () => {
    try {
      const client = createApiClient()
      const existing = await port.getExistingSubscription()
      if (existing) {
        await port.unsubscribe(existing.endpoint)
        await client.unsubscribePush(existing.endpoint)
      }
      setPushState('unsubscribed')
    } catch {
      setPushState('error')
    }
  }, [port])

  return { state: pushState, subscribe, unsubscribe }
}
