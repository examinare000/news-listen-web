// composition root `useAdminQueries`: useApiClient() の gateway から AdminQueries を組み立てる（Provider は作らない）。
//
// RED 理由（実装前）: `@/contexts/useAdminQueries` が無い（module not found）。
import React from 'react'
import { describe, expect, test, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { ApiClientProvider } from '@/contexts/ApiClientProvider'
import { useAdminQueries } from '@/contexts/useAdminQueries'
import type { ApiGateway } from '@/lib/api/gateway'
import { createGatewayDouble } from '../helpers/gatewayDouble'

const override = vi.hoisted(() => ({ gateway: undefined as ApiGateway | undefined }))

vi.mock('@/contexts/ApiClientProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/contexts/ApiClientProvider')>()
  return {
    ...actual,
    useApiClient: () => {
      const real = actual.useApiClient()
      return override.gateway ?? real
    },
  }
})

beforeEach(() => {
  override.gateway = undefined
})

describe('useAdminQueries (composition root)', () => {
  test('web-dec-136 — 再描画しても同じ object を返す（useMemo。gateway が同じ間は作り直さない）', () => {
    const gateway = createGatewayDouble()
    const { result, rerender } = renderHook(() => useAdminQueries(), {
      wrapper: ({ children }) => <ApiClientProvider gateway={gateway}>{children}</ApiClientProvider>,
    })
    const first = result.current

    rerender()
    rerender()

    expect(result.current).toBe(first)
  })

  test('web-dec-136 — gateway が変わると別の object を返す（依存 = gateway）。同じ gateway のままなら同じ object（対照）', () => {
    const first = createGatewayDouble()
    const second = createGatewayDouble()
    override.gateway = first
    const { result, rerender } = renderHook(() => useAdminQueries(), {
      wrapper: ({ children }) => <ApiClientProvider gateway={first}>{children}</ApiClientProvider>,
    })
    const before = result.current

    rerender()
    expect(result.current).toBe(before)

    override.gateway = second
    rerender()
    expect(result.current).not.toBe(before)
  })

  test('web-dec-136 — 実物の ApiClientProvider の gateway 経由で、listUsers() が GET /api/backend/admin/users を 1 回出し、row の配列を返す', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('GET', '/api/backend/admin/users', {
      ok: true,
      value: { users: [{ username: 'alice', role: 'admin', display_name: 'Alice' }] },
    })
    const { result } = renderHook(() => useAdminQueries(), {
      wrapper: ({ children }) => <ApiClientProvider gateway={gateway}>{children}</ApiClientProvider>,
    })

    const listed = await result.current.listUsers()

    expect(gateway.calls).toEqual([{ method: 'GET', path: '/api/backend/admin/users', body: undefined }])
    expect(listed).toEqual({ ok: true, value: [{ username: 'alice', displayName: 'Alice', role: 'admin' }] })
  })
})
