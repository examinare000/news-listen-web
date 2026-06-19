'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useApp } from '@/contexts/AppContext'
import { SetupModal } from '@/components/ui/SetupModal'
import { OnboardingSourcesModal } from '@/components/ui/OnboardingSourcesModal'
import { createApiClient } from '@/lib/api'

// Entry gate (spec §10.1 + おすすめサイト追加ステップ):
// (a) isRestoring=true        → skeleton (localStorage restore in progress)
// (b) isConfigured=false      → SetupModal (cannot navigate away until configured)
// (c) isConfigured=true:
//       - onboarding 状態を取得する間は null（リダイレクトしない）
//       - onboarding_completed=false → OnboardingSourcesModal（追加ステップ）
//       - onboarding_completed=true  → /feed へ replace
type OnboardingGate = 'unknown' | 'needed' | 'done'

export default function RootPage() {
  const { state, configure } = useApp()
  const router = useRouter()

  // 設定済みになった後にだけ取得する onboarding ゲート状態。
  const [gate, setGate] = useState<OnboardingGate>('unknown')

  // 設定済みになったら onboarding 状態を取得する。
  useEffect(() => {
    if (state.isRestoring || !state.isConfigured) return
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
  }, [state.isRestoring, state.isConfigured, state.baseUrl, state.apiKey])

  // onboarding 完了（または取得失敗）が確定したらフィードへ。
  useEffect(() => {
    if (!state.isRestoring && state.isConfigured && gate === 'done') {
      router.replace('/feed')
    }
  }, [state.isRestoring, state.isConfigured, gate, router])

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
