import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// 監視基盤への送信はモックして呼び出しのみ検証する（実 fetch は走らせない・issue #83）。
vi.mock('@/lib/reportClientError', () => ({ reportClientError: vi.fn() }))
import { reportClientError } from '@/lib/reportClientError'

// Import the modules to access their default exports
import * as ErrorModule from '@/app/error'
import * as GlobalErrorModule from '@/app/global-error'

beforeEach(() => {
  vi.clearAllMocks()
})

// Extract the exported functions
const ErrorPage = ErrorModule.default
const GlobalError = GlobalErrorModule.default

describe('Error boundary (app/error.tsx)', () => {
  it('renders Japanese fallback heading and body when error is thrown', () => {
    const resetFn = vi.fn()
    const testError = new Error('secret-detail-xyz')

    render(
      React.createElement(ErrorPage, {
        error: testError,
        reset: resetFn,
      }),
    )

    // Assert fallback heading is present
    expect(screen.getByText('予期しないエラーが発生しました')).toBeInTheDocument()

    // Assert fallback body is present
    expect(
      screen.getByText(/時間をおいて再度お試しください/),
    ).toBeInTheDocument()
  })

  it('does NOT leak error.message to the UI', () => {
    const resetFn = vi.fn()
    const testError = new Error('secret-detail-xyz')

    render(
      React.createElement(ErrorPage, {
        error: testError,
        reset: resetFn,
      }),
    )

    // Assert the secret message is NOT in the DOM
    expect(screen.queryByText(/secret-detail-xyz/)).not.toBeInTheDocument()
  })

  it('reports the error to the monitoring sink without leaking to the DOM (#83)', () => {
    const testError = Object.assign(new Error('secret-detail-xyz'), { digest: 'dig-1' })

    render(React.createElement(ErrorPage, { error: testError, reset: vi.fn() }))

    expect(reportClientError).toHaveBeenCalledWith({
      source: 'web',
      kind: 'render',
      message: 'secret-detail-xyz',
      context: { digest: 'dig-1' },
    })
    // 送信しても DOM には漏らさない（no-leak 契約）。
    expect(screen.queryByText(/secret-detail-xyz/)).not.toBeInTheDocument()
  })

  it('calls reset when 再試行 button is clicked', async () => {
    const resetFn = vi.fn()
    const testError = new Error('test-error')
    const user = userEvent.setup()

    render(
      React.createElement(ErrorPage, {
        error: testError,
        reset: resetFn,
      }),
    )

    const resetButton = screen.getByRole('button', { name: '再試行' })
    await user.click(resetButton)

    expect(resetFn).toHaveBeenCalledOnce()
  })
})

describe('Global error boundary (app/global-error.tsx)', () => {
  it('renders Japanese fallback heading and body for root layout errors', () => {
    const resetFn = vi.fn()
    const testError = new Error('root-layout-secret')

    render(
      React.createElement(GlobalError, {
        error: testError,
        reset: resetFn,
      }),
    )

    // Assert fallback heading is present
    expect(screen.getByText('予期しないエラーが発生しました')).toBeInTheDocument()

    // Assert fallback body is present
    expect(
      screen.getByText(/時間をおいて再度お試しください/),
    ).toBeInTheDocument()
  })

  it('does NOT leak error.message for root layout errors', () => {
    const resetFn = vi.fn()
    const testError = new Error('root-layout-secret')

    render(
      React.createElement(GlobalError, {
        error: testError,
        reset: resetFn,
      }),
    )

    // Assert the secret message is NOT in the DOM
    expect(screen.queryByText(/root-layout-secret/)).not.toBeInTheDocument()
  })

  it('reports the root-layout error to the monitoring sink without leaking (#83)', () => {
    const testError = new Error('root-layout-secret')

    render(React.createElement(GlobalError, { error: testError, reset: vi.fn() }))

    expect(reportClientError).toHaveBeenCalledWith({
      source: 'web',
      kind: 'global',
      message: 'root-layout-secret',
      context: undefined,
    })
    expect(screen.queryByText(/root-layout-secret/)).not.toBeInTheDocument()
  })

  it('calls reset when 再試行 button is clicked in global error', async () => {
    const resetFn = vi.fn()
    const testError = new Error('test-error')
    const user = userEvent.setup()

    render(
      React.createElement(GlobalError, {
        error: testError,
        reset: resetFn,
      }),
    )

    const resetButton = screen.getByRole('button', { name: '再試行' })
    await user.click(resetButton)

    expect(resetFn).toHaveBeenCalledOnce()
  })
})
