import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import React from 'react'

// issue #83: window の error / unhandledrejection を監視基盤へ送る。
import { ErrorReportingProvider } from '@/contexts/ErrorReportingProvider'
import { ClientErrorReporter } from '@/components/ClientErrorReporter'
import { createGatewayDouble } from '../helpers/gatewayDouble'
import type { GatewayDouble } from '../helpers/gatewayDouble'

const holder = vi.hoisted(() => ({ gw: undefined as GatewayDouble | undefined }))
vi.mock('@/lib/api/gateway', () => ({ createGateway: () => holder.gw }))

let gw: GatewayDouble

beforeEach(() => {
  vi.clearAllMocks()
  gw = createGatewayDouble()
  holder.gw = gw
})

describe('ClientErrorReporter (#83)', () => {
  test('window error イベントを report する', () => {
    render(React.createElement(ClientErrorReporter), { wrapper: ErrorReportingProvider })

    window.dispatchEvent(new ErrorEvent('error', { message: 'boom-async' }))

    expect(gw.calls).toEqual([
      {
        method: 'POST',
        path: '/api/backend/client-errors',
        body: { source: 'web', kind: 'window', message: 'boom-async' },
      },
    ])
  })

  test('unhandledrejection を report する', () => {
    render(React.createElement(ClientErrorReporter), { wrapper: ErrorReportingProvider })

    // jsdom は PromiseRejectionEvent コンストラクタを持たないため Event で代用する。
    const event = Object.assign(new Event('unhandledrejection'), { reason: new Error('rej-boom') })
    window.dispatchEvent(event)

    expect(gw.calls).toEqual([
      {
        method: 'POST',
        path: '/api/backend/client-errors',
        body: { source: 'web', kind: 'unhandledrejection', message: 'rej-boom' },
      },
    ])
  })

  test('アンマウントでリスナーを解除する', () => {
    const { unmount } = render(React.createElement(ClientErrorReporter), { wrapper: ErrorReportingProvider })
    unmount()

    window.dispatchEvent(new ErrorEvent('error', { message: 'after-unmount' }))
    expect(gw.calls).toEqual([])
  })
})
