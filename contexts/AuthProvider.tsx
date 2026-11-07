'use client'

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { AuthUser, RegisterInput } from '@/types/index'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'
import {
  RESOLVING_SESSION,
  reduce,
  type AuthEvent,
  type AuthSession,
  type AuthSessionUser,
} from '@/lib/account/domain/authSession'
import { subjectOf, type Subject } from '@/lib/account/domain/subject'
import { createSubjectCleanup } from '@/lib/account/application/subjectCleanup'
import { createGateway } from '@/lib/api/gateway'
import type { ApiGateway } from '@/lib/api/gateway'
import {
  getMe,
  getPasskeyLoginOptions,
  getPasskeyRegisterOptions,
  login as loginRequest,
  logout as logoutRequest,
  register as registerRequest,
  verifyPasskeyLogin,
  verifyPasskeyRegistration,
} from '@/lib/account/infrastructure/api'
import { subscribePush, unsubscribePush, getVapidPublicKey } from '@/lib/notifications/infrastructure/api'
import { ApiClientProvider } from '@/contexts/ApiClientProvider'
import { usePreferences } from '@/contexts/PreferencesProvider'
import { loginWithPasskey as passkeyLogin } from '@/lib/passkey'
import type { WebAuthnBrowserPort } from '@/lib/webauthnBrowserPort'
import { createLocalPositionStore } from '@/lib/playback/infrastructure/localPositionStore'
import { deleteSubjectAudio, reclaimAudioCaches } from '@/lib/playback/infrastructure/offlineLibrary'
import { createBrowserCacheStore } from '@/lib/platform/cacheStore'
import { createBrowserKeyValueStore } from '@/lib/platform/keyValueStore'
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
  user: AuthSessionUser | null
  /** unavailable からの再試行。resolving に戻して /auth/me を解決し直す。 */
  retry: () => Promise<void>
  /** パスワードログイン。API の失敗は状態を変えず Result で返す（呼び出し側で文言表示）。 */
  login: (username: string, password: string) => Promise<Result<void, ApiFailure>>
  logout: () => Promise<void>
  /** 招待コードによる新規登録。API の失敗は状態を変えず Result で返す（呼び出し側で文言表示）。 */
  register: (input: RegisterInput) => Promise<Result<void, ApiFailure>>
  /** GET /auth/me で状態を再解決する。401 失効時の cleanup 結果を返す。 */
  refreshMe: () => Promise<RefreshMeResult>
  /**
   * Passkey ログイン。port は WebAuthnBrowserPort を受け取る（テストでは fake を注入）。
   * API の失敗は Result で返し、port の例外は throw する（UI 層で文言表示）。
   */
  loginWithPasskey: (port: WebAuthnBrowserPort) => Promise<Result<void, ApiFailure>>
  /**
   * 主体離脱の後始末 (d) が呼ぶ再生停止の登録口。最後に登録された 1 つを保持し、戻り値で解除する。
   * AuthProvider は再生を知らない（再生側が登録する。web-dec-73）。
   */
  registerSubjectLeaveStep: (stop: () => void | Promise<void>) => () => void
  /** 確定した主体の user_id。未確定・未認証・形式不正は null。通信断（unavailable）では直前の主体を保つ（web-dec-80）。 */
  currentUserId: () => string | null
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
function classifyGetMeFailure(failure: ApiFailure): AuthEvent {
  switch (failure.kind) {
    case 'unauthorized':
      return { type: 'unauthorized' }
    case 'network':
    case 'timeout':
      return { type: 'failed', failure: { reason: 'network' } }
    case 'server':
      return { type: 'failed', failure: { reason: 'server' } }
    default:
      return { type: 'failed', failure: { reason: 'unknown' } }
  }
}

// getMe の結果か reject を、成功の AuthUser か失敗の事象にまとめる。
async function resolveMe(gateway: ApiGateway): Promise<Result<AuthUser, AuthEvent>> {
  try {
    const result = await getMe(gateway)
    return result.ok ? result : { ok: false, failure: classifyGetMeFailure(result.failure) }
  } catch {
    return { ok: false, failure: { type: 'failed', failure: { reason: 'unknown' } } }
  }
}

// AuthUser（応答）を session の user へ写す。user_id は subjectOf が検査する。
function toSessionUser(user: AuthUser): AuthSessionUser {
  return {
    username: user.username,
    role: user.role,
    display_name: user.display_name,
    userId: subjectOf(user.user_id).userId,
  }
}

export function AuthProvider({ children, initialSession }: AuthProviderProps) {
  const { ready, clearSubjectScoped } = usePreferences()
  // この gateway を自身の呼出と ApiClientProvider の両方で使う（AuthProvider の内側の Provider は自分から読めない）。
  const [gateway] = useState(() => createGateway())
  const [session, setSession] = useState<AuthSession>(initialSession ?? RESOLVING_SESSION)
  // 直前の状態を同期に読むため、state の値を ref にも持つ。dispatch の中で更新するので、再描画を待たずに同時の 2 件目が最新の値を見る。
  const sessionRef = useRef<AuthSession>(session)
  const dispatch = useCallback((event: AuthEvent) => {
    const next = reduce(sessionRef.current, event)
    sessionRef.current = next
    setSession(next)
  }, [])

  // 主体は session の外の ref で持つ: unavailable をまたいで A を保つ必要があり、session からは導けない（web-dec-80）。
  const lastSubjectRef = useRef<Subject | null>(
    initialSession?.kind === 'authenticated' ? subjectOf(initialSession.user.userId) : null,
  )
  // 起動時の回収は mount につき最初の確定事象で 1 回だけ（shared-leave-08・09）。
  const reclaimedRef = useRef(false)
  const leaveStepRef = useRef<(() => void | Promise<void>) | null>(null)

  const currentUserId = useCallback(() => lastSubjectRef.current?.userId ?? null, [])

  const registerSubjectLeaveStep = useCallback((stop: () => void | Promise<void>) => {
    leaveStepRef.current = stop
    return () => {
      if (leaveStepRef.current === stop) leaveStepRef.current = null
    }
  }, [])

  // 手順の組み立ては呼出時に行う（render の間に ref を読む関数を渡さないため）。
  const subjectCleanup = useCallback(
    (subject: Subject, options: { readonly audio: boolean }) => {
      const localPositions = createLocalPositionStore(createBrowserKeyValueStore())
      return createSubjectCleanup({
        deleteAudio: (userId) => deleteSubjectAudio(createBrowserCacheStore(), userId),
        stopPlayback: () => leaveStepRef.current?.(),
        clearServiceWorkerCaches: () => clearManagedServiceWorkerCaches(),
        clearSubjectSettings: () => {
          clearSubjectScoped()
          localPositions.clearAll()
        },
      })(subject, options)
    },
    [clearSubjectScoped],
  )

  // 最初の確定事象でだけ回収を始める。フラグは事象の処理の中で同期に立てる（effect と手動の refreshMe が並行しても 2 回走らない）。
  // 失敗は無視する: 回収は次回起動でも収束し、状態遷移と RefreshMeResult に影響しない。
  const reclaimOnce = useCallback((): Promise<void> => {
    if (reclaimedRef.current) return Promise.resolve()
    reclaimedRef.current = true
    return (async () => {
      try {
        await reclaimAudioCaches(createBrowserCacheStore(), currentUserId)
      } catch {
        // 次回起動の回収で収束する。
      }
    })()
  }, [currentUserId])

  // 失効（unauthorized）の後始末。refreshMe の 401 と expire が共有する。
  const cleanupAfterExpiry = useCallback(async (): Promise<RefreshMeResult> => {
    const previous = lastSubjectRef.current
    lastSubjectRef.current = null
    const reclaiming = reclaimOnce()
    let result: RefreshMeResult
    if (previous !== null) {
      // 実行中の 401 では音声を消さない（次回起動の回収が消す。web-dec-83）。
      result = { cleanup: (await subjectCleanup(previous, { audio: false })).ok ? 'done' : 'incomplete' }
    } else {
      try {
        await clearManagedServiceWorkerCaches()
        result = { cleanup: 'done' }
      } catch {
        // キャッシュ消去の失敗は状態遷移を妨げない（observable な incomplete を返すのみ）。
        result = { cleanup: 'incomplete' }
      }
    }
    await reclaiming
    return result
  }, [reclaimOnce, subjectCleanup])

  const refreshMe = useCallback(async (): Promise<RefreshMeResult> => {
    const resolved = await resolveMe(gateway)
    if (!resolved.ok) {
      const event = resolved.failure
      dispatch(event)
      // 失効 cleanup は「実際に失効した」と判定できる 401 のときのみ発火する。
      // 通信断や 401 以外では shell-*/api-* を残す
      // （直前の状態は問わない — 初回 mount の自動解決でも同じ判定）。
      if (event.type !== 'unauthorized') return { cleanup: 'skipped' }
      return cleanupAfterExpiry()
    }
    const me = resolved.value
    lastSubjectRef.current = subjectOf(me.user_id)
    dispatch({ type: 'resolved', user: toSessionUser(me) })
    await reclaimOnce()
    return { cleanup: 'skipped' }
  }, [gateway, dispatch, reclaimOnce, cleanupAfterExpiry])

  // Provider 経由の任意 API の unauthorized（ApiClientProvider）。authenticated のときだけ未認証へ移り、後始末を 1 回走らせる。
  // それ以外の状態では何も動かさない（ログイン失敗の 401 など。shared-leave-05）。結果は捨てる。
  const expire = useCallback(() => {
    if (sessionRef.current.kind !== 'authenticated') return
    dispatch({ type: 'expired' })
    void cleanupAfterExpiry()
  }, [dispatch, cleanupAfterExpiry])

  const retry = useCallback(async () => {
    dispatch({ type: 'retry' })
    await refreshMe()
  }, [dispatch, refreshMe])

  // login・register・passkey の成功（遷移④）。B の確立が先で、A の後始末は待たない（shared-dec-28）。
  const establish = useCallback(
    (user: AuthUser) => {
      const previous = lastSubjectRef.current
      const next = subjectOf(user.user_id)
      lastSubjectRef.current = next
      dispatch({ type: 'signedIn', user: toSessionUser(user) })
      const sameSubject = previous !== null && previous.userId !== null && previous.userId === next.userId
      if (previous !== null && !sameSubject) void subjectCleanup(previous, { audio: true })
      void reclaimOnce()
    },
    [dispatch, reclaimOnce, subjectCleanup],
  )

  const login = useCallback(
    async (username: string, password: string): Promise<Result<void, ApiFailure>> => {
      // API の失敗は状態を変えず Result で返す。reject は伝播する。成功時のみ状態を更新する。
      const res = await loginRequest(gateway, username, password)
      if (!res.ok) return res
      establish(res.value.user)
      return { ok: true, value: undefined }
    },
    [gateway, establish],
  )

  const register = useCallback(
    async (input: RegisterInput): Promise<Result<void, ApiFailure>> => {
      // login と同じ方針: API の失敗は Result で返し、成功時のみ状態を更新する。
      const res = await registerRequest(gateway, input)
      if (!res.ok) return res
      establish(res.value.user)
      return { ok: true, value: undefined }
    },
    [gateway, establish],
  )

  const logout = useCallback(async () => {
    try {
      await createPushRegistration({
        port: createRealPushBrowserPort(),
        client: {
          getVapidPublicKey: () => getVapidPublicKey(gateway),
          subscribePush: (subscription) => subscribePush(gateway, subscription),
          unsubscribePush: (endpoint) => unsubscribePush(gateway, endpoint),
        },
      }).detachFromSubject()
    } catch {
      // 購読行の削除はベストエフォート（決定 23）。失敗した行は次のログイン時の再送で上書きされる。
    }
    try {
      await logoutRequest(gateway)
    } catch {
      // ログアウトはベストエフォート（サーバー失効に失敗してもローカル状態は落とす）。
    }
    const previous = lastSubjectRef.current ?? { userId: null }
    lastSubjectRef.current = null
    dispatch({ type: 'loggedOut' })
    // 後始末の完了は待たず、結果（CleanupIncomplete）も捨てる。端末全体の音声消去は残さない（§6.3 性質 1）。
    void subjectCleanup(previous, { audio: true })
  }, [gateway, dispatch, subjectCleanup])

  // WHY: passkey.ts の loginWithPasskey(client, port) を呼ぶ薄いラッパー。
  //      client は gateway に束縛した Result を返す形、port は呼び出し側から注入（テスト可能性を確保）。
  const loginWithPasskey = useCallback(
    async (port: WebAuthnBrowserPort): Promise<Result<void, ApiFailure>> => {
      // API の失敗は Result で返し、port の例外は伝播する。成功時のみ状態を更新する。
      const res = await passkeyLogin(
        {
          getPasskeyRegisterOptions: () => getPasskeyRegisterOptions(gateway),
          verifyPasskeyRegistration: (challengeId, credential) =>
            verifyPasskeyRegistration(gateway, challengeId, credential),
          getPasskeyLoginOptions: () => getPasskeyLoginOptions(gateway),
          verifyPasskeyLogin: (challengeId, credential) => verifyPasskeyLogin(gateway, challengeId, credential),
        },
        port,
      )
      if (!res.ok) return res
      establish(res.value.user)
      return { ok: true, value: undefined }
    },
    [gateway, establish],
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
      value={{
        session,
        status: statusOf(session),
        user,
        login,
        register,
        logout,
        refreshMe,
        loginWithPasskey,
        retry,
        registerSubjectLeaveStep,
        currentUserId,
      }}
    >
      <ApiClientProvider gateway={gateway} onUnauthorized={expire}>{children}</ApiClientProvider>
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
