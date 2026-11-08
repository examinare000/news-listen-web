'use client'

// composition root（web-dec-122）: ApiClientProvider の gateway から Preferences の commands を組み立てる。Provider は作らない。
// gateway が同じ間は同じ object を返す（連番の closure を保つ）。
import { useMemo } from 'react'
import { useApiClient } from '@/contexts/ApiClientProvider'
import { createPreferencesCommands, type PreferencesCommands } from '@/lib/preferences/application/commands'
import { createPreferencesGateway } from '@/lib/preferences/infrastructure/preferencesGateway'

export function usePreferencesCommands(): PreferencesCommands {
  const gateway = useApiClient()
  return useMemo(() => createPreferencesCommands({ gateway: createPreferencesGateway(gateway) }), [gateway])
}
