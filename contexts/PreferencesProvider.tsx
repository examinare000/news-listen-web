'use client'

import React, { createContext, use, useEffect, useLayoutEffect, useMemo, useReducer, useState } from 'react'
import type { SettingDescriptor } from '@/lib/preferences/domain/settings'
import { LOCAL_SETTING_BINDINGS, createLocalSettingsStore } from '@/lib/preferences/infrastructure/localSettingsStore'
import { createBrowserKeyValueStore } from '@/lib/platform/keyValueStore'
import type { KeyValueStore } from '@/lib/platform/keyValueStore'
import { configureSfx } from '@/lib/sfx'

export interface PreferencesContextValue {
  readonly get: <T>(setting: SettingDescriptor<T>) => T
  readonly set: <T>(setting: SettingDescriptor<T>, value: T) => void
  /** 端末設定の復元が済んだか。mount の effect の後に true になり、false へは戻らない。 */
  readonly ready: boolean
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null)

type Values = Map<SettingDescriptor<unknown>, unknown>

// 関数の同一性を保つため 1 回だけ作る。値は Map に持ち、set 直後の get も再描画を待たず新値を返す。
function createCore(store: KeyValueStore | undefined, notify: () => void) {
  const settings = createLocalSettingsStore(store ?? createBrowserKeyValueStore())
  const values: Values = new Map()
  for (const { setting } of Object.values(LOCAL_SETTING_BINDINGS)) {
    values.set(setting, settings.read<unknown>(setting))
  }

  return {
    get: <T,>(setting: SettingDescriptor<T>): T =>
      // Map は登録済みの記述子から作った値だけを持ち、値は同じ記述子の normalize 済みなので T である。
      values.has(setting) ? (values.get(setting) as T) : setting.default,
    set: <T,>(setting: SettingDescriptor<T>, value: T): void => {
      if (!values.has(setting)) return
      values.set(setting, settings.write(setting, value))
      notify()
    },
  }
}

export function PreferencesProvider({ children, store }: { children: React.ReactNode; store?: KeyValueStore }) {
  const [version, notify] = useReducer((count: number) => count + 1, 0)
  const [core] = useState(() => createCore(store, notify))
  const [ready, setReady] = useState(false)

  // 開発時の Strict Mode は useState の初期化子を 2 回呼び 2 回目を捨てるため、注入は commit された core に結び付ける。
  // layout effect は子の mount effect（passive）より前に走る。server では effect が走らず音を鳴らさない。
  useLayoutEffect(() => {
    configureSfx(() => core.get(LOCAL_SETTING_BINDINGS.sfxEnabled.setting) === true)
  }, [core])

  useEffect(() => {
    setReady(true)
  }, [])

  const value = useMemo<PreferencesContextValue>(
    () => ({ get: core.get, set: core.set, ready }),
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
