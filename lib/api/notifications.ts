import type {
  VapidPublicKeyResponse,
  PushSubscriptionJSON,
} from '@/types/index'
import { request } from '@/lib/api/legacyRequest'

// ── Web Push 通知 ─────────────────────────────────────────────────────

export function getVapidPublicKey() {
  return request<VapidPublicKeyResponse>(
    '/api/backend/notifications/vapid-public-key',
    { method: 'GET' },
  )
}

export function subscribePush(subscription: PushSubscriptionJSON) {
  return request<Record<string, unknown>>(
    '/api/backend/notifications/subscriptions',
    { method: 'POST', body: JSON.stringify(subscription) },
  )
}

export function unsubscribePush(endpoint: string) {
  // WHY: endpoint はクエリパラメータで渡す（backend は ?endpoint= を読む。
  //       既存 deleteSource(url) と同じ DELETE 規約に揃える）。
  const encoded = encodeURIComponent(endpoint)
  return request<Record<string, unknown>>(
    `/api/backend/notifications/subscriptions?endpoint=${encoded}`,
    { method: 'DELETE' },
  )
}
