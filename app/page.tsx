'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { usePreferences } from '@/contexts/PreferencesProvider'
import { useAuth } from '@/contexts/AuthProvider'
import { LandingPage } from '@/components/lp/LandingPage'
import { LoginModal } from '@/components/ui/LoginModal'
import { OnboardingSourcesModal } from '@/components/ui/OnboardingSourcesModal'
import { useCatalogQueries } from '@/contexts/useCatalogQueries'
import { entryGate } from '@/lib/account/application/entryGate'

// Entry gate（ランディングページ導入後）: 分岐は entryGate（判定表）が決め、ここは描画と遷移だけを持つ。
// - login: LP を即座に表示（LP は静的なので PreferencesProvider の ready を待たない）。ログインボタンで LoginModal を開く。
// - loading / feed: LP だけ（LoginModal は描かない）。feed は /feed へ replace する。
// - onboarding: OnboardingSourcesModal（追加ステップ）。
// - retry: 認証状態を確認できないので再試行を促す。
type OnboardingState = 'pending' | 'incomplete' | 'completed' | 'failed'

export default function RootPage() {
  const { ready } = usePreferences()
  const { session, retry } = useAuth()
  const router = useRouter()
  const queries = useCatalogQueries()

  // ログイン済みになった後にだけ取得する onboarding の状態。
  const [onboarding, setOnboarding] = useState<OnboardingState>('pending')
  // LP 上でログインボタンを押した時だけ LoginModal をオーバーレイ表示する。
  const [showLoginModal, setShowLoginModal] = useState(false)

  // ログイン完了後に onboarding 状態を取得する（未認証では API が 401 になるため）。
  useEffect(() => {
    if (!ready || session.kind !== 'authenticated') return
    let cancelled = false
    queries
      .getOnboardingStatus()
      .then((result) => {
        if (cancelled) return
        // 取得失敗時はオンボーディングを挟まずフィードへ進ませる（行き止まりを防ぐ）
        if (!result.ok) {
          setOnboarding('failed')
          return
        }
        setOnboarding(result.value.completed ? 'completed' : 'incomplete')
      })
      .catch(() => {
        if (!cancelled) setOnboarding('failed')
      })
    return () => {
      cancelled = true
    }
  }, [ready, session.kind, queries])

  const gate = entryGate({ preferencesReady: ready, session, onboarding })

  // onboarding 完了（または取得失敗）が確定したらフィードへ。
  useEffect(() => {
    if (gate === 'feed') router.replace('/feed')
  }, [gate, router])

  switch (gate) {
    case 'onboarding':
      return <OnboardingSourcesModal onDone={() => setOnboarding('completed')} />
    case 'loading':
    case 'feed':
      // 取得中・リダイレクト in-flight の間もブランク画面を避けて LP を出す。ログインボタンは事実上使われない。
      return <LandingPage onLoginClick={() => setShowLoginModal(true)} />
    case 'retry':
      return (
        <div className="content-area content-narrow">
          <p className="settings-row-desc" role="status">接続できませんでした</p>
          <button type="button" className="btn btn-primary" data-testid="auth-retry" onClick={() => void retry()}>
            再試行
          </button>
        </div>
      )
    case 'login':
      return (
        <>
          <LandingPage onLoginClick={() => setShowLoginModal(true)} />
          {showLoginModal && <LoginModal onClose={() => setShowLoginModal(false)} />}
        </>
      )
  }
}
