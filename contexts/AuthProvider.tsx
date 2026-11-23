'use client'

import React, { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'
import type { AuthSession } from '@/lib/account/domain/authSession'
import type { AuthView } from '@/lib/account/application/readModels'
import type { RegisterForm, WebAuthnPort } from '@/lib/account/application/ports'
import { createAccountSession, type RefreshMeResult } from '@/lib/account/application/accountSession'
import { createAccountGateway } from '@/lib/account/infrastructure/accountGateway'
import { createGateway } from '@/lib/api/gateway'
import { createNotificationsCommands } from '@/lib/notifications/application/commands'
import { createNotificationsGateway } from '@/lib/notifications/infrastructure/notificationsGateway'
import { ApiClientProvider } from '@/contexts/ApiClientProvider'
import { usePreferences } from '@/contexts/PreferencesProvider'
import { createPreferencesQueries } from '@/lib/preferences/application/queries'
import { createSubjectSpeedCopy } from '@/lib/preferences/application/subjectSpeedCopy'
import { createPreferencesGateway } from '@/lib/preferences/infrastructure/preferencesGateway'
import { createLocalPositionStore } from '@/lib/playback/infrastructure/localPositionStore'
import { deleteSubjectAudio, reclaimAudioCaches } from '@/lib/playback/infrastructure/offlineLibrary'
import { createBrowserCacheStore } from '@/lib/platform/cacheStore'
import { createBrowserSeenAchievementsStore } from '@/contexts/seenAchievementsSession'
import { createBrowserKeyValueStore } from '@/lib/platform/keyValueStore'
import { createRealWebAuthnBrowserPort } from '@/lib/platform/webauthn'
import { createRealPushBrowserPort } from '@/lib/platform/pushBrowser'
import { clearManagedServiceWorkerCaches } from '@/lib/platform/swCacheCleanup'

// サーバーサイドセッション方式のため、トークンは httpOnly Cookie に保持され
// JS からは読めない。ログイン可否は GET /auth/me の成否で判定する。

export type { RefreshMeResult }

interface AuthProviderValue {
  /** 認証状態の正本（判別共用体）。 */
  session: AuthSession
  /** 画面が読む認証の見え方（session から毎回作る派生値）。 */
  view: AuthView
  /** unavailable からの再試行。resolving に戻して /auth/me を解決し直す。 */
  retry: () => Promise<void>
  /** パスワードログイン。API の失敗は状態を変えず Result で返す（呼び出し側で文言表示）。 */
  login: (username: string, password: string) => Promise<Result<void, ApiFailure>>
  logout: () => Promise<void>
  /** 招待コードによる新規登録。API の失敗は状態を変えず Result で返す（呼び出し側で文言表示）。 */
  register: (form: RegisterForm) => Promise<Result<void, ApiFailure>>
  /** GET /auth/me で状態を再解決する。401 失効時の cleanup 結果を返す。 */
  refreshMe: () => Promise<RefreshMeResult>
  /** Passkey ログイン。API の失敗は Result で返し、port の例外は throw する（UI 層で文言表示）。 */
  loginWithPasskey: () => Promise<Result<void, ApiFailure>>
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
  /** Test-only: WebAuthn の port の差し替え。既定は実ブラウザの port。 */
  webAuthnPort?: WebAuthnPort
}

export function AuthProvider({ children, initialSession, webAuthnPort }: AuthProviderProps) {
  const { ready, clearSubjectScoped, get, set } = usePreferences()
  // gateway は自身の呼出と ApiClientProvider の両方で使う（AuthProvider の内側の Provider は自分から読めない）。
  // 認証 session の状態と規則は application が持つ。ここは infrastructure の組立てと注入だけを行う（1 回だけ）。
  const [{ gateway, account }] = useState(() => {
    const apiGateway = createGateway()
    const accountGateway = createAccountGateway(apiGateway)
    // 内側の Provider の hook は使えないので、accountGateway と同じく直接組み立てる（web-dec-130）。
    const preferencesQueries = createPreferencesQueries({ gateway: createPreferencesGateway(apiGateway) })
    const speed = createSubjectSpeedCopy({ queries: preferencesQueries, local: { get, set, clearSubjectScoped } })
    const created = createAccountSession({
      gateway: accountGateway,
      webAuthn: webAuthnPort ?? createRealWebAuthnBrowserPort(),
      // 手順の組立ては後始末のたびに行う（render の間に store を作らない）。
      cleanupSteps: (subject, currentUserId) => {
        const localPositions = createLocalPositionStore(createBrowserKeyValueStore())
        return {
          deleteAudio: (userId) => deleteSubjectAudio(createBrowserCacheStore(), userId),
          clearServiceWorkerCaches: () => clearManagedServiceWorkerCaches(),
          clearSubjectSettings: () => {
            speed.clearAfterLeave(subject.userId, currentUserId())
            if (subject.userId !== null) localPositions.clearSubject(subject.userId)
            // 既読の実績は Learning の store が持つ（registry の管轄外）。保存に失敗した記憶も空にする。
            createBrowserSeenAchievementsStore().clear()
          },
        }
      },
      reclaim: {
        positions: (userId) => {
          createLocalPositionStore(createBrowserKeyValueStore()).reclaim(userId)
        },
        audio: (currentUserId) => reclaimAudioCaches(createBrowserCacheStore(), currentUserId),
      },
      detachNotifications: async () => {
        await createNotificationsCommands({
          gateway: createNotificationsGateway(apiGateway),
          browser: createRealPushBrowserPort(),
        }).detachFromSubject()
      },
      speed,
      ...(initialSession === undefined ? {} : { initialSession }),
    })
    return { gateway: apiGateway, account: created }
  })
  const session = useSyncExternalStore(account.subscribe, account.session, account.session)
  const view = useSyncExternalStore(account.subscribe, account.view, account.view)

  // restore 完了後に /auth/me で認証状態を解決する。
  useEffect(() => {
    if (initialSession) return // テスト時の固定状態を尊重
    if (!ready) return // restore 中は待つ
    void account.resolveSession()
  }, [ready, account, initialSession])

  return (
    <AuthSessionContext.Provider
      value={{
        session,
        view,
        login: account.login,
        register: account.register,
        logout: account.logout,
        refreshMe: account.resolveSession,
        loginWithPasskey: account.loginWithPasskey,
        retry: account.retry,
        registerSubjectLeaveStep: account.registerSubjectLeaveStep,
        currentUserId: account.currentUserId,
      }}
    >
      <ApiClientProvider gateway={gateway} onUnauthorized={account.expire}>{children}</ApiClientProvider>
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
