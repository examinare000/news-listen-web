// composition root `useCatalogCommands`: useApiClient() の gateway から CatalogCommands を組み立てる（Provider は作らない）。
// 統合テスト: 実物の ApiClientProvider ＋ createGatewayDouble。gateway を変えて再描画する観測だけは、useApiClient だけを差し替える
// partial mock で行う（ApiClientProvider は gateway を useState で固定し、context は非公開のため）。差し替えが無いときは実物へ委譲する。
//
// RED 理由（実装前）: `@/contexts/useCatalogCommands` が無い（module not found）。
import React from 'react'
import { describe, expect, test, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { ApiClientProvider } from '@/contexts/ApiClientProvider'
import { useCatalogCommands } from '@/contexts/useCatalogCommands'
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

describe('useCatalogCommands (composition root)', () => {
  test('verifies: CI-UC1 — 再描画しても同じ object を返す（useMemo。gateway が同じ間は作り直さない）', () => {
    const gateway = createGatewayDouble()
    const { result, rerender } = renderHook(() => useCatalogCommands(), {
      wrapper: ({ children }) => <ApiClientProvider gateway={gateway}>{children}</ApiClientProvider>,
    })
    const first = result.current

    rerender()
    rerender()

    expect(result.current).toBe(first)
  })

  test('verifies: CI-UC1 — gateway が変わると別の object を返す（依存 = gateway）。同じ gateway のままなら同じ object（対照）', () => {
    const first = createGatewayDouble()
    const second = createGatewayDouble()
    override.gateway = first
    const { result, rerender } = renderHook(() => useCatalogCommands(), {
      wrapper: ({ children }) => <ApiClientProvider gateway={first}>{children}</ApiClientProvider>,
    })
    const before = result.current

    rerender()
    expect(result.current).toBe(before)

    override.gateway = second
    rerender()
    expect(result.current).not.toBe(before)
  })

  test('verifies: CI-UC1 — 実物の ApiClientProvider の gateway 経由で、dismissArticle(id) が POST /api/backend/articles/<id>/dismiss を出す', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('POST', '/api/backend/articles/a9/dismiss', { ok: true, value: { status: 'dismissed', article_id: 'a9' } })
    const { result } = renderHook(() => useCatalogCommands(), {
      wrapper: ({ children }) => <ApiClientProvider gateway={gateway}>{children}</ApiClientProvider>,
    })

    const dismissed = await result.current.dismissArticle('a9')

    expect(gateway.calls).toEqual([{ method: 'POST', path: '/api/backend/articles/a9/dismiss', body: undefined }])
    expect(dismissed).toEqual({ ok: true, value: undefined })
  })

  test('verifies: CI-UC1 — 同じ object の unstarArticle は、再描画をまたいで進行中を覚えている（2 回目は gateway を呼ばず ignored）', async () => {
    const gateway = createGatewayDouble()
    let release!: () => void
    gateway.respondWith('DELETE', '/api/backend/articles/a1/star', () =>
      new Promise((resolve) => {
        release = () => resolve({ ok: true, value: { status: 'unstarred', article_id: 'a1' } })
      }),
    )
    const { result, rerender } = renderHook(() => useCatalogCommands(), {
      wrapper: ({ children }) => <ApiClientProvider gateway={gateway}>{children}</ApiClientProvider>,
    })

    const first = result.current.unstarArticle('a1')
    rerender()
    const second = await result.current.unstarArticle('a1')

    expect(second).toEqual({ kind: 'ignored' })
    expect(gateway.calls.filter((c) => c.method === 'DELETE')).toHaveLength(1)
    release()
    expect(await first).toEqual({ ok: true, value: undefined })
  })
})
