'use client'

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { AuthUser } from '@/types/index'
import { createApiClient } from '@/lib/api'
import { useApp } from '@/contexts/AppContext'

// 認証状態。サーバーサイドセッション方式のため、トークンは httpOnly Cookie に保持され
// JS からは読めない。ログイン可否は GET /auth/me の成否で判定する。
// - 'unknown': 接続設定済みだが /auth/me 解決前（または未接続）
// - 'authenticated' / 'unauthenticated': 解決済み
export type AuthStatus = 'unknown' | 'authenticated' | 'unauthenticated'

interface AuthContextValue {
  status: AuthStatus
  user: AuthUser | null
  /** ログイン。失敗時は ApiError を throw する（呼び出し側で文言表示）。 */
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  /** GET /auth/me で状態を再解決する。 */
  refreshMe: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

interface AuthProviderProps {
  children: React.ReactNode
  /** Test-only: 初期状態の上書き */
  initialUser?: AuthUser | null
  initialStatus?: AuthStatus
}

export function AuthProvider({ children, initialUser = null, initialStatus }: AuthProviderProps) {
  const { state } = useApp()
  const [user, setUser] = useState<AuthUser | null>(initialUser)
  const [status, setStatus] = useState<AuthStatus>(initialStatus ?? 'unknown')

  const client = useCallback(
    () => createApiClient({ baseUrl: state.baseUrl, apiKey: state.apiKey }),
    [state.baseUrl, state.apiKey],
  )

  const refreshMe = useCallback(async () => {
    try {
      const me = await client().getMe()
      setUser(me)
      setStatus('authenticated')
    } catch {
      // 401 などはすべて未認証として扱う（理由は伏せる）。
      setUser(null)
      setStatus('unauthenticated')
    }
  }, [client])

  const login = useCallback(
    async (username: string, password: string) => {
      // 失敗時は ApiError がそのまま伝播する。成功時のみ状態を更新する。
      const res = await client().login(username, password)
      setUser(res.user)
      setStatus('authenticated')
    },
    [client],
  )

  const logout = useCallback(async () => {
    try {
      await client().logout()
    } catch {
      // ログアウトはベストエフォート（サーバー失効に失敗してもローカル状態は落とす）。
    }
    setUser(null)
    setStatus('unauthenticated')
  }, [client])

  // 接続設定が完了したら /auth/me で認証状態を解決する。未設定時は 'unknown' のまま。
  useEffect(() => {
    if (initialStatus) return // テスト時の固定状態を尊重
    if (state.isRestoring || !state.isConfigured) {
      setStatus('unknown')
      return
    }
    refreshMe()
  }, [state.isRestoring, state.isConfigured, refreshMe, initialStatus])

  return (
    <AuthContext.Provider value={{ status, user, login, logout, refreshMe }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}
