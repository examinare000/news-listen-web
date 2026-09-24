'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useWebPushSubscription } from '@/hooks/useWebPushSubscription'

/**
 * 認証状態が 'authenticated' に変わるたび（起動時に既に authenticated の場合を含む）に
 * 端末の既存購読をサーバへ再送する、何も描画しない部品。
 */
export function PushReregistration() {
  const { status } = useAuth()
  useWebPushSubscription({ authStatus: status })
  return null
}
