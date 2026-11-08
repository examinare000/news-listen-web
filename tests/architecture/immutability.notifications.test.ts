// @vitest-environment node
// Notifications の query の戻り値の不変性（web-check-06）。subscription() の戻り（PushSubscriptionView）は全深さで凍結され、
// 戻りに書き込んでも次の戻りは変わらない。分岐ごと（unsupported・error を含む）に凍結される。
// 分類の理由: queries.ts（APP）だけを値で import するので、台帳の unit 分類で固定される。infrastructure は import しない。
// 手書きの NotificationsGateway fake と createFakePushBrowserPort を使う。
//
// RED 理由（実装前）: `@/lib/notifications/application/queries` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { createNotificationsQueries } from '@/lib/notifications/application/queries'
import type { NotificationsGateway, PushBrowserPort } from '@/lib/notifications/application/ports'
import { createFakePushBrowserPort } from '../helpers/fakePushBrowserPort'

const isPlain = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function unfrozenNodes(value: unknown, where = '$'): string[] {
  const found: string[] = []
  if (Array.isArray(value)) {
    if (!Object.isFrozen(value)) found.push(where)
    ;(value as unknown[]).forEach((item, index) => found.push(...unfrozenNodes(item, `${where}[${index}]`)))
  } else if (isPlain(value)) {
    if (!Object.isFrozen(value)) found.push(where)
    for (const [key, child] of Object.entries(value)) found.push(...unfrozenNodes(child, `${where}.${key}`))
  }
  return found
}

function expectDeeplyFrozen(label: string, value: unknown): void {
  expect(unfrozenNodes(value, label), `${label} に凍結されていない node がある`).toEqual([])
}

describe('web-check-06 helper の自己点検: 深い凍結の判定', () => {
  test('完全に凍結した値は 0 件、凍結していない node は path つきで拾う', () => {
    expect(unfrozenNodes(Object.freeze({ a: Object.freeze([Object.freeze({ b: 1 })]) }))).toEqual([])
    expect(unfrozenNodes({ a: 1 })).toEqual(['$'])
  })
})

function queriesWith(port: PushBrowserPort) {
  const unused = () => Promise.reject(new Error('not used'))
  const gateway: NotificationsGateway = { getVapidPublicKey: unused, subscribePush: unused, unsubscribePush: unused }
  return createNotificationsQueries({ gateway, browser: port })
}

const existing = { endpoint: 'https://fcm.example.com/e', keys: { p256dh: 'p', auth: 'a' } }

describe('web-check-06 subscription() の戻りは全深さで凍結され、書き換えに影響されない', () => {
  test('web-query-notify-01 — 戻りは全深さで凍結されている', async () => {
    const queries = queriesWith(createFakePushBrowserPort({ getExistingSubscription: async () => existing }))

    expectDeeplyFrozen('subscription', await queries.subscription())
  })

  test('web-query-notify-01 — 戻りにキャストして書き込んでも、その戻りも次の戻りも変わらない', async () => {
    const queries = queriesWith(createFakePushBrowserPort({ getExistingSubscription: async () => existing }))
    const first = (await queries.subscription()) as { state: string; supported: boolean }

    try {
      first.state = 'error'
      first.supported = false
    } catch {
      // 凍結した object への書き込みは strict mode で TypeError になる
    }
    const second = await queries.subscription()

    expect(first).toEqual({ state: 'subscribed', supported: true })
    expect(second).toEqual({ state: 'subscribed', supported: true })
  })

  test('web-query-notify-01 — 同じ port の応答で 2 回呼ぶと、別の object を返す', async () => {
    const queries = queriesWith(createFakePushBrowserPort({ getExistingSubscription: async () => existing }))

    const first = await queries.subscription()
    const second = await queries.subscription()

    expect(second).toEqual(first)
    expect(second).not.toBe(first)
  })

  test('web-query-notify-01 — unsupported・error の分岐でも凍結される', async () => {
    const unsupported = await queriesWith(createFakePushBrowserPort({ isSupported: () => false })).subscription()
    const failed = await queriesWith(
      createFakePushBrowserPort({
        getExistingSubscription: async () => {
          throw new Error('boom')
        },
      }),
    ).subscription()

    expect(unsupported).toEqual({ state: 'unsupported', supported: false })
    expect(failed).toEqual({ state: 'error', supported: true })
    expectDeeplyFrozen('unsupported', unsupported)
    expectDeeplyFrozen('error', failed)
  })
})
