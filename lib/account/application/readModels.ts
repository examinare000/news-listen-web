import type { AuthSession, AuthSessionUser } from '@/lib/account/domain/authSession'

/** 画面が読む認証の見え方。session から毎回作る派生値で、保存しない。 */
export interface AuthView {
  readonly kind: 'resolving' | 'authenticated' | 'anonymous' | 'unavailable'
  readonly user: AuthSessionUser | null
}

export interface SessionRow {
  readonly id: string
  readonly deviceLabel: string | null
  readonly createdAt: string
  readonly lastUsedAt: string | null
  readonly isCurrent: boolean
}

export interface PasskeyRow {
  readonly credentialId: string
  readonly name: string | null
  readonly createdAt: string
  readonly lastUsedAt: string | null
}

export function authView(session: AuthSession): AuthView {
  const user =
    session.kind === 'authenticated'
      ? Object.freeze({
          username: session.user.username,
          role: session.user.role,
          display_name: session.user.display_name,
          userId: session.user.userId,
        })
      : null
  return Object.freeze({ kind: session.kind, user })
}
