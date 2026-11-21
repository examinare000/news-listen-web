'use client'

import React, { createContext, use, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createLocalSettings } from '@/lib/preferences/application/localSettings'
import type { SettingDescriptor } from '@/lib/preferences/domain/settings'
import { LOCAL_SETTING_BINDINGS, createLocalSettingsStore } from '@/lib/preferences/infrastructure/localSettingsStore'
import { createBrowserKeyValueStore } from '@/lib/platform/keyValueStore'
import type { KeyValueStore } from '@/lib/platform/keyValueStore'

export interface PreferencesContextValue {
  readonly get: <T>(setting: SettingDescriptor<T>) => T
  readonly set: <T>(setting: SettingDescriptor<T>, value: T) => void
  /** 端末設定の復元が済んだか。mount の effect の後に true になり、false へは戻らない。 */
  readonly ready: boolean
  /** 主体離脱で、主体依存の設定を既定値へ戻し保存も消す。theme などは触れない。 */
  readonly clearSubjectScoped: () => void
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null)

export function PreferencesProvider({ children, store }: { children: React.ReactNode; store?: KeyValueStore }) {
  // 関数の同一性を保つため 1 回だけ組み立てる。値の保持と主体依存の戻しは application が持つ。
  const [core] = useState(() =>
    createLocalSettings({
      storage: createLocalSettingsStore(store ?? createBrowserKeyValueStore()),
      settings: Object.values(LOCAL_SETTING_BINDINGS).map((binding) => binding.setting),
    }),
  )
  const version = useSyncExternalStore(core.subscribe, core.version, core.version)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setReady(true)
  }, [])

  const value = useMemo<PreferencesContextValue>(
    () => ({ get: core.get, set: core.set, clearSubjectScoped: core.clearSubjectScoped, ready }),
    // version は値の更新を consumer へ伝えるための依存で、get/set の参照は変えない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [core, ready, version],
  )
  return <PreferencesContext value={value}>{children}</PreferencesContext>
}

export function usePreferences(): PreferencesContextValue {
  const ctx = use(PreferencesContext)
  if (!ctx) {
    throw new Error('usePreferences must be used within PreferencesProvider')
  }
  return ctx
}
