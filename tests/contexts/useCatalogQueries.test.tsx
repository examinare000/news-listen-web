// composition root `useCatalogQueries`: useApiClient() の gateway から CatalogQueries を組み立てる（Provider は作らない）。
// 統合テスト: 実物の ApiClientProvider ＋ createGatewayDouble。gateway を変えて再描画する観測だけは、useApiClient だけを差し替える
// partial mock で行う（ApiClientProvider は gateway を useState で固定し、context は非公開のため）。差し替えが無いときは実物へ委譲する。
//
// RED 理由（実装前）: `@/contexts/useCatalogQueries` が無い（module not found）。
import React from 'react'
import { describe, expect, test, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { ApiClientProvider } from '@/contexts/ApiClientProvider'
import { useCatalogQueries } from '@/contexts/useCatalogQueries'
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

describe('useCatalogQueries (composition root)', () => {
  test('verifies: CI-C1 — 再描画しても同じ object を返す（useMemo。gateway が同じ間は作り直さない）', () => {
    const gateway = createGatewayDouble()
    const { result, rerender } = renderHook(() => useCatalogQueries(), {
      wrapper: ({ children }) => <ApiClientProvider gateway={gateway}>{children}</ApiClientProvider>,
    })
    const first = result.current

    rerender()
    rerender()

    expect(result.current).toBe(first)
  })

  test('verifies: CI-C1 — gateway が変わると別の object を返す（依存 = gateway）。同じ gateway のままなら同じ object（対照）', () => {
    const first = createGatewayDouble()
    const second = createGatewayDouble()
    override.gateway = first
    const { result, rerender } = renderHook(() => useCatalogQueries(), {
      wrapper: ({ children }) => <ApiClientProvider gateway={first}>{children}</ApiClientProvider>,
    })
    const before = result.current

    rerender()
    expect(result.current).toBe(before)

    override.gateway = second
    rerender()
    expect(result.current).not.toBe(before)
  })

  test('verifies: CI-C1 — 実物の ApiClientProvider の gateway 経由で、listEpisodes() が GET /api/backend/podcasts を出す', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('GET', '/api/backend/podcasts', { ok: true, value: { podcasts: [] } })
    const { result } = renderHook(() => useCatalogQueries(), {
      wrapper: ({ children }) => <ApiClientProvider gateway={gateway}>{children}</ApiClientProvider>,
    })

    const listed = await result.current.listEpisodes()

    expect(gateway.calls).toEqual([{ method: 'GET', path: '/api/backend/podcasts', body: undefined }])
    expect(listed).toEqual({ ok: true, value: [] })
  })

  test('verifies: CI-C1 — 詳細も同じ gateway 経由で GET /api/backend/podcasts/<id> を出す', async () => {
    const gateway = createGatewayDouble()
    const { result } = renderHook(() => useCatalogQueries(), {
      wrapper: ({ children }) => <ApiClientProvider gateway={gateway}>{children}</ApiClientProvider>,
    })

    await result.current.getEpisodeDetail('p9')

    expect(gateway.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /api/backend/podcasts/p9'])
  })
})
