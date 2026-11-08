'use client'

import { useEffect, useState } from 'react'
import { createRealWebAuthnBrowserPort } from '@/lib/platform/webauthn'

/** WebAuthn 対応の判定。SSR と hydration を揃えるため初期値は true で、mount 後に実際の値へ更新する。 */
export function usePasskeySupport(): boolean {
  const [supported, setSupported] = useState(true)
  useEffect(() => {
    setSupported(createRealWebAuthnBrowserPort().supportsWebAuthn())
  }, [])
  return supported
}
