// composition root `useAdminCommands`: useApiClient() の gateway から AdminCommands を組み立てる（Provider は作らない）。
//
// RED 理由（実装前）: `@/contexts/useAdminCommands` が無い（module not found）。
import React from 'react'
import { describe, expect, test, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { ApiClientProvider } from '@/contexts/ApiClientProvider'
import { useAdminCommands } from '@/contexts/useAdminCommands'
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

describe('useAdminCommands (composition root)', () => {
  test('web-dec-136 — 再描画しても同じ object を返す（useMemo。gateway が同じ間は作り直さない）', () => {
    const gateway = createGatewayDouble()
    const { result, rerender } = renderHook(() => useAdminCommands(), {
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
    const { result, rerender } = renderHook(() => useAdminCommands(), {
      wrapper: ({ children }) => <ApiClientProvider gateway={first}>{children}</ApiClientProvider>,
    })
    const before = result.current

    rerender()
    expect(result.current).toBe(before)

    override.gateway = second
    rerender()
    expect(result.current).not.toBe(before)
  })

  test('web-dec-136 — 実物の ApiClientProvider の gateway 経由で、deleteUser(bob) が DELETE /api/backend/admin/users/bob を 1 回出す', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('DELETE', '/api/backend/admin/users/bob', { ok: true, value: { status: 'deleted', username: 'bob' } })
    const { result } = renderHook(() => useAdminCommands(), {
      wrapper: ({ children }) => <ApiClientProvider gateway={gateway}>{children}</ApiClientProvider>,
    })

    const deleted = await result.current.deleteUser('bob')

    expect(gateway.calls).toEqual([{ method: 'DELETE', path: '/api/backend/admin/users/bob', body: undefined }])
    expect(deleted).toEqual({ ok: true, value: undefined })
  })
})
