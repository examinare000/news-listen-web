'use client'

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { AuthUser, RegisterInput } from '@/types/index'
import { RESOLVING_SESSION, reduce, type AuthEvent, type AuthSession } from '@/lib/account/domain/authSession'
import { ApiError, createApiClient } from '@/lib/api'
import { usePreferences } from '@/contexts/PreferencesProvider'
import { loginWithPasskey as passkeyLogin } from '@/lib/passkey'
import type { WebAuthnBrowserPort } from '@/lib/webauthnBrowserPort'
import { clearOfflineAudio } from '@/lib/playback/infrastructure/offlineLibrary'
import { createBrowserCacheStore } from '@/lib/platform/cacheStore'
import { clearManagedServiceWorkerCaches } from '@/lib/swCacheCleanup'
import { createRealPushBrowserPort } from '@/lib/pushBrowserPort'
import { createPushRegistration } from '@/lib/push/pushRegistration'

// 認証状態。サーバーサイドセッション方式のため、トークンは httpOnly Cookie に保持され
// JS からは読めない。ログイン可否は GET /auth/me の成否で判定する。
// - 'unknown': /auth/me の解決前（resolving）、または 401 以外の失敗で状態を確認できない（unavailable）
// - 'authenticated' / 'unauthenticated': 解決済み（unauthenticated は 401 のときだけ）
export type AuthStatus = 'unknown' | 'authenticated' | 'unauthenticated'

// web-contract-18 の失効 cleanup の発火条件（2026-09-17 user 裁定で候補 (b)）: refreshMe が失効（401）を検知したときの
// SW 管理キャッシュ（shell-*/api-*）消去結果。'skipped' は 401 以外（成功・network error 等）で
// cleanup 自体を行っていないことを表す。
export type RefreshMeResult = { cleanup: 'done' | 'incomplete' | 'skipped' }

interface AuthProviderValue {
  /** 認証状態の正本（判別共用体）。status・user はここから導く互換の値。 */
  session: AuthSession
  status: AuthStatus
  user: AuthUser | null
  /** unavailable からの再試行。resolving に戻して /auth/me を解決し直す。 */
  retry: () => Promise<void>
  /** パスワードログイン。失敗時は ApiError を throw する（呼び出し側で文言表示）。 */
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  /** 招待コードによる新規登録。失敗時は ApiError を throw する（呼び出し側で文言表示）。 */
  register: (input: RegisterInput) => Promise<void>
  /** GET /auth/me で状態を再解決する。401 失効時の cleanup 結果を返す。 */
  refreshMe: () => Promise<RefreshMeResult>
  /**
   * Passkey ログイン。port は WebAuthnBrowserPort を受け取る（テストでは fake を注入）。
   * 失敗時はエラーを throw する（UI 層でキャッチして文言表示）。
   */
  loginWithPasskey: (port: WebAuthnBrowserPort) => Promise<void>
}

const AuthSessionContext = createContext<AuthProviderValue | null>(null)

interface AuthProviderProps {
  children: React.ReactNode
  /** Test-only: 初期状態の上書き。指定すると起動時の自動解決をしない。 */
  initialSession?: AuthSession
}

// 旧語彙 status への写し。resolving・unavailable は「未確定」として unknown に寄せる（web-dec-68）。
function statusOf(session: AuthSession): AuthStatus {
  if (session.kind === 'authenticated') return 'authenticated'
  if (session.kind === 'anonymous') return 'unauthenticated'
  return 'unknown'
}

// getMe の失敗を事象に分類する（web-dec-67）。401 だけが未認証で、それ以外は一時障害。
// .status の数値比較はこの module に閉じる（許可リスト web-dep-08）。
function classifyGetMeFailure(err: unknown): AuthEvent {
  if (!(err instanceof ApiError)) return { type: 'failed', failure: { reason: 'unknown' } }
  if (err.status === 401) return { type: 'unauthorized' }
  if (err.status === 0) return { type: 'failed', failure: { reason: 'network' } }
  if (err.status >= 500) return { type: 'failed', failure: { reason: 'server' } }
  return { type: 'failed', failure: { reason: 'unknown' } }
}

export function AuthProvider({ children, initialSession }: AuthProviderProps) {
  const { ready } = usePreferences()
  const [session, setSession] = useState<AuthSession>(initialSession ?? RESOLVING_SESSION)
  const dispatch = useCallback((event: AuthEvent) => setSession((s) => reduce(s, event)), [])

  const client = useCallback(
    () => createApiClient(),
    [],
  )

  const refreshMe = useCallback(async (): Promise<RefreshMeResult> => {
    try {
      const me = await client().getMe()
      dispatch({ type: 'resolved', user: me })
      return { cleanup: 'skipped' }
    } catch (err) {
      const event = classifyGetMeFailure(err)
      dispatch(event)
      // 失効 cleanup は「実際に失効した」と判定できる 401 のときのみ発火する。
      // network error（ApiError(0) 等）や 401 以外では shell-*/api-* を残す
      // （直前の状態は問わない — 初回 mount の自動解決でも同じ判定）。
      if (event.type === 'unauthorized') {
        try {
          await clearManagedServiceWorkerCaches()
          return { cleanup: 'done' }
        } catch {
          // キャッシュ消去の失敗は状態遷移を妨げない（observable な incomplete を返すのみ）。
          return { cleanup: 'incomplete' }
        }
      }
      return { cleanup: 'skipped' }
    }
  }, [client, dispatch])

  const retry = useCallback(async () => {
    dispatch({ type: 'retry' })
    await refreshMe()
  }, [dispatch, refreshMe])

  const login = useCallback(
    async (username: string, password: string) => {
      // 失敗時は ApiError がそのまま伝播する。成功時のみ状態を更新する。
      const res = await client().login(username, password)
      dispatch({ type: 'signedIn', user: res.user })
    },
    [client, dispatch],
  )

  const register = useCallback(
    async (input: RegisterInput) => {
      // 失敗時は ApiError がそのまま伝播する。成功時のみ状態を更新する（login と同じ方針）。
      const res = await client().register(input)
      dispatch({ type: 'signedIn', user: res.user })
    },
    [client, dispatch],
  )

  const logout = useCallback(async () => {
    try {
      await createPushRegistration({ port: createRealPushBrowserPort(), client: client() }).detachFromSubject()
    } catch {
      // 購読行の削除はベストエフォート（決定 23）。失敗した行は次のログイン時の再送で上書きされる。
    }
    try {
      await client().logout()
    } catch {
      // ログアウトはベストエフォート（サーバー失効に失敗してもローカル状態は落とす）。
    }
    try {
      // issue #167 review指摘2: 共有端末でのユーザーデータ残留防止。
      // clearOfflineAudio()（オフライン音声 audio-v1）だけでは、SW 管理の api-v1
      // （ユーザー固有 Podcast 一覧）・shell-pages-v1（閲覧済みページ）が残り、
      // ユーザー A のキャッシュがユーザー B に返りうる。両方ともベストエフォート
      // （失敗してもログアウト自体は完了させる — 上の方針と揃える）。
      await Promise.all([clearOfflineAudio(createBrowserCacheStore()), clearManagedServiceWorkerCaches()])
    } catch {
      // キャッシュ消去の失敗はログアウトを妨げない。
    }
    dispatch({ type: 'loggedOut' })
  }, [client, dispatch])

  // WHY: passkey.ts の loginWithPasskey(client, port) を呼ぶ薄いラッパー。
  //      client は DI（createApiClient）、port は呼び出し側から注入（テスト可能性を確保）。
  const loginWithPasskey = useCallback(
    async (port: WebAuthnBrowserPort) => {
      // 失敗時はエラーがそのまま伝播する。成功時のみ状態を更新する。
      const res = await passkeyLogin(client(), port)
      dispatch({ type: 'signedIn', user: res.user })
    },
    [client, dispatch],
  )

  // restore 完了後に /auth/me で認証状態を解決する。
  useEffect(() => {
    if (initialSession) return // テスト時の固定状態を尊重
    if (!ready) return // restore 中は待つ
    void refreshMe() // eslint-disable-line @typescript-eslint/no-floating-promises
  }, [ready, refreshMe, initialSession])

  const user = session.kind === 'authenticated' ? session.user : null

  return (
    <AuthSessionContext.Provider
      value={{ session, status: statusOf(session), user, login, register, logout, refreshMe, loginWithPasskey, retry }}
    >
      {children}
    </AuthSessionContext.Provider>
  )
}

export function useAuth(): AuthProviderValue {
  const ctx = useContext(AuthSessionContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}
