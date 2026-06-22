'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useApp } from '@/contexts/AppContext'
import { useAuth } from '@/contexts/AuthContext'
import { SetupModal } from '@/components/ui/SetupModal'
import { LoginModal } from '@/components/ui/LoginModal'
import { OnboardingSourcesModal } from '@/components/ui/OnboardingSourcesModal'
import { createApiClient } from '@/lib/api'

// Entry gate (spec §10.1 + ログイン + おすすめサイト追加ステップ):
// (a) isRestoring=true        → skeleton (localStorage restore in progress)
// (b) isConfigured=false      → SetupModal (接続設定。完了まで遷移不可)
// (c) isConfigured=true:
//       - 認証状態 unknown（/auth/me 解決中）→ null
//       - 未認証 → LoginModal（ログインするまで遷移不可）
//       - 認証済み:
//           - onboarding 状態を取得する間は null（リダイレクトしない）
//           - onboarding_completed=false → OnboardingSourcesModal（追加ステップ）
//           - onboarding_completed=true  → /feed へ replace
type OnboardingGate = 'unknown' | 'needed' | 'done'

export default function RootPage() {
  const { state, configure } = useApp()
  const { status: authStatus } = useAuth()
  const router = useRouter()

  // 設定済み・ログイン済みになった後にだけ取得する onboarding ゲート状態。
  const [gate, setGate] = useState<OnboardingGate>('unknown')

  // ログイン完了後に onboarding 状態を取得する（未認証では API が 401 になるため）。
  useEffect(() => {
    if (state.isRestoring || !state.isConfigured || authStatus !== 'authenticated') return
    let cancelled = false
    const client = createApiClient({ baseUrl: state.baseUrl, apiKey: state.apiKey })
    client
      .getOnboardingStatus()
      .then((status) => {
        if (!cancelled) setGate(status.onboarding_completed ? 'done' : 'needed')
      })
      .catch(() => {
        // 取得失敗時はオンボーディングを挟まずフィードへ進ませる（行き止まりを防ぐ）
        if (!cancelled) setGate('done')
      })
    return () => {
      cancelled = true
    }
  }, [state.isRestoring, state.isConfigured, authStatus, state.baseUrl, state.apiKey])

  // onboarding 完了（または取得失敗）が確定したらフィードへ。
  useEffect(() => {
    if (
      !state.isRestoring &&
      state.isConfigured &&
      authStatus === 'authenticated' &&
      gate === 'done'
    ) {
      router.replace('/feed')
    }
  }, [state.isRestoring, state.isConfigured, authStatus, gate, router])

  if (state.isRestoring) {
    // カード形状のスケルトン（タイトル行 + カード 2 枚）。表示条件 isRestoring は不変
    return (
      <div aria-label="読み込み中" role="status" className="content-area">
        <div className="skeleton" style={{ height: 16, width: 180, marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 96, borderRadius: 'var(--radius)', marginBottom: 12 }} />
        <div className="skeleton" style={{ height: 96, borderRadius: 'var(--radius)' }} />
      </div>
    )
  }

  if (state.isConfigured) {
    // 接続済み。次にログイン状態を解決する。
    if (authStatus === 'unknown') {
      // /auth/me 解決中は何も描画しない（ちらつき防止）
      return null
    }
    if (authStatus === 'unauthenticated') {
      return <LoginModal />
    }
    // 認証済み。
    if (gate === 'needed') {
      return (
        <OnboardingSourcesModal
          baseUrl={state.baseUrl}
          apiKey={state.apiKey}
          onDone={() => setGate('done')}
        />
      )
    }
    // gate が unknown（取得中）/ done（リダイレクト in-flight）の間は何も描画しない
    return null
  }

  return <SetupModal onConfigure={configure} />
}
