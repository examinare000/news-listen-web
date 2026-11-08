// composition root `useNotificationsQueries`: useApiClient() の gateway から NotificationsQueries を組み立てる（Provider は作らない）。
// browser port は `@/lib/platform/pushBrowser` の createRealPushBrowserPort を mock して fake に差し替える（実 navigator に触れない）。
//
// RED 理由（実装前）: `@/contexts/useNotificationsQueries` が無い（module not found）。
import React from 'react'
import { describe, expect, test, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { ApiClientProvider } from '@/contexts/ApiClientProvider'
import { useNotificationsQueries } from '@/contexts/useNotificationsQueries'
import type { ApiGateway } from '@/lib/api/gateway'
import type { PushBrowserPort } from '@/lib/notifications/application/ports'
import { createFakePushBrowserPort } from '../helpers/fakePushBrowserPort'
import { createGatewayDouble } from '../helpers/gatewayDouble'

const override = vi.hoisted(() => ({ gateway: undefined as ApiGateway | undefined }))
const holder = vi.hoisted(() => ({ port: undefined as PushBrowserPort | undefined }))

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

vi.mock('@/lib/platform/pushBrowser', () => ({
  createRealPushBrowserPort: () => holder.port,
}))

const EXISTING = { endpoint: 'https://fcm.example.com/existing', keys: { p256dh: 'p256dh-val', auth: 'auth-val' } }

beforeEach(() => {
  override.gateway = undefined
  holder.port = createFakePushBrowserPort()
})

describe('useNotificationsQueries (composition root)', () => {
  test('web-dec-140 — 再描画しても同じ object を返す（useMemo。gateway が同じ間は作り直さない）', () => {
    const gateway = createGatewayDouble()
    const { result, rerender } = renderHook(() => useNotificationsQueries(), {
      wrapper: ({ children }) => <ApiClientProvider gateway={gateway}>{children}</ApiClientProvider>,
    })
    const first = result.current

    rerender()
    rerender()

    expect(result.current).toBe(first)
  })

  test('web-dec-140 — gateway が変わると別の object を返す（依存 = gateway）。同じ gateway のままなら同じ object（対照）', () => {
    const first = createGatewayDouble()
    const second = createGatewayDouble()
    override.gateway = first
    const { result, rerender } = renderHook(() => useNotificationsQueries(), {
      wrapper: ({ children }) => <ApiClientProvider gateway={first}>{children}</ApiClientProvider>,
    })
    const before = result.current

    rerender()
    expect(result.current).toBe(before)

    override.gateway = second
    rerender()
    expect(result.current).not.toBe(before)
  })

  test('web-dec-140 — subscription() が View を返し、gateway には request を 1 件も出さない（既存購読あり）', async () => {
    holder.port = createFakePushBrowserPort({ getExistingSubscription: async () => EXISTING })
    const gateway = createGatewayDouble()
    const { result } = renderHook(() => useNotificationsQueries(), {
      wrapper: ({ children }) => <ApiClientProvider gateway={gateway}>{children}</ApiClientProvider>,
    })

    const view = await result.current.subscription()

    expect(view).toEqual({ state: 'subscribed', supported: true })
    expect(gateway.calls).toEqual([])
  })
})
