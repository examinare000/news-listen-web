'use client'

import { useState, useEffect, useCallback } from 'react'
import { useNotificationsCommands } from '@/contexts/useNotificationsCommands'
import { useNotificationsQueries } from '@/contexts/useNotificationsQueries'
import { toPushSubscriptionView } from '@/lib/notifications/application/readModels'
import type { PushSubscriptionView } from '@/lib/notifications/application/readModels'

interface UseWebPushSubscriptionOptions {
  /** 呼び出し側の認証状態。'authenticated' に変わるたびに再送する。省略時は再送しない */
  authStatus?: 'unknown' | 'authenticated' | 'unauthenticated'
}

interface UseWebPushSubscriptionResult {
  state: PushSubscriptionView['state']
  subscribe: () => Promise<void>
  unsubscribe: () => Promise<void>
}

/**
 * Web Push 購読の状態機械を管理するフック。
 *
 * 購読の問い合わせと操作は、注入済みの query・command に委譲し、
 * フック自身は契機（mount・認証状態の変化）と状態遷移だけを担当する。
 */
export function useWebPushSubscription({ authStatus }: UseWebPushSubscriptionOptions = {}): UseWebPushSubscriptionResult {
  const [view, setView] = useState<PushSubscriptionView>(() => toPushSubscriptionView('unsubscribed'))
  const commands = useNotificationsCommands()
  const queries = useNotificationsQueries()

  // 初期化: 機能検出 → 権限確認 → 既存購読確認
  useEffect(() => {
    let cancelled = false

    async function init() {
      const result = await queries.subscription()
      if (!cancelled) setView(result)
    }

    void init()
    return () => { cancelled = true }
  }, [queries])

  // 認証状態が 'authenticated' に変わるたび（mount 時点で既に 'authenticated' の場合を含む）に再送する
  useEffect(() => {
    if (authStatus === 'authenticated') void commands.reregister()
  }, [authStatus, commands])

  const subscribe = useCallback(async () => {
    setView(toPushSubscriptionView('subscribing'))
    const result = await commands.subscribe()
    setView(toPushSubscriptionView(result))
  }, [commands])

  const unsubscribe = useCallback(async () => {
    const result = await commands.unsubscribe()
    setView(toPushSubscriptionView(result))
  }, [commands])

  return { state: view.state, subscribe, unsubscribe }
}
