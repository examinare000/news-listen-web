// Notifications の command 4 つ（web-cmd-notify-01〜04）。手書きの NotificationsGateway fake と
// createFakePushBrowserPort を使い、呼出を events に記録して順序と回数を固定する。infrastructure は import しない。
// 条件の持ち主は pushRegistration.ts 1 か所（web-rule-notify-01）。ここは command が同じ結果を返すことを見る。
//
// RED 理由（実装前）: `@/lib/notifications/application/commands` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { createNotificationsCommands } from '@/lib/notifications/application/commands'
import type {
  NotificationsGateway,
  PushBrowserPort,
  PushSubscriptionRecord,
  VapidKeyRecord,
} from '@/lib/notifications/application/ports'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'
import { createFakePushBrowserPort } from '../../../helpers/fakePushBrowserPort'

const EXISTING: PushSubscriptionRecord = {
  endpoint: 'https://fcm.example.com/existing',
  keys: { p256dh: 'p256dh-val', auth: 'auth-val' },
}
const FRESH: PushSubscriptionRecord = {
  endpoint: 'https://fcm.example.com/fresh',
  keys: { p256dh: 'fresh-p256dh', auth: 'fresh-auth' },
}
const VAPID: VapidKeyRecord = { applicationServerKey: new Uint8Array([1, 2, 3]) }
const FAILURE: ApiFailure = { kind: 'network' }
const OK_VOID: Result<void, ApiFailure> = { ok: true, value: undefined }
const NG: Result<never, ApiFailure> = { ok: false, failure: FAILURE }

interface Harness {
  readonly commands: ReturnType<typeof createNotificationsCommands>
  readonly events: string[]
  readonly sent: PushSubscriptionRecord[]
  readonly removed: string[]
  readonly subscribeOptions: { readonly applicationServerKey: Uint8Array }[]
  readonly browserUnsubscribed: string[]
}

function harness(
  gatewayOverrides: Partial<NotificationsGateway> = {},
  portOverrides: Partial<PushBrowserPort> = {},
): Harness {
  const events: string[] = []
  const sent: PushSubscriptionRecord[] = []
  const removed: string[] = []
  const subscribeOptions: { readonly applicationServerKey: Uint8Array }[] = []
  const browserUnsubscribed: string[] = []
  const gateway: NotificationsGateway = {
    getVapidPublicKey: async () => {
      events.push('gateway.getVapidPublicKey')
      return { ok: true, value: VAPID }
    },
    subscribePush: async (record) => {
      events.push('gateway.subscribePush')
      sent.push(record)
      return OK_VOID
    },
    unsubscribePush: async (endpoint) => {
      events.push('gateway.unsubscribePush')
      removed.push(endpoint)
      return OK_VOID
    },
    ...gatewayOverrides,
  }
  const browser = createFakePushBrowserPort({
    registerServiceWorker: async (url) => {
      events.push(`browser.registerServiceWorker:${url}`)
    },
    subscribe: async (options) => {
      events.push('browser.subscribe')
      subscribeOptions.push(options)
      return FRESH
    },
    unsubscribe: async (endpoint) => {
      events.push('browser.unsubscribe')
      browserUnsubscribed.push(endpoint)
      return true
    },
    ...portOverrides,
  })
  return { commands: createNotificationsCommands({ gateway, browser }), events, sent, removed, subscribeOptions, browserUnsubscribed }
}

const withExisting = { getExistingSubscription: async () => EXISTING }

describe('web-cmd-notify-01 subscribe', () => {
  test('web-cmd-notify-01 — 許可 granted: SW 登録 → VAPID 取得 → 購読 → サーバ登録の順で "subscribed"。鍵はそのまま port へ、port の record はそのまま gateway へ', async () => {
    const h = harness()

    const result = await h.commands.subscribe()

    expect(result).toBe('subscribed')
    expect(h.events).toEqual([
      'browser.registerServiceWorker:/sw.js',
      'gateway.getVapidPublicKey',
      'browser.subscribe',
      'gateway.subscribePush',
    ])
    expect(h.subscribeOptions).toHaveLength(1)
    expect(h.subscribeOptions[0].applicationServerKey).toBe(VAPID.applicationServerKey)
    expect(h.sent).toEqual([FRESH])
  })

  test('web-cmd-notify-01 — 許可 denied は "denied"、SW 登録も gateway も呼ばない', async () => {
    const h = harness({}, { requestPermission: async () => 'denied' })

    expect(await h.commands.subscribe()).toBe('denied')
    expect(h.events).toEqual([])
  })

  test('web-cmd-notify-01 — 許可 default は "unsubscribed"、SW 登録も gateway も呼ばない', async () => {
    const h = harness({}, { requestPermission: async () => 'default' })

    expect(await h.commands.subscribe()).toBe('unsubscribed')
    expect(h.events).toEqual([])
  })

  test('web-cmd-notify-01 — VAPID 取得が ok:false なら "error" で、port の subscribe を呼ばない', async () => {
    const h = harness({ getVapidPublicKey: async () => NG })

    expect(await h.commands.subscribe()).toBe('error')
    expect(h.events).not.toContain('browser.subscribe')
    expect(h.events).not.toContain('gateway.subscribePush')
  })

  test('web-cmd-notify-01 — VAPID 取得が reject（鍵の変換の失敗）しても "error" で resolve する', async () => {
    const h = harness({
      getVapidPublicKey: async () => {
        throw new Error('invalid base64')
      },
    })

    await expect(h.commands.subscribe()).resolves.toBe('error')
    expect(h.events).not.toContain('browser.subscribe')
  })

  test('web-cmd-notify-01 — サーバ登録が ok:false なら "error"', async () => {
    const h = harness({ subscribePush: async () => NG })

    expect(await h.commands.subscribe()).toBe('error')
  })
})

describe('web-cmd-notify-02 unsubscribe', () => {
  test('web-cmd-notify-02 — 既存購読あり: 端末の解除 → サーバ行の削除の順で、どちらも endpoint を渡し "unsubscribed"', async () => {
    const h = harness({}, withExisting)

    expect(await h.commands.unsubscribe()).toBe('unsubscribed')
    expect(h.events).toEqual(['browser.unsubscribe', 'gateway.unsubscribePush'])
    expect(h.browserUnsubscribed).toEqual([EXISTING.endpoint])
    expect(h.removed).toEqual([EXISTING.endpoint])
  })

  test('web-cmd-notify-02 — 既存購読なしは "unsubscribed" で、gateway も port の unsubscribe も呼ばない', async () => {
    const h = harness()

    expect(await h.commands.unsubscribe()).toBe('unsubscribed')
    expect(h.events).toEqual([])
  })

  test('web-cmd-notify-02 — サーバ行の削除が ok:false なら "error"', async () => {
    const h = harness({ unsubscribePush: async () => NG }, withExisting)

    expect(await h.commands.unsubscribe()).toBe('error')
  })
})

describe('web-cmd-notify-03 reregister', () => {
  test('web-cmd-notify-03 — 既存購読あり: subscribePush を既存の record で 1 回だけ呼び、undefined を返す', async () => {
    const h = harness({}, withExisting)

    const result = await h.commands.reregister()

    expect(result).toBeUndefined()
    expect(h.sent).toEqual([EXISTING])
  })

  test('web-cmd-notify-03 — 既存購読なしなら subscribePush を呼ばない（購読を作らない・送らない）', async () => {
    const h = harness()

    await h.commands.reregister()

    expect(h.events).toEqual([])
  })

  test('web-cmd-notify-03 — 非対応なら subscribePush を呼ばない（既存購読があっても）', async () => {
    const h = harness({}, { ...withExisting, isSupported: () => false })

    await h.commands.reregister()

    expect(h.events).toEqual([])
  })

  test('web-cmd-notify-03 — 許可 denied なら subscribePush を呼ばない（既存購読があっても）', async () => {
    const h = harness({}, { ...withExisting, getPermission: () => 'denied' })

    await h.commands.reregister()

    expect(h.events).toEqual([])
  })

  test('web-cmd-notify-03 — subscribePush が reject しても呼び手へ伝えない（resolve する）', async () => {
    const h = harness(
      {
        subscribePush: async () => {
          throw new Error('network down')
        },
      },
      withExisting,
    )

    await expect(h.commands.reregister()).resolves.toBeUndefined()
  })

  test('web-cmd-notify-03 — subscribePush が ok:false でも呼び手へ伝えない（resolve する）', async () => {
    const h = harness({ subscribePush: async () => NG }, withExisting)

    await expect(h.commands.reregister()).resolves.toBeUndefined()
  })
})

describe('web-cmd-notify-04 detachFromSubject', () => {
  test('web-cmd-notify-04 — 既存購読あり: unsubscribePush を 1 回だけ呼び、port の unsubscribe は呼ばない（端末の購読は残す）', async () => {
    const h = harness({}, withExisting)

    const result = await h.commands.detachFromSubject()

    expect(result).toEqual({ ok: true, value: undefined })
    expect(h.removed).toEqual([EXISTING.endpoint])
    expect(h.browserUnsubscribed).toEqual([])
    expect(h.events).toEqual(['gateway.unsubscribePush'])
  })

  test('web-cmd-notify-04 — 非対応なら ok で、gateway を呼ばない', async () => {
    const h = harness({}, { ...withExisting, isSupported: () => false })

    expect(await h.commands.detachFromSubject()).toEqual({ ok: true, value: undefined })
    expect(h.events).toEqual([])
  })

  test('web-cmd-notify-04 — 既存購読なしなら ok で、gateway を呼ばない', async () => {
    const h = harness()

    expect(await h.commands.detachFromSubject()).toEqual({ ok: true, value: undefined })
    expect(h.events).toEqual([])
  })

  test('web-cmd-notify-04 — unsubscribePush の失敗はそのまま返す', async () => {
    const h = harness({ unsubscribePush: async () => NG }, withExisting)

    expect(await h.commands.detachFromSubject()).toEqual({ ok: false, failure: FAILURE })
  })
})

describe('web-cmd-notify-01〜04 公開する key', () => {
  test('web-cmd-notify-01 — 戻り値の key は subscribe・unsubscribe・reregister・detachFromSubject の 4 つだけで、すべて関数', () => {
    const { commands } = harness()
    const names = ['subscribe', 'unsubscribe', 'reregister', 'detachFromSubject'] as const

    expect(Object.keys(commands).sort()).toEqual([...names].sort())
    for (const name of names) expect(typeof commands[name], name).toBe('function')
  })
})
