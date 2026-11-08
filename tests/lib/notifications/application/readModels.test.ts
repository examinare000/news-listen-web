// Notifications のリードモデル `PushSubscriptionView` と `toPushSubscriptionView`（web-dec-139）。
// 契約: { state, supported: state !== 'unsupported' }、戻りは全深さで凍結、呼ぶたびに別の object。
//
// RED 理由（実装前）: `@/lib/notifications/application/readModels` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { toPushSubscriptionView } from '@/lib/notifications/application/readModels'
import type { PushSubscriptionState } from '@/lib/notifications/domain/pushSubscriptionState'

const STATES: readonly PushSubscriptionState[] = ['unsupported', 'denied', 'unsubscribed', 'subscribing', 'subscribed', 'error']

describe('web-dec-139 toPushSubscriptionView', () => {
  test('web-dec-139 — 6 値すべてで state をそのまま持ち、supported は unsupported のときだけ false', () => {
    expect(STATES).toHaveLength(6)
    for (const state of STATES) {
      expect(toPushSubscriptionView(state), state).toEqual({ state, supported: state !== 'unsupported' })
    }
    expect(toPushSubscriptionView('unsupported').supported).toBe(false)
    expect(toPushSubscriptionView('error').supported).toBe(true)
  })

  test('web-dec-139 — 同じ state で 2 回呼ぶと、値は等しく参照は別の object', () => {
    const first = toPushSubscriptionView('subscribed')
    const second = toPushSubscriptionView('subscribed')

    expect(second).toEqual(first)
    expect(second).not.toBe(first)
  })

  test('web-dec-139 — 戻りは凍結されている', () => {
    for (const state of STATES) expect(Object.isFrozen(toPushSubscriptionView(state)), state).toBe(true)
  })

  test('web-dec-139 — 戻りに書き込んでも state は変わらない（strict mode では throw、非 strict では無視。どちらでも値は不変）', () => {
    const view = toPushSubscriptionView('subscribed') as { state: PushSubscriptionState }

    try {
      view.state = 'error'
    } catch {
      // 凍結した object への書き込みは strict mode で TypeError になる
    }

    expect(view.state).toBe('subscribed')
    expect(toPushSubscriptionView('subscribed').state).toBe('subscribed')
  })
})
