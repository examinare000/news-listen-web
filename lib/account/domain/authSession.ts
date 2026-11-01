import type { UserRole } from './role'

// 認証状態の判別共用体と遷移（web-contract-18 / web-dec-66〜71）。
// どの状態からも全事象を受け、次状態は事象だけで決まる（禁止遷移なし）。
// react・@/types・HTTP status を持たない純関数。

export interface AuthSessionUser {
  readonly username: string
  readonly role: UserRole
  readonly display_name: string
}

export interface AuthFailure {
  readonly reason: 'network' | 'server' | 'unknown'
}

export type AuthSession =
  | { readonly kind: 'resolving' }
  | { readonly kind: 'authenticated'; readonly user: AuthSessionUser }
  | { readonly kind: 'anonymous' }
  | { readonly kind: 'unavailable'; readonly failure: AuthFailure }

export type AuthEvent =
  | { readonly type: 'resolved'; readonly user: AuthSessionUser }
  | { readonly type: 'unauthorized' }
  | { readonly type: 'failed'; readonly failure: AuthFailure }
  | { readonly type: 'signedIn'; readonly user: AuthSessionUser }
  | { readonly type: 'retry' }
  | { readonly type: 'loggedOut' }

export const RESOLVING_SESSION: AuthSession = Object.freeze({ kind: 'resolving' })

const ANONYMOUS_SESSION: AuthSession = Object.freeze({ kind: 'anonymous' })

function authenticated(user: AuthSessionUser): AuthSession {
  const copy: AuthSessionUser = Object.freeze({
    username: user.username,
    role: user.role,
    display_name: user.display_name,
  })
  return Object.freeze({ kind: 'authenticated', user: copy })
}

function unavailable(failure: AuthFailure): AuthSession {
  return Object.freeze({ kind: 'unavailable', failure: Object.freeze({ reason: failure.reason }) })
}

export function reduce(_session: AuthSession, event: AuthEvent): AuthSession {
  switch (event.type) {
    case 'resolved':
    case 'signedIn':
      return authenticated(event.user)
    case 'unauthorized':
    case 'loggedOut':
      return ANONYMOUS_SESSION
    case 'failed':
      return unavailable(event.failure)
    case 'retry':
      return RESOLVING_SESSION
  }
}
