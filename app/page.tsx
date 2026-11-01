'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { usePreferences } from '@/contexts/PreferencesProvider'
import { useAuth } from '@/contexts/AuthProvider'
import { LandingPage } from '@/components/lp/LandingPage'
import { LoginModal } from '@/components/ui/LoginModal'
import { OnboardingSourcesModal } from '@/components/ui/OnboardingSourcesModal'
import { createApiClient } from '@/lib/api'

// Entry gate（ランディングページ導入後）:
// - resolving / anonymous → LandingPage を即座に表示（LP は静的なので PreferencesProvider の ready を
//   待たない。以前のスケルトン分岐は撤去）。ログインボタンでオーバーレイの LoginModal を開く。
// - 認証済み:
//     - onboarding 状態を取得する間は LandingPage を表示（ブランク遷移防止。以前は null）
//     - onboarding_completed=false → OnboardingSourcesModal（追加ステップ）
//     - onboarding_completed=true  → /feed へ replace
type OnboardingGate = 'unknown' | 'needed' | 'done'

export default function RootPage() {
  const { ready } = usePreferences()
  const { status: authStatus, session, retry } = useAuth()
  const router = useRouter()

  // ログイン済みになった後にだけ取得する onboarding ゲート状態。
  const [gate, setGate] = useState<OnboardingGate>('unknown')
  // LP 上でログインボタンを押した時だけ LoginModal をオーバーレイ表示する。
  const [showLoginModal, setShowLoginModal] = useState(false)

  // ログイン完了後に onboarding 状態を取得する（未認証では API が 401 になるため）。
  useEffect(() => {
    if (!ready || authStatus !== 'authenticated') return
    let cancelled = false
    const client = createApiClient()
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
  }, [ready, authStatus])

  // onboarding 完了（または取得失敗）が確定したらフィードへ。
  useEffect(() => {
    if (
      ready &&
      authStatus === 'authenticated' &&
      gate === 'done'
    ) {
      router.replace('/feed')
    }
  }, [ready, authStatus, gate, router])

  if (authStatus === 'authenticated') {
    if (gate === 'needed') {
      return <OnboardingSourcesModal onDone={() => setGate('done')} />
    }
    // gate が unknown（取得中）/ done（リダイレクト in-flight）の間も、以前の null 表示に
    // 代えて LP を出すことでブランク画面のちらつきを防ぐ。ログインボタンは事実上使われない。
    return <LandingPage onLoginClick={() => setShowLoginModal(true)} />
  }

  // 認証状態を確認できない（接続失敗など）: LP もログインモーダルも出さず、再試行を促す（web-dec-69）。
  if (session.kind === 'unavailable') {
    return (
      <div className="content-area content-narrow">
        <p className="settings-row-desc" role="status">接続できませんでした</p>
        <button type="button" className="btn btn-primary" data-testid="auth-retry" onClick={() => void retry()}>
          再試行
        </button>
      </div>
    )
  }

  // resolving（/auth/me 解決中）/ anonymous: LP を即座に表示する。
  return (
    <>
      <LandingPage onLoginClick={() => setShowLoginModal(true)} />
      {showLoginModal && <LoginModal onClose={() => setShowLoginModal(false)} />}
    </>
  )
}
