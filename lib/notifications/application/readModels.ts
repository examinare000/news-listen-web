import type { PushSubscriptionState } from '@/lib/notifications/domain/pushSubscriptionState'

export type PushResolveResult = 'unsupported' | 'denied' | 'unsubscribed' | 'subscribed' | 'error'

/** 設定画面が読む購読状態の写し。 */
export interface PushSubscriptionView {
  readonly state: PushSubscriptionState
  readonly supported: boolean
}

export function toPushSubscriptionView(state: PushSubscriptionState): PushSubscriptionView {
  return Object.freeze({ state, supported: state !== 'unsupported' })
}
