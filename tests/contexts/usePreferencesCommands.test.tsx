// composition root `usePreferencesCommands`: useApiClient() の gateway から PreferencesCommands を組み立てる（Provider は作らない）。
// 連番は command の closure が持つので、gateway が同じ間は再描画しても同じ object を返すことが「最新の要求だけを反映する」前提になる。
// 統合テスト: 実物の ApiClientProvider ＋ createGatewayDouble。gateway を変えて再描画する観測だけは、useApiClient だけを差し替える
// partial mock で行う（ApiClientProvider は gateway を useState で固定し、context は非公開のため）。差し替えが無いときは実物へ委譲する。
//
// RED 理由（実装前）: `@/contexts/usePreferencesCommands` が無い（module not found）。
import React from 'react'
import { describe, expect, test, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { act } from '@testing-library/react'
import { ApiClientProvider } from '@/contexts/ApiClientProvider'
import { PreferencesProvider, usePreferences } from '@/contexts/PreferencesProvider'
import { usePreferencesCommands } from '@/contexts/usePreferencesCommands'
import type { ApiGateway } from '@/lib/api/gateway'
import type { KeyValueStore } from '@/lib/platform/keyValueStore'
import { LOCAL_SETTING_BINDINGS } from '@/lib/preferences/infrastructure/localSettingsStore'
import { createGatewayDouble } from '../helpers/gatewayDouble'

const override = vi.hoisted(() => ({ gateway: undefined as ApiGateway | undefined }))

vi.mock('@/contexts/ApiClientProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/contexts/ApiClientProvider')>()
  return {
    ...actual,
    // 実物は常に呼ぶ（hook の呼出順を保つ）。差し替えがあるときだけその gateway を返す。
    useApiClient: () => {
      const real = actual.useApiClient()
      return override.gateway ?? real
    },
  }
})

beforeEach(() => {
  override.gateway = undefined
})

const PREFS_PATH = '/api/backend/settings/preferences'
// 記述子は infrastructure の束縛から取る（domain を値で import しない）。
const SPEED = LOCAL_SETTING_BINDINGS.defaultPlaybackSpeed.setting

// localStorage に値を残さない in-memory の KeyValueStore。
const memoryStore = (): KeyValueStore => {
  const data = new Map<string, string>()
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

// hook は usePreferences() を読むので PreferencesProvider の内側で呼ぶ。
const wrapperFor = (gateway: ApiGateway) => {
  const store = memoryStore()
  return ({ children }: { children: React.ReactNode }) => (
    <PreferencesProvider store={store}>
      <ApiClientProvider gateway={gateway}>{children}</ApiClientProvider>
    </PreferencesProvider>
  )
}

describe('usePreferencesCommands (composition root)', () => {
  test('再描画しても同じ object を返す（gateway が同じ間は作り直さず、連番の closure を保つ）', () => {
    const gateway = createGatewayDouble()
    const { result, rerender } = renderHook(() => usePreferencesCommands(), {
      wrapper: wrapperFor(gateway),
    })
    const first = result.current

    rerender()
    rerender()

    expect(result.current).toBe(first)
  })

  test('gateway が変わると別の object を返す。同じ gateway のままなら同じ object（対照）', () => {
    const first = createGatewayDouble()
    const second = createGatewayDouble()
    override.gateway = first
    const { result, rerender } = renderHook(() => usePreferencesCommands(), {
      wrapper: wrapperFor(first),
    })
    const before = result.current

    rerender()
    expect(result.current).toBe(before)

    override.gateway = second
    rerender()
    expect(result.current).not.toBe(before)
  })

  test('実物の ApiClientProvider の gateway 経由で、setDefaultDifficulty() が PUT の 1 field の body を出す', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('PUT', PREFS_PATH, { ok: true, value: {} })
    const { result } = renderHook(() => usePreferencesCommands(), {
      wrapper: wrapperFor(gateway),
    })

    const saved = await result.current.setDefaultDifficulty('eiken_p1')

    expect(gateway.calls).toEqual([{ method: 'PUT', path: PREFS_PATH, body: { default_difficulty: 'eiken_p1' } }])
    expect(saved).toEqual({ ok: true, value: { stale: false } })
  })

  test('再描画をまたいでも連番が切れない（再描画の前後の要求のうち、前の要求は stale になる）', async () => {
    const gateway = createGatewayDouble()
    const settle: Array<() => void> = []
    gateway.respondWith('PUT', PREFS_PATH, () => new Promise((resolve) => settle.push(() => resolve({ ok: true, value: {} }))))
    const { result, rerender } = renderHook(() => usePreferencesCommands(), {
      wrapper: wrapperFor(gateway),
    })

    const before = result.current.setDefaultDifficulty('eiken_p1')
    rerender()
    const after = result.current.setDefaultDifficulty('ielts_7')
    settle[1]()
    settle[0]()

    expect(await before).toEqual({ ok: true, value: { stale: true } })
    expect(await after).toEqual({ ok: true, value: { stale: false } })
  })
})

describe('usePreferencesCommands: registry の get・set を渡す (web-dec-129)', () => {
  test('web-dec-129: registry の set を呼んだ後も同じ object を返す（value 全体を deps にして連番を切らない）', () => {
    const gateway = createGatewayDouble()
    const { result } = renderHook(() => ({ commands: usePreferencesCommands(), prefs: usePreferences() }), {
      wrapper: wrapperFor(gateway),
    })
    const before = result.current.commands
    const valueBefore = result.current.prefs

    act(() => result.current.prefs.set(SPEED, 1.5))

    // 前提の確認: set で registry の value は作り直される。それでも command は同じ object。
    expect(result.current.prefs).not.toBe(valueBefore)
    expect(result.current.commands).toBe(before)
  })

  test('web-dec-129: setDefaultPlaybackSpeed(1.5) が実物の registry の既定速度を 1.5 にし、PUT { default_playback_speed: 1.5 } を出す', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('PUT', PREFS_PATH, { ok: true, value: {} })
    const { result } = renderHook(() => ({ commands: usePreferencesCommands(), prefs: usePreferences() }), {
      wrapper: wrapperFor(gateway),
    })
    expect(result.current.prefs.get(SPEED)).toBe(1)

    let saved: Awaited<ReturnType<typeof result.current.commands.setDefaultPlaybackSpeed>> | undefined
    await act(async () => {
      saved = await result.current.commands.setDefaultPlaybackSpeed(1.5)
    })

    expect(result.current.prefs.get(SPEED)).toBe(1.5)
    expect(gateway.calls).toEqual([{ method: 'PUT', path: PREFS_PATH, body: { default_playback_speed: 1.5 } }])
    expect(saved).toEqual({ ok: true, value: { stale: false } })
  })

  test('web-dec-129: 難易度と速度を交互に出し逆順に決着しても、hook 経由で stale 判定が保たれる（後の要求が最新、先の要求は stale）', async () => {
    const gateway = createGatewayDouble()
    const settle: Array<() => void> = []
    gateway.respondWith('PUT', PREFS_PATH, () => new Promise((resolve) => settle.push(() => resolve({ ok: true, value: {} }))))
    const { result } = renderHook(() => ({ commands: usePreferencesCommands(), prefs: usePreferences() }), {
      wrapper: wrapperFor(gateway),
    })

    let d1!: ReturnType<typeof result.current.commands.setDefaultDifficulty>
    let s1!: ReturnType<typeof result.current.commands.setDefaultPlaybackSpeed>
    let d2!: ReturnType<typeof result.current.commands.setDefaultDifficulty>
    let s2!: ReturnType<typeof result.current.commands.setDefaultPlaybackSpeed>
    act(() => {
      d1 = result.current.commands.setDefaultDifficulty('eiken_p1')
      s1 = result.current.commands.setDefaultPlaybackSpeed(1.25)
    })
    // registry の set で value が変わって再描画された後も、連番は切れない。
    act(() => {
      d2 = result.current.commands.setDefaultDifficulty('ielts_7')
      s2 = result.current.commands.setDefaultPlaybackSpeed(1.75)
    })
    await act(async () => {
      settle[3]()
      settle[2]()
      settle[1]()
      settle[0]()
    })

    expect(await s2).toEqual({ ok: true, value: { stale: false } })
    expect(await d2).toEqual({ ok: true, value: { stale: false } })
    expect(await s1).toEqual({ ok: true, value: { stale: true } })
    expect(await d1).toEqual({ ok: true, value: { stale: true } })
  })
})
