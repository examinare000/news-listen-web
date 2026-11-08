'use client'

// composition root（web-dec-122）: ApiClientProvider の gateway から Preferences の queries を組み立てる。Provider は作らない。
// gateway が同じ間は同じ object を返す。
import { useMemo } from 'react'
import { useApiClient } from '@/contexts/ApiClientProvider'
import { createPreferencesQueries, type PreferencesQueries } from '@/lib/preferences/application/queries'
import { createPreferencesGateway } from '@/lib/preferences/infrastructure/preferencesGateway'

export function usePreferencesQueries(): PreferencesQueries {
  const gateway = useApiClient()
  return useMemo(() => createPreferencesQueries({ gateway: createPreferencesGateway(gateway) }), [gateway])
}
