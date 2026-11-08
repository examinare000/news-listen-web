// composition root `usePreferencesCommands`: useApiClient() の gateway から PreferencesCommands を組み立てる（Provider は作らない）。
// 連番は command の closure が持つので、gateway が同じ間は再描画しても同じ object を返すことが「最新の要求だけを反映する」前提になる。
// 統合テスト: 実物の ApiClientProvider ＋ createGatewayDouble。gateway を変えて再描画する観測だけは、useApiClient だけを差し替える
// partial mock で行う（ApiClientProvider は gateway を useState で固定し、context は非公開のため）。差し替えが無いときは実物へ委譲する。
//
// RED 理由（実装前）: `@/contexts/usePreferencesCommands` が無い（module not found）。
import React from 'react'
import { describe, expect, test, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { ApiClientProvider } from '@/contexts/ApiClientProvider'
import { usePreferencesCommands } from '@/contexts/usePreferencesCommands'
import type { ApiGateway } from '@/lib/api/gateway'
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

describe('usePreferencesCommands (composition root)', () => {
  test('再描画しても同じ object を返す（gateway が同じ間は作り直さず、連番の closure を保つ）', () => {
    const gateway = createGatewayDouble()
    const { result, rerender } = renderHook(() => usePreferencesCommands(), {
      wrapper: ({ children }) => <ApiClientProvider gateway={gateway}>{children}</ApiClientProvider>,
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
      wrapper: ({ children }) => <ApiClientProvider gateway={first}>{children}</ApiClientProvider>,
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
      wrapper: ({ children }) => <ApiClientProvider gateway={gateway}>{children}</ApiClientProvider>,
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
      wrapper: ({ children }) => <ApiClientProvider gateway={gateway}>{children}</ApiClientProvider>,
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
