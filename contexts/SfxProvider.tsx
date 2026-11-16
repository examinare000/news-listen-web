'use client'

import React, { createContext, use, useLayoutEffect, useMemo } from 'react'
import { usePreferences } from '@/contexts/PreferencesProvider'
import { LOCAL_SETTING_BINDINGS } from '@/lib/preferences/infrastructure/localSettingsStore'
import { configureSfx, playSfx, prepareSfx } from '@/lib/platform/sfx'

interface SfxContextValue {
  readonly play: typeof playSfx
  readonly prepare: typeof prepareSfx
}

const SfxContext = createContext<SfxContextValue | null>(null)

export function SfxProvider({ children }: { children: React.ReactNode }) {
  const { get } = usePreferences()

  // 開発時の Strict Mode でも最後に注入された関数が最新値を返すよう、commit 後に注入する。
  // layout effect は子の mount effect（passive）より前に走る。server では effect が走らず音を鳴らさない。
  useLayoutEffect(() => {
    configureSfx(() => get(LOCAL_SETTING_BINDINGS.sfxEnabled.setting) === true)
  }, [get])

  const value = useMemo<SfxContextValue>(() => ({ play: playSfx, prepare: prepareSfx }), [])
  return <SfxContext value={value}>{children}</SfxContext>
}

export function useSfx(): SfxContextValue {
  const context = use(SfxContext)
  if (!context) throw new Error('useSfx must be used within SfxProvider')
  return context
}
