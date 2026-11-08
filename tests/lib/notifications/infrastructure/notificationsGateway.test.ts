// Notifications infrastructure の notificationsGateway: port NotificationsGateway を ApiGateway の上に実装する
// （DTO ⇄ record の写しと、VAPID 鍵の base64url → bytes の変換。web-dec-142）。
// request の path・method・body は基点の `lib/api/notifications.ts` と同じ。toEqual の完全一致で固定する。
// 鍵の変換が throw したら捕まえず reject（契約の例外）。adapter のテスト: `createGatewayDouble` を使い、application は値で import しない。
//
// RED 理由（実装前）: `@/lib/notifications/infrastructure/notificationsGateway` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { createNotificationsGateway } from '@/lib/notifications/infrastructure/notificationsGateway'
import type { PushSubscriptionRecord } from '@/lib/notifications/application/ports'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import { createGatewayDouble } from '../../../helpers/gatewayDouble'

const VAPID_PATH = '/api/backend/notifications/vapid-public-key'
const SUBSCRIPTIONS_PATH = '/api/backend/notifications/subscriptions'
const FAILURE: ApiFailure = { kind: 'server', status: 500 }
const RECORD: PushSubscriptionRecord = {
  endpoint: 'https://fcm.example.com/sub-1',
  keys: { p256dh: 'p256dh-val', auth: 'auth-val' },
}

function setup() {
  const double = createGatewayDouble()
  return { double, gateway: createNotificationsGateway(double) }
}

describe('web-dec-142 notificationsGateway: getVapidPublicKey', () => {
  test('web-dec-142 — GET vapid-public-key を 1 回出し、public_key を Uint8Array の applicationServerKey に変換する', async () => {
    const { double, gateway } = setup()
    double.respond('GET', VAPID_PATH, { ok: true, value: { public_key: 'aGVsbG8' } })

    const result = await gateway.getVapidPublicKey()

    expect(double.calls).toEqual([{ method: 'GET', path: VAPID_PATH, body: undefined }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.applicationServerKey).toBeInstanceOf(Uint8Array)
    expect(Array.from(result.value.applicationServerKey)).toEqual([104, 101, 108, 108, 111])
    expect(Object.keys(result.value)).toEqual(['applicationServerKey'])
  })

  test('web-dec-142 — 鍵の変換が throw する入力は捕まえず reject する', async () => {
    const { double, gateway } = setup()
    double.respond('GET', VAPID_PATH, { ok: true, value: { public_key: '!!!!' } })

    await expect(gateway.getVapidPublicKey()).rejects.toThrow()
  })

  test('web-dec-142 — API 失敗は ok:false のまま返す', async () => {
    const { double, gateway } = setup()
    double.respond('GET', VAPID_PATH, { ok: false, failure: FAILURE })

    expect(await gateway.getVapidPublicKey()).toEqual({ ok: false, failure: FAILURE })
  })
})

describe('web-dec-142 notificationsGateway: subscribePush', () => {
  test('web-dec-142 — POST subscriptions、body は { endpoint, keys: { p256dh, auth } } の完全一致で、成功は value: undefined', async () => {
    const { double, gateway } = setup()
    double.respond('POST', SUBSCRIPTIONS_PATH, { ok: true, value: {} })

    const result = await gateway.subscribePush(RECORD)

    expect(double.calls).toEqual([
      {
        method: 'POST',
        path: SUBSCRIPTIONS_PATH,
        body: { endpoint: 'https://fcm.example.com/sub-1', keys: { p256dh: 'p256dh-val', auth: 'auth-val' } },
      },
    ])
    expect(result).toEqual({ ok: true, value: undefined })
  })

  test('web-dec-142 — record に余分な property があっても body へ流さず、record と同じ参照も送らない', async () => {
    const { double, gateway } = setup()
    double.respond('POST', SUBSCRIPTIONS_PATH, { ok: true, value: {} })
    const polluted = { ...RECORD, expirationTime: 123, extra: 'x' } as PushSubscriptionRecord

    await gateway.subscribePush(polluted)

    const body = double.calls[0].body as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['endpoint', 'keys'])
    expect(Object.keys(body['keys'] as object).sort()).toEqual(['auth', 'p256dh'])
    expect(body).not.toBe(polluted)
  })

  test('web-dec-142 — API 失敗は ok:false のまま返す', async () => {
    const { double, gateway } = setup()
    double.respond('POST', SUBSCRIPTIONS_PATH, { ok: false, failure: FAILURE })

    expect(await gateway.subscribePush(RECORD)).toEqual({ ok: false, failure: FAILURE })
  })
})

describe('web-dec-142 notificationsGateway: unsubscribePush', () => {
  test('web-dec-142 — DELETE subscriptions?endpoint=<encodeURIComponent(endpoint)>、body なし、成功は value: undefined', async () => {
    const { double, gateway } = setup()
    const endpoint = 'https://x/a?b=c&d'
    const path = `${SUBSCRIPTIONS_PATH}?endpoint=${encodeURIComponent(endpoint)}`
    double.respond('DELETE', path, { ok: true, value: {} })

    const result = await gateway.unsubscribePush(endpoint)

    expect(double.calls).toEqual([{ method: 'DELETE', path, body: undefined }])
    expect(result).toEqual({ ok: true, value: undefined })
  })

  test('web-dec-142 — API 失敗は ok:false のまま返す', async () => {
    const { double, gateway } = setup()
    double.respond('DELETE', `${SUBSCRIPTIONS_PATH}?endpoint=${encodeURIComponent(RECORD.endpoint)}`, { ok: false, failure: FAILURE })

    expect(await gateway.unsubscribePush(RECORD.endpoint)).toEqual({ ok: false, failure: FAILURE })
  })
})
