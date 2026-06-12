'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useApp } from '@/contexts/AppContext'
import { SetupModal } from '@/components/ui/SetupModal'

// Entry gate (spec §10.1):
// (a) isRestoring=true  → skeleton (localStorage restore in progress)
// (b) isConfigured=true → replace to /feed
// (c) isConfigured=false → show SetupModal (cannot navigate away until configured)
export default function RootPage() {
  const { state, configure } = useApp()
  const router = useRouter()

  useEffect(() => {
    if (!state.isRestoring && state.isConfigured) {
      router.replace('/feed')
    }
  }, [state.isRestoring, state.isConfigured, router])

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
    // Redirect is in-flight (useEffect above will navigate away)
    return null
  }

  return <SetupModal onConfigure={configure} />
}
