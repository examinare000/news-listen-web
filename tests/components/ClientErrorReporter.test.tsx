import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import React from 'react'

// issue #83: window の error / unhandledrejection を監視基盤へ送る。
vi.mock('@/lib/reportClientError', () => ({ reportClientError: vi.fn() }))
import { reportClientError } from '@/lib/reportClientError'
import { ClientErrorReporter } from '@/components/ClientErrorReporter'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ClientErrorReporter (#83)', () => {
  test('window error イベントを report する', () => {
    render(React.createElement(ClientErrorReporter))

    window.dispatchEvent(new ErrorEvent('error', { message: 'boom-async' }))

    expect(reportClientError).toHaveBeenCalledWith({
      source: 'web',
      kind: 'window',
      message: 'boom-async',
    })
  })

  test('unhandledrejection を report する', () => {
    render(React.createElement(ClientErrorReporter))

    // jsdom は PromiseRejectionEvent コンストラクタを持たないため Event で代用する。
    const event = Object.assign(new Event('unhandledrejection'), { reason: new Error('rej-boom') })
    window.dispatchEvent(event)

    expect(reportClientError).toHaveBeenCalledWith({
      source: 'web',
      kind: 'unhandledrejection',
      message: 'rej-boom',
    })
  })

  test('アンマウントでリスナーを解除する', () => {
    const { unmount } = render(React.createElement(ClientErrorReporter))
    unmount()

    window.dispatchEvent(new ErrorEvent('error', { message: 'after-unmount' }))
    expect(reportClientError).not.toHaveBeenCalled()
  })
})
