// verifies: CI-LD14（SfxProvider・useSfx: 効果音の有効判定を configureSfx で注入し、useSfx() で { play, prepare } を配る。web-dec-168・ADR-088）
// 実物の PreferencesProvider（記憶の KeyValueStore）の上に SfxProvider を描画する。`@/lib/platform/sfx` は mock する（configureSfx の呼出を観測する）。
// 記述子は settings.ts を値で import せず、INFRA の束ね物（LOCAL_SETTING_BINDINGS）から得る。
//
// RED 理由（実装前）: `@/contexts/SfxProvider` が無い（module not found）。
import React from 'react'
import { act, render, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { PreferencesProvider, usePreferences } from '@/contexts/PreferencesProvider'
import { SfxProvider, useSfx } from '@/contexts/SfxProvider'
import { LOCAL_SETTING_BINDINGS } from '@/lib/preferences/infrastructure/localSettingsStore'
import type { KeyValueStore } from '@/lib/platform/keyValueStore'

const sfx = vi.hoisted(() => ({ configureSfx: vi.fn(), prepareSfx: vi.fn(), playSfx: vi.fn() }))
vi.mock('@/lib/platform/sfx', () => sfx)

const SFX = LOCAL_SETTING_BINDINGS.sfxEnabled.setting

function memoryStore(initial: Record<string, string> = {}): KeyValueStore {
  const data = new Map<string, string>(Object.entries(initial))
  return {
    get: (key) => data.get(key) ?? null,
    set: (key, value) => {
      data.set(key, value)
      return true
    },
    remove: (key) => {
      data.delete(key)
    },
  }
}

type Prefs = ReturnType<typeof usePreferences>

function PrefsRecorder({ log }: { log: Prefs[] }) {
  log.push(usePreferences())
  return null
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SfxProvider の有効判定の注入 (web-dec-168)', () => {
  test('verifies: CI-LD14 — mount 時に 1 回だけ configureSfx を呼び、渡した関数は最新の sfxEnabled を返す（再描画で再注入しない）', () => {
    const store = memoryStore({ sfx_enabled: 'false' })
    const log: Prefs[] = []
    const { rerender } = render(
      <PreferencesProvider store={store}>
        <SfxProvider>
          <PrefsRecorder log={log} />
        </SfxProvider>
      </PreferencesProvider>,
    )

    expect(sfx.configureSfx).toHaveBeenCalledTimes(1)
    const isEnabled = sfx.configureSfx.mock.calls[0][0] as () => boolean
    expect(isEnabled()).toBe(false)

    act(() => {
      log[log.length - 1].set(SFX, true)
    })
    expect(isEnabled()).toBe(true)

    rerender(
      <PreferencesProvider store={store}>
        <SfxProvider>
          <PrefsRecorder log={log} />
        </SfxProvider>
      </PreferencesProvider>,
    )
    expect(sfx.configureSfx).toHaveBeenCalledTimes(1)
  })

  test('verifies: CI-LD14 — 子の mount effect より前に注入される（子が prepare を呼ぶ時点で注入済み）', () => {
    let callsSeenByChildEffect = -1
    function Child() {
      React.useEffect(() => {
        callsSeenByChildEffect = sfx.configureSfx.mock.calls.length
      }, [])
      return null
    }

    render(
      <PreferencesProvider store={memoryStore()}>
        <SfxProvider>
          <Child />
        </SfxProvider>
      </PreferencesProvider>,
    )

    expect(callsSeenByChildEffect).toBe(1)
  })

  test('verifies: CI-LD14 — StrictMode でも、最後に注入された判定関数が切替後の値を返す', () => {
    const store = memoryStore({ sfx_enabled: 'false' })
    const log: Prefs[] = []
    render(
      <React.StrictMode>
        <PreferencesProvider store={store}>
          <SfxProvider>
            <PrefsRecorder log={log} />
          </SfxProvider>
        </PreferencesProvider>
      </React.StrictMode>,
    )
    const latestInjected = () => sfx.configureSfx.mock.calls[sfx.configureSfx.mock.calls.length - 1][0] as () => boolean
    expect(latestInjected()()).toBe(false)

    act(() => {
      log[log.length - 1].set(SFX, true)
    })
    expect(latestInjected()()).toBe(true)
  })
})

describe('useSfx (web-dec-168)', () => {
  function wrapper({ children }: { children: React.ReactNode }) {
    return (
      <PreferencesProvider store={memoryStore()}>
        <SfxProvider>{children}</SfxProvider>
      </PreferencesProvider>
    )
  }

  test('verifies: CI-LD14 — { play, prepare } を返し、再描画しても同一の object・関数', () => {
    const { result, rerender } = renderHook(() => useSfx(), { wrapper })
    const first = result.current

    rerender()

    expect(result.current).toBe(first)
    expect(result.current.play).toBe(first.play)
    expect(result.current.prepare).toBe(first.prepare)
  })

  test('verifies: CI-LD14 — play(name) は lib/platform/sfx の playSfx(name) へ、prepare() は prepareSfx() へ委譲する', () => {
    const { result } = renderHook(() => useSfx(), { wrapper })

    result.current.play('streak')
    result.current.prepare()

    expect(sfx.playSfx).toHaveBeenCalledWith('streak')
    expect(sfx.playSfx).toHaveBeenCalledTimes(1)
    expect(sfx.prepareSfx).toHaveBeenCalledTimes(1)
  })

  test('verifies: CI-LD14 — SfxProvider の外の useSfx() は throw する', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() => renderHook(() => useSfx())).toThrow()
  })
})
