// composition root `usePreferencesQueries`: useApiClient() の gateway から PreferencesQueries を組み立てる（Provider は作らない）。
// 統合テスト: 実物の ApiClientProvider ＋ createGatewayDouble。gateway を変えて再描画する観測だけは、useApiClient だけを差し替える
// partial mock で行う（ApiClientProvider は gateway を useState で固定し、context は非公開のため）。差し替えが無いときは実物へ委譲する。
//
// RED 理由（実装前）: `@/contexts/usePreferencesQueries` が無い（module not found）。
import React from 'react'
import { describe, expect, test, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { ApiClientProvider } from '@/contexts/ApiClientProvider'
import { usePreferencesQueries } from '@/contexts/usePreferencesQueries'
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

describe('usePreferencesQueries (composition root)', () => {
  test('再描画しても同じ object を返す（gateway が同じ間は作り直さない）', () => {
    const gateway = createGatewayDouble()
    const { result, rerender } = renderHook(() => usePreferencesQueries(), {
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
    const { result, rerender } = renderHook(() => usePreferencesQueries(), {
      wrapper: ({ children }) => <ApiClientProvider gateway={first}>{children}</ApiClientProvider>,
    })
    const before = result.current

    rerender()
    expect(result.current).toBe(before)

    override.gateway = second
    rerender()
    expect(result.current).not.toBe(before)
  })

  test('実物の ApiClientProvider の gateway 経由で、getServerPreferences() が GET /api/backend/settings/preferences を出す', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('GET', PREFS_PATH, {
      ok: true,
      value: {
        default_difficulty: 'toeic_250',
        default_playback_speed: 1,
        digest_enabled: true,
        digest_article_count: 10,
      },
    })
    const { result } = renderHook(() => usePreferencesQueries(), {
      wrapper: ({ children }) => <ApiClientProvider gateway={gateway}>{children}</ApiClientProvider>,
    })

    const loaded = await result.current.getServerPreferences()

    expect(gateway.calls).toEqual([{ method: 'GET', path: PREFS_PATH, body: undefined }])
    expect(loaded).toEqual({
      ok: true,
      value: { defaultDifficulty: 'toeic_600', weeklyGoal: 3, defaultPlaybackSpeed: 1, digest: { enabled: true, articleCount: 10 } },
    })
  })
})
