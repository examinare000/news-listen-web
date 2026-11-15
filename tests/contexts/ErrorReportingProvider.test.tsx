import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import React from 'react'
import { ErrorReportingProvider, useErrorReporting } from '@/contexts/ErrorReportingProvider'
import type { ReportClientError, ClientErrorReport } from '@/contexts/ErrorReportingProvider'
import { ApiClientProvider, useApiClient } from '@/contexts/ApiClientProvider'
import { createGatewayDouble } from '../helpers/gatewayDouble'
import type { GatewayDouble } from '../helpers/gatewayDouble'

// web-dec-148: 通常画面のエラー通報の操作を 1 回だけ組み立てて配る Provider。

const holder = vi.hoisted(() => ({ gw: undefined as GatewayDouble | undefined }))

vi.mock('@/lib/api/gateway', () => ({ createGateway: () => holder.gw }))

const PATH = '/api/backend/client-errors'
const report: ClientErrorReport = { source: 'web', kind: 'render', message: 'boom', context: { digest: 'd1' } }

let gw: GatewayDouble

beforeEach(() => {
  gw = createGatewayDouble()
  holder.gw = gw
})

function Reader({ onRead }: { onRead: (r: ReportClientError) => void }) {
  onRead(useErrorReporting())
  return null
}

describe('ErrorReportingProvider — web-dec-148', () => {
  test('配った操作を呼ぶと、createGateway が返した gateway に POST /client-errors が出る', async () => {
    let reporter: ReportClientError | undefined
    render(
      <ErrorReportingProvider>
        <Reader onRead={(r) => (reporter = r)} />
      </ErrorReportingProvider>,
    )

    reporter?.(report)

    await waitFor(() => expect(gw.calls).toEqual([{ method: 'POST', path: PATH, body: report }]))
  })

  test('再描画しても useErrorReporting() の戻り値は同一参照（組み立ては 1 回）', () => {
    const seen: ReportClientError[] = []
    const { rerender } = render(
      <ErrorReportingProvider>
        <Reader onRead={(r) => seen.push(r)} />
      </ErrorReportingProvider>,
    )
    rerender(
      <ErrorReportingProvider>
        <Reader onRead={(r) => seen.push(r)} />
      </ErrorReportingProvider>,
    )

    expect(seen.length).toBeGreaterThanOrEqual(2)
    expect(new Set(seen).size).toBe(1)
  })

  test('Provider の外で useErrorReporting() を呼ぶと throw する', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(() => render(<Reader onRead={() => {}} />)).toThrow(
        'useErrorReporting must be used within ErrorReportingProvider',
      )
    } finally {
      consoleError.mockRestore()
    }
  })

  test('/client-errors が unauthorized でも、外側の ApiClientProvider の onUnauthorized を呼ばない', async () => {
    gw.respond('POST', PATH, { ok: false, failure: { kind: 'unauthorized' } })
    const onUnauthorized = vi.fn()
    let reporter: ReportClientError | undefined
    render(
      <ApiClientProvider onUnauthorized={onUnauthorized}>
        <ErrorReportingProvider>
          <Reader onRead={(r) => (reporter = r)} />
        </ErrorReportingProvider>
      </ApiClientProvider>,
    )

    reporter?.(report)

    await waitFor(() => expect(gw.calls).toHaveLength(1))
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  test('正方向の対照: 同じ構成で useApiClient() 経由の同じ request は onUnauthorized を 1 回呼ぶ', async () => {
    gw.respond('POST', PATH, { ok: false, failure: { kind: 'unauthorized' } })
    const onUnauthorized = vi.fn()
    const clients: ReturnType<typeof useApiClient>[] = []
    function ClientReader() {
      clients.push(useApiClient())
      return null
    }
    render(
      <ApiClientProvider onUnauthorized={onUnauthorized}>
        <ErrorReportingProvider>
          <ClientReader />
        </ErrorReportingProvider>
      </ApiClientProvider>,
    )

    await clients[0]?.request(PATH, { method: 'POST', body: report, noContent: true })

    await waitFor(() => expect(onUnauthorized).toHaveBeenCalledTimes(1))
  })

  test('描画しただけでは通報しない', () => {
    render(
      <ErrorReportingProvider>
        <Reader onRead={() => {}} />
      </ErrorReportingProvider>,
    )

    expect(gw.calls).toEqual([])
  })
})
