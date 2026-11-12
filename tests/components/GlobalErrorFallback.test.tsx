import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { GlobalErrorFallback } from '@/components/GlobalErrorFallback'

// web-usecase-21: Provider の外（root layout が壊れた画面）でも通報する専用 root の表示 component。
// 通報の操作は props で注入される。

describe('GlobalErrorFallback — web-usecase-21', () => {
  it('描画で kind: global の通報を 1 回呼ぶ（digest は context に載せる）', () => {
    const report = vi.fn()
    const error = Object.assign(new Error('root-layout-secret'), { digest: 'dig-9' })

    render(<GlobalErrorFallback error={error} reset={vi.fn()} report={report} />)

    expect(report).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledWith({
      source: 'web',
      kind: 'global',
      message: 'root-layout-secret',
      context: { digest: 'dig-9' },
    })
  })

  it('error.message を DOM に出さない', () => {
    render(<GlobalErrorFallback error={new Error('root-layout-secret')} reset={vi.fn()} report={vi.fn()} />)

    expect(screen.getByText('予期しないエラーが発生しました')).toBeInTheDocument()
    expect(screen.queryByText(/root-layout-secret/)).not.toBeInTheDocument()
  })

  it('同じ error・同じ report での再描画では再通報せず、別の error では通報する', () => {
    const report = vi.fn()
    const first = new Error('first')
    const { rerender } = render(<GlobalErrorFallback error={first} reset={vi.fn()} report={report} />)

    rerender(<GlobalErrorFallback error={first} reset={vi.fn()} report={report} />)
    expect(report).toHaveBeenCalledTimes(1)

    rerender(<GlobalErrorFallback error={new Error('second')} reset={vi.fn()} report={report} />)
    expect(report).toHaveBeenCalledTimes(2)
  })

  it('再試行ボタンで reset を呼ぶ', async () => {
    const reset = vi.fn()
    const user = userEvent.setup()
    render(<GlobalErrorFallback error={new Error('x')} reset={reset} report={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: '再試行' }))

    expect(reset).toHaveBeenCalledOnce()
  })
})
