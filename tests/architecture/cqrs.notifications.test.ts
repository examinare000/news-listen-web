// @vitest-environment node
// Notifications の query と command の分離（web-check-07）。本 slice の分: web-query-notify-01、web-cmd-notify-01〜04。
// (a) NotificationsQueries の入口の名前の集合 = 2（resolve・subscription）と、NotificationsCommands の入口 = 4
//     （subscribe・unsubscribe・reregister・detachFromSubject）。型の等価と実行時の両方で過不足なく一致する。
// (b) 変更系 port 4 method（requestPermission・registerServiceWorker・subscribe・unsubscribe）と gateway 3 method を記録する double を渡し、
//     query を繰り返し呼んでも記録は 0 件。正方向対照として subscribe・unsubscribe は記録を残す。
// (c) deps の型は { readonly gateway; readonly browser } だけ（command と query で同じ形）。
// 型の等価は `npm run typecheck` が検査する。実行時の検査は vitest が行う。
// createNotificationsGateway・createGatewayDouble は import しない（unit が infrastructure を値で import すると forbiddenDependency になる）。
//
// RED 理由（実装前）: `@/lib/notifications/application/commands`・`queries` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { createNotificationsCommands } from '@/lib/notifications/application/commands'
import type { NotificationsCommands } from '@/lib/notifications/application/commands'
import { createNotificationsQueries } from '@/lib/notifications/application/queries'
import type { NotificationsQueries } from '@/lib/notifications/application/queries'
import type { NotificationsGateway, PushBrowserPort, PushSubscriptionRecord } from '@/lib/notifications/application/ports'

// ---------------------------------------------------------------------------
// 型の等価（実行しない。typecheck だけが読む）
// ---------------------------------------------------------------------------
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

type QueryNames = 'resolve' | 'subscription'
type CommandNames = 'subscribe' | 'unsubscribe' | 'reregister' | 'detachFromSubject'
type Deps = { readonly gateway: NotificationsGateway; readonly browser: PushBrowserPort }

function typeProbes(queries: NotificationsQueries, commands: NotificationsCommands): void {
  const queryKeys: Equals<keyof NotificationsQueries, QueryNames> = true
  const commandKeys: Equals<keyof NotificationsCommands, CommandNames> = true
  const queryDeps: Equals<Parameters<typeof createNotificationsQueries>[0], Deps> = true
  const commandDeps: Equals<Parameters<typeof createNotificationsCommands>[0], Deps> = true
  void [queries, commands, queryKeys, commandKeys, queryDeps, commandDeps]
}
void typeProbes

// ---------------------------------------------------------------------------
// 変更系の呼出を記録する double（記録しなければ (b) に識別力が無い）
// ---------------------------------------------------------------------------
const EXISTING: PushSubscriptionRecord = {
  endpoint: 'https://fcm.example.com/existing',
  keys: { p256dh: 'p256dh-val', auth: 'auth-val' },
}
const MUTATING = [
  'browser.requestPermission',
  'browser.registerServiceWorker',
  'browser.subscribe',
  'browser.unsubscribe',
  'gateway.getVapidPublicKey',
  'gateway.subscribePush',
  'gateway.unsubscribePush',
] as const

function harness(portState: { readonly supported: boolean; readonly existing: PushSubscriptionRecord | null }) {
  const calls: string[] = []
  const browser: PushBrowserPort = {
    isSupported: () => portState.supported,
    getPermission: () => 'default',
    getExistingSubscription: async () => portState.existing,
    requestPermission: async () => {
      calls.push('browser.requestPermission')
      return 'granted'
    },
    registerServiceWorker: async () => {
      calls.push('browser.registerServiceWorker')
    },
    subscribe: async () => {
      calls.push('browser.subscribe')
      return EXISTING
    },
    unsubscribe: async () => {
      calls.push('browser.unsubscribe')
      return true
    },
  }
  const gateway: NotificationsGateway = {
    getVapidPublicKey: async () => {
      calls.push('gateway.getVapidPublicKey')
      return { ok: true, value: { applicationServerKey: new Uint8Array([1]) } }
    },
    subscribePush: async () => {
      calls.push('gateway.subscribePush')
      return { ok: true, value: undefined }
    },
    unsubscribePush: async () => {
      calls.push('gateway.unsubscribePush')
      return { ok: true, value: undefined }
    },
  }
  return {
    queries: createNotificationsQueries({ gateway, browser }),
    commands: createNotificationsCommands({ gateway, browser }),
    calls,
  }
}

// ---------------------------------------------------------------------------
// (a) 名前の集合
// ---------------------------------------------------------------------------
describe('web-check-07 (a) query 2 つは過不足なく公開される', () => {
  test('web-check-07, web-query-notify-01 — 戻り値の key は resolve・subscription の 2 つだけで、すべて関数', () => {
    const { queries } = harness({ supported: true, existing: null })
    const names: readonly QueryNames[] = ['resolve', 'subscription']

    expect(Object.keys(queries).sort()).toEqual([...names].sort())
    for (const name of names) expect(typeof queries[name], name).toBe('function')
  })
})

describe('web-check-07 (a) command 4 つは過不足なく公開される', () => {
  test('web-check-07, web-cmd-notify-01 — 戻り値の key は subscribe・unsubscribe・reregister・detachFromSubject の 4 つだけで、すべて関数', () => {
    const { commands } = harness({ supported: true, existing: null })
    const names: readonly CommandNames[] = ['subscribe', 'unsubscribe', 'reregister', 'detachFromSubject']

    expect(Object.keys(commands).sort()).toEqual([...names].sort())
    for (const name of names) expect(typeof commands[name], name).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// (b) query は読むだけ（既存購読あり・なし・非対応の 3 通り）
// ---------------------------------------------------------------------------
describe('web-check-07 (b) query は変更系の port・gateway を呼ばない', () => {
  test('web-check-07 — 既存購読あり: resolve・subscription を繰り返し呼んでも、変更系 7 method の記録は 0 件', async () => {
    const { queries, calls } = harness({ supported: true, existing: EXISTING })

    expect(await queries.resolve()).toBe('subscribed')
    await queries.resolve()
    await queries.subscription()
    await queries.subscription()

    expect(calls).toEqual([])
  })

  test('web-check-07 — 既存購読なし: resolve・subscription を繰り返し呼んでも、変更系 7 method の記録は 0 件', async () => {
    const { queries, calls } = harness({ supported: true, existing: null })

    expect(await queries.resolve()).toBe('unsubscribed')
    await queries.resolve()
    await queries.subscription()
    await queries.subscription()

    expect(calls).toEqual([])
  })

  test('web-check-07 — 非対応: resolve・subscription を繰り返し呼んでも、変更系 7 method の記録は 0 件', async () => {
    const { queries, calls } = harness({ supported: false, existing: null })

    expect(await queries.resolve()).toBe('unsupported')
    await queries.resolve()
    await queries.subscription()
    await queries.subscription()

    expect(calls).toEqual([])
  })
})

describe('web-check-07 (b) 正方向対照: command は変更系を呼べば記録に残る', () => {
  test('web-cmd-notify-02 — subscribe は変更系を記録し、既存購読ありの unsubscribe は port の unsubscribe と gateway の unsubscribePush を記録する', async () => {
    const subscribing = harness({ supported: true, existing: null })
    await subscribing.commands.subscribe()
    expect(subscribing.calls.filter((c) => (MUTATING as readonly string[]).includes(c)).length).toBeGreaterThanOrEqual(1)
    expect(subscribing.calls).toContain('gateway.subscribePush')

    const unsubscribing = harness({ supported: true, existing: EXISTING })
    await unsubscribing.commands.unsubscribe()
    expect(unsubscribing.calls).toContain('browser.unsubscribe')
    expect(unsubscribing.calls).toContain('gateway.unsubscribePush')
  })
})
