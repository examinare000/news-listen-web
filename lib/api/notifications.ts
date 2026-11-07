import type {
  VapidPublicKeyResponse,
  PushSubscriptionJSON,
} from '@/types/index'
import type { ApiGateway } from '@/lib/api/gateway'

// ── Web Push 通知 ─────────────────────────────────────────────────────

export function getVapidPublicKey(gateway: ApiGateway) {
  return gateway.request<VapidPublicKeyResponse>(
    '/api/backend/notifications/vapid-public-key',
    { method: 'GET' },
  )
}

export function subscribePush(gateway: ApiGateway, subscription: PushSubscriptionJSON) {
  return gateway.request<Record<string, unknown>>(
    '/api/backend/notifications/subscriptions',
    { method: 'POST', body: subscription },
  )
}

export function unsubscribePush(gateway: ApiGateway, endpoint: string) {
  // WHY: endpoint はクエリパラメータで渡す（backend は ?endpoint= を読む。
  //       既存 deleteSource(url) と同じ DELETE 規約に揃える）。
  const encoded = encodeURIComponent(endpoint)
  return gateway.request<Record<string, unknown>>(
    `/api/backend/notifications/subscriptions?endpoint=${encoded}`,
    { method: 'DELETE' },
  )
}
