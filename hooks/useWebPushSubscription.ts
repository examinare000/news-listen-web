'use client'

import { useState, useEffect, useCallback } from 'react'
import { createApiClient } from '@/lib/api'
import { createRealPushBrowserPort } from '@/lib/pushBrowserPort'
import { createPushRegistration } from '@/lib/push/pushRegistration'
import type { PushBrowserPort } from '@/lib/pushBrowserPort'
import type { PushSubscriptionState } from '@/types/index'

interface UseWebPushSubscriptionOptions {
  /** テスト時に差し替えるポート（省略時は実ブラウザポートを使用）*/
  port?: PushBrowserPort
  /** 呼び出し側の認証状態。'authenticated' に変わるたびに再送する。省略時は再送しない */
  authStatus?: 'unknown' | 'authenticated' | 'unauthenticated'
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
  authStatus,
}: UseWebPushSubscriptionOptions = {}): UseWebPushSubscriptionResult {
  const [pushState, setPushState] = useState<PushSubscriptionState>('unsubscribed')
  // ポートと登録協調オブジェクトはレンダリングをまたいで同一インスタンスを保持
  const [port] = useState<PushBrowserPort>(() => portProp ?? createRealPushBrowserPort())
  const [registration] = useState(() => createPushRegistration({ port, client: createApiClient() }))

  // 初期化: 機能検出 → 権限確認 → 既存購読確認
  useEffect(() => {
    let cancelled = false

    async function init() {
      const result = await registration.resolve()
      if (!cancelled) setPushState(result)
    }

    void init()
    return () => { cancelled = true }
  }, [registration])

  // 認証状態が 'authenticated' に変わるたび（mount 時点で既に 'authenticated' の場合を含む）に再送する
  useEffect(() => {
    if (authStatus === 'authenticated') void registration.reregister()
  }, [authStatus, registration])

  const subscribe = useCallback(async () => {
    setPushState('subscribing')
    const result = await registration.subscribe()
    setPushState(result)
  }, [registration])

  const unsubscribe = useCallback(async () => {
    const result = await registration.unsubscribe()
    setPushState(result)
  }, [registration])

  return { state: pushState, subscribe, unsubscribe }
}
