import { describe, test, expect, vi, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import React from 'react'
import { ApiClientProvider, useApiClient } from '@/contexts/ApiClientProvider'
import { createGateway } from '@/lib/api/gateway'
import type { ApiGateway, ApiFailure, Result } from '@/lib/api/gateway'
import { createGatewayDouble } from '../helpers/gatewayDouble'

// verifies: CI-W1, CI-W2, CI-W3

function Reader({ onRead }: { onRead: (gw: ApiGateway) => void }) {
  onRead(useApiClient())
  return null
}

describe('ApiClientProvider', () => {
  test('verifies: CI-W1 - returns the gateway passed as a prop, unchanged across re-renders', () => {
    const gateway = createGateway()
    const seen: ApiGateway[] = []
    const { rerender } = render(
      <ApiClientProvider gateway={gateway}>
        <Reader onRead={(gw) => seen.push(gw)} />
      </ApiClientProvider>,
    )
    rerender(
      <ApiClientProvider gateway={gateway}>
        <Reader onRead={(gw) => seen.push(gw)} />
      </ApiClientProvider>,
    )

    expect(seen).toHaveLength(2)
    expect(seen[0]).toBe(gateway)
    expect(seen[1]).toBe(gateway)
  })

  test('verifies: CI-W1 - creates a gateway once when the prop is omitted, and keeps the same instance across re-renders', () => {
    const seen: ApiGateway[] = []
    const { rerender } = render(
      <ApiClientProvider>
        <Reader onRead={(gw) => seen.push(gw)} />
      </ApiClientProvider>,
    )
    rerender(
      <ApiClientProvider>
        <Reader onRead={(gw) => seen.push(gw)} />
      </ApiClientProvider>,
    )

    expect(seen).toHaveLength(2)
    expect(seen[0]).toBe(seen[1])
  })

  test('verifies: CI-W2 - throws when useApiClient() is called outside ApiClientProvider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(() => render(<Reader onRead={() => {}} />)).toThrow(
        'useApiClient must be used within ApiClientProvider',
      )
    } finally {
      consoleError.mockRestore()
    }
  })
})

describe('ApiClientProvider onUnauthorized', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function captureGateway(ui: (onRead: (gw: ApiGateway) => void) => React.ReactElement) {
    const seen: ApiGateway[] = []
    const utils = render(ui((gw) => seen.push(gw)))
    return { seen, ...utils }
  }

  test('unauthorized の失敗で callback を 1 回呼び、Result は同じオブジェクトを返す', async () => {
    const double = createGatewayDouble()
    const result: Result<unknown, ApiFailure> = { ok: false, failure: { kind: 'unauthorized' } }
    double.respond('GET', '/api/backend/me', result)
    const onUnauthorized = vi.fn()
    const { seen } = captureGateway((onRead) => (
      <ApiClientProvider gateway={double} onUnauthorized={onUnauthorized}>
        <Reader onRead={onRead} />
      </ApiClientProvider>
    ))

    const returned = await seen[0].request('/api/backend/me')

    expect(onUnauthorized).toHaveBeenCalledTimes(1)
    expect(returned).toBe(result)
  })

  const OTHER_RESULTS: ReadonlyArray<readonly [string, Result<unknown, ApiFailure>]> = [
    ['成功', { ok: true, value: { a: 1 } }],
    ['forbidden', { ok: false, failure: { kind: 'forbidden' } }],
    ['network', { ok: false, failure: { kind: 'network' } }],
  ]

  test.each(OTHER_RESULTS)('%s では callback を呼ばず、Result は同じオブジェクトを返す', async (_name, result) => {
    const double = createGatewayDouble()
    double.respond('GET', '/api/backend/x', result)
    const onUnauthorized = vi.fn()
    const { seen } = captureGateway((onRead) => (
      <ApiClientProvider gateway={double} onUnauthorized={onUnauthorized}>
        <Reader onRead={onRead} />
      </ApiClientProvider>
    ))

    const returned = await seen[0].request('/api/backend/x')

    expect(onUnauthorized).not.toHaveBeenCalled()
    expect(returned).toBe(result)
  })

  test('path と init（noContent を含む）を変えずに下の gateway へ 1 回渡す', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, value: undefined })
    const inner = { request } as unknown as ApiGateway
    const { seen } = captureGateway((onRead) => (
      <ApiClientProvider gateway={inner} onUnauthorized={vi.fn()}>
        <Reader onRead={onRead} />
      </ApiClientProvider>
    ))
    const init = { method: 'DELETE' as const, body: { password: 'p' }, noContent: true as const }

    await seen[0].request('/api/backend/auth/me', init)

    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith('/api/backend/auth/me', init)
  })

  test('再描画しても gateway は同一で、最新の callback だけが呼ばれる', async () => {
    const double = createGatewayDouble()
    double.respond('GET', '/api/backend/me', { ok: false, failure: { kind: 'unauthorized' } })
    const first = vi.fn()
    const second = vi.fn()
    const seen: ApiGateway[] = []
    const tree = (cb: () => void) => (
      <ApiClientProvider gateway={double} onUnauthorized={cb}>
        <Reader onRead={(gw) => seen.push(gw)} />
      </ApiClientProvider>
    )
    const { rerender } = render(tree(first))
    rerender(tree(second))

    expect(seen[seen.length - 1]).toBe(seen[0])
    await seen[0].request('/api/backend/me')

    await waitFor(() => expect(second).toHaveBeenCalledTimes(1))
    expect(first).not.toHaveBeenCalled()
  })

  test('gateway を省略した自前生成でも 401 の応答で callback を 1 回呼ぶ', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    const onUnauthorized = vi.fn()
    const { seen } = captureGateway((onRead) => (
      <ApiClientProvider onUnauthorized={onUnauthorized}>
        <Reader onRead={onRead} />
      </ApiClientProvider>
    ))

    const returned = await seen[0].request('/api/backend/me')

    expect(returned.ok).toBe(false)
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })
})
