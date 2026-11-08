'use client'

import { useMemo } from 'react'
import { useApiClient } from '@/contexts/ApiClientProvider'
import { createAccountCommands, type AccountCommands } from '@/lib/account/application/commands'
import { createAccountGateway } from '@/lib/account/infrastructure/accountGateway'
import { createRealWebAuthnBrowserPort } from '@/lib/platform/webauthn'

/** composition root: useApiClient() の gateway から AccountCommands を組み立てる（gateway が同じ間は同じ object）。 */
export function useAccountCommands(): AccountCommands {
  const gateway = useApiClient()
  return useMemo(
    () =>
      createAccountCommands({
        gateway: createAccountGateway(gateway),
        webAuthn: createRealWebAuthnBrowserPort(),
      }),
    [gateway],
  )
}
