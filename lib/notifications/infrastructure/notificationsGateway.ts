// Notifications の gateway: port NotificationsGateway を ApiGateway の上に実装する（DTO ⇄ record の写しと VAPID 鍵の変換）。
// 値の判断は持たない。鍵の変換が throw したら捕まえず reject する（呼び手 subscribe の try が 'error' にする）。
import type { ApiGateway } from '@/lib/api/gateway'
import { getVapidPublicKey, subscribePush, unsubscribePush } from '@/lib/api/notifications'
import type { NotificationsGateway } from '@/lib/notifications/application/ports'
import { urlBase64ToUint8Array } from '@/lib/platform/webpush'
import type { PushSubscriptionJSON } from '@/types/index'

export function createNotificationsGateway(gateway: ApiGateway): NotificationsGateway {
  return {
    async getVapidPublicKey() {
      const result = await getVapidPublicKey(gateway)
      if (!result.ok) return result
      return { ok: true, value: { applicationServerKey: urlBase64ToUint8Array(result.value.public_key) } }
    },
    async subscribePush(record) {
      const body: PushSubscriptionJSON = {
        endpoint: record.endpoint,
        keys: { p256dh: record.keys.p256dh, auth: record.keys.auth },
      }
      const result = await subscribePush(gateway, body)
      if (!result.ok) return result
      return { ok: true, value: undefined }
    },
    async unsubscribePush(endpoint) {
      const result = await unsubscribePush(gateway, endpoint)
      if (!result.ok) return result
      return { ok: true, value: undefined }
    },
  }
}
