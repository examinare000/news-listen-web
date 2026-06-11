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
    return <div aria-label="読み込み中" className="skeleton" />
  }

  if (state.isConfigured) {
    // Redirect is in-flight (useEffect above will navigate away)
    return null
  }

  return <SetupModal onConfigure={configure} />
}
