// 入口（/）の判定表（web-rule-account-07・web-query-account-05）。状態を持たない純関数。
import type { AuthSession } from '@/lib/account/domain/authSession'

export interface EntryGateInput {
  readonly preferencesReady: boolean
  readonly session: Pick<AuthSession, 'kind'>
  readonly onboarding: 'pending' | 'incomplete' | 'completed' | 'failed'
}

export type EntryGateResult = 'loading' | 'login' | 'retry' | 'onboarding' | 'feed'

export function entryGate({ preferencesReady, session, onboarding }: EntryGateInput): EntryGateResult {
  if (session.kind === 'unavailable') return 'retry'
  if (session.kind !== 'authenticated') return 'login'
  if (!preferencesReady) return 'loading'
  switch (onboarding) {
    case 'pending':
      return 'loading'
    case 'incomplete':
      return 'onboarding'
    default:
      return 'feed'
  }
}
