// composition root `useAccountCommands`: useApiClient() の gateway から AccountCommands を組み立てる（Provider は作らない）。
// 統合テスト: 実物の ApiClientProvider ＋ createGatewayDouble。gateway を変えて再描画する観測だけは、useApiClient だけを差し替える
// partial mock で行う（差し替えが無いときは実物へ委譲する）。
//
// RED 理由（実装前）: `@/contexts/useAccountCommands` が無い（module not found）。
import React from 'react'
import { describe, expect, test, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { ApiClientProvider } from '@/contexts/ApiClientProvider'
import { useAccountCommands } from '@/contexts/useAccountCommands'
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

describe('useAccountCommands (composition root)', () => {
  test('web-slice-account-01 — 再描画しても同じ object を返す（useMemo。gateway が同じ間は作り直さない）', () => {
    const gateway = createGatewayDouble()
    const { result, rerender } = renderHook(() => useAccountCommands(), {
      wrapper: ({ children }) => <ApiClientProvider gateway={gateway}>{children}</ApiClientProvider>,
    })
    const first = result.current

    rerender()
    rerender()

    expect(result.current).toBe(first)
  })

  test('web-slice-account-01 — gateway が変わると別の object を返す（依存 = gateway）。同じ gateway のままなら同じ object（対照）', () => {
    const first = createGatewayDouble()
    const second = createGatewayDouble()
    override.gateway = first
    const { result, rerender } = renderHook(() => useAccountCommands(), {
      wrapper: ({ children }) => <ApiClientProvider gateway={first}>{children}</ApiClientProvider>,
    })
    const before = result.current

    rerender()
    expect(result.current).toBe(before)

    override.gateway = second
    rerender()
    expect(result.current).not.toBe(before)
  })

  test('web-cmd-account-07 — 実物の ApiClientProvider の gateway 経由で、updateProfile(name) が PATCH /api/backend/auth/me を 1 回出す', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('PATCH', '/api/backend/auth/me', {
      ok: true,
      value: { user_id: 'u-1', username: 'u', role: 'user', display_name: 'n' },
    })
    const { result } = renderHook(() => useAccountCommands(), {
      wrapper: ({ children }) => <ApiClientProvider gateway={gateway}>{children}</ApiClientProvider>,
    })

    const updated = await result.current.updateProfile('n')

    expect(gateway.calls).toEqual([{ method: 'PATCH', path: '/api/backend/auth/me', body: { display_name: 'n' } }])
    expect(updated).toEqual({ ok: true, value: undefined })
  })
})
