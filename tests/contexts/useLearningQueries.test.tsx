// composition root `useLearningQueries`: useApiClient() の gateway から LearningQueries を組み立てる（Provider は作らない）。
// 統合テスト: 実物の ApiClientProvider ＋ createGatewayDouble。gateway を変えて再描画する観測だけは、useApiClient だけを差し替える
// partial mock で行う（ApiClientProvider は gateway を useState で固定し、context は非公開のため）。差し替えが無いときは実物へ委譲する。
//
// RED 理由（実装前）: `@/contexts/useLearningQueries` が無い（module not found）。
import React from 'react'
import { describe, expect, test, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { ApiClientProvider } from '@/contexts/ApiClientProvider'
import { useLearningQueries } from '@/contexts/useLearningQueries'
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

describe('useLearningQueries (composition root)', () => {
  test('verifies: CI-LN17 — 再描画しても同じ object を返す（useMemo。gateway が同じ間は作り直さない）', () => {
    const gateway = createGatewayDouble()
    const { result, rerender } = renderHook(() => useLearningQueries(), {
      wrapper: ({ children }) => <ApiClientProvider gateway={gateway}>{children}</ApiClientProvider>,
    })
    const first = result.current

    rerender()
    rerender()

    expect(result.current).toBe(first)
  })

  test('verifies: CI-LN17 — gateway が変わると別の object を返す（依存 = gateway）。同じ gateway のままなら同じ object（対照）', () => {
    const first = createGatewayDouble()
    const second = createGatewayDouble()
    override.gateway = first
    const { result, rerender } = renderHook(() => useLearningQueries(), {
      wrapper: ({ children }) => <ApiClientProvider gateway={first}>{children}</ApiClientProvider>,
    })
    const before = result.current

    rerender()
    expect(result.current).toBe(before)

    override.gateway = second
    rerender()
    expect(result.current).not.toBe(before)
  })

  test('verifies: CI-LN17 — 実物の ApiClientProvider の gateway 経由で、getRegisteredTerms が GET /api/backend/vocabulary を出し、値は語の集合 (product-learn-05・product-learn-18)', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('GET', '/api/backend/vocabulary', {
      ok: true,
      value: {
        vocabulary: [{ vocabulary_id: 'v1', podcast_id: 'p1', term: 'apple', meaning: 'm', example: 'e', registered_at: '2026-11-16T00:00:00Z' }],
        count: 1,
      },
    })
    const { result } = renderHook(() => useLearningQueries(), {
      wrapper: ({ children }) => <ApiClientProvider gateway={gateway}>{children}</ApiClientProvider>,
    })

    const terms = await result.current.getRegisteredTerms()

    expect(gateway.calls).toEqual([{ method: 'GET', path: '/api/backend/vocabulary', body: undefined }])
    expect(terms.ok && [...terms.value]).toEqual(['apple'])
  })
})
