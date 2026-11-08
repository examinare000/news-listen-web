'use client'

// composition root（web-dec-122・web-dec-129）: ApiClientProvider の gateway と registry の get・set から Preferences の commands を組み立てる。Provider は作らない。
// deps は gateway と get・set だけ。value 全体を入れると、set のたびに version が増えて作り直され、連番の closure が切れる。
// get・set は registry の関数で参照が安定している。
import { useMemo } from 'react'
import { useApiClient } from '@/contexts/ApiClientProvider'
import { usePreferences } from '@/contexts/PreferencesProvider'
import { createPreferencesCommands, type PreferencesCommands } from '@/lib/preferences/application/commands'
import { createPreferencesGateway } from '@/lib/preferences/infrastructure/preferencesGateway'

export function usePreferencesCommands(): PreferencesCommands {
  const { get, set } = usePreferences()
  const apiGateway = useApiClient()
  return useMemo(
    () => createPreferencesCommands({ gateway: createPreferencesGateway(apiGateway), localSettings: { get, set } }),
    [apiGateway, get, set],
  )
}
