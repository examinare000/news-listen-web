// Notifications の query（web-query-notify-01）。resolve は 5 通りの値域を返し、subscription は
// リードモデル { state, supported } を返す（web-dec-139）。呼ぶたびに新しい値。
// 手書きの NotificationsGateway fake と createFakePushBrowserPort を使い、infrastructure は import しない。
//
// RED 理由（実装前）: `@/lib/notifications/application/queries` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { createNotificationsQueries } from '@/lib/notifications/application/queries'
import type { NotificationsGateway, PushBrowserPort, PushSubscriptionRecord } from '@/lib/notifications/application/ports'
import { createFakePushBrowserPort } from '../../../helpers/fakePushBrowserPort'

const EXISTING: PushSubscriptionRecord = {
  endpoint: 'https://fcm.example.com/existing',
  keys: { p256dh: 'p256dh-val', auth: 'auth-val' },
}

function gatewayFake(): NotificationsGateway {
  const unused = () => Promise.reject(new Error('query は gateway を呼ばない'))
  return { getVapidPublicKey: unused, subscribePush: unused, unsubscribePush: unused }
}

function queriesWith(port: PushBrowserPort) {
  return createNotificationsQueries({ gateway: gatewayFake(), browser: port })
}

const unsupported = () => createFakePushBrowserPort({ isSupported: () => false })
const denied = () => createFakePushBrowserPort({ getPermission: () => 'denied' })
const subscribed = () => createFakePushBrowserPort({ getExistingSubscription: async () => EXISTING })
const unsubscribed = () => createFakePushBrowserPort()
const failing = () =>
  createFakePushBrowserPort({
    getExistingSubscription: async () => {
      throw new Error('boom')
    },
  })

describe('web-query-notify-01 resolve', () => {
  test('web-query-notify-01 — 非対応なら "unsupported"', async () => {
    expect(await queriesWith(unsupported()).resolve()).toBe('unsupported')
  })

  test('web-query-notify-01 — 許可が denied なら "denied"', async () => {
    expect(await queriesWith(denied()).resolve()).toBe('denied')
  })

  test('web-query-notify-01 — 既存購読があれば "subscribed"', async () => {
    expect(await queriesWith(subscribed()).resolve()).toBe('subscribed')
  })

  test('web-query-notify-01 — 既存購読がなければ "unsubscribed"', async () => {
    expect(await queriesWith(unsubscribed()).resolve()).toBe('unsubscribed')
  })

  test('web-query-notify-01 — port が throw したら reject せず "error"', async () => {
    expect(await queriesWith(failing()).resolve()).toBe('error')
  })
})

describe('web-query-notify-01, web-dec-139 subscription（リードモデル）', () => {
  test('web-dec-139 — 非対応は { state: "unsupported", supported: false }', async () => {
    expect(await queriesWith(unsupported()).subscription()).toEqual({ state: 'unsupported', supported: false })
  })

  test('web-dec-139 — denied は { state: "denied", supported: true }', async () => {
    expect(await queriesWith(denied()).subscription()).toEqual({ state: 'denied', supported: true })
  })

  test('web-dec-139 — 既存購読ありは { state: "subscribed", supported: true }', async () => {
    expect(await queriesWith(subscribed()).subscription()).toEqual({ state: 'subscribed', supported: true })
  })

  test('web-dec-139 — 既存購読なしは { state: "unsubscribed", supported: true }', async () => {
    expect(await queriesWith(unsubscribed()).subscription()).toEqual({ state: 'unsubscribed', supported: true })
  })

  test('web-dec-139 — port が throw したら { state: "error", supported: true }（reject しない）', async () => {
    expect(await queriesWith(failing()).subscription()).toEqual({ state: 'error', supported: true })
  })

  test('web-query-notify-01 — subscription() は呼ぶたびに別の object を返す', async () => {
    const queries = queriesWith(subscribed())

    const first = await queries.subscription()
    const second = await queries.subscription()

    expect(second).toEqual(first)
    expect(second).not.toBe(first)
  })
})
