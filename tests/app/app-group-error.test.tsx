import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// 監視基盤への送信はモックして呼び出しのみ検証する（tests/app/error.test.tsx と同じ方針）
vi.mock('@/lib/reportClientError', () => ({ reportClientError: vi.fn() }))
import { reportClientError } from '@/lib/reportClientError'

import AppGroupError from '@/app/(app)/error'

// WHY this file exists (as its own segment-scoped error boundary, not just relying on
// app/error.tsx): Next.js の error.tsx は自セグメントの children だけを覆い、同セグメントの
// layout.tsx はバウンダリの外側（＝エラー時も残る）。旧実装は NavigationBar/AudioPlayerBar を
// ルート layout 自身が描画していたため children ではなく、ページの描画エラーでシェルごと
// 巻き込まれることはなかった。シェルを app/(app)/layout.tsx へ移した今、(app) 配下のページの
// 描画エラーがそのままだとルートの error.tsx まで伝播し、(app)/layout.tsx ごと（＝シェルごと）
// アンマウントされてしまう。(app) 専用の error.tsx でその場で捕まえることでシェルの継続描画
// という既存挙動を保つ（e2e/offline-playback.e2e.ts で実挙動を検証）。
beforeEach(() => {
  vi.clearAllMocks()
})

describe('(app) route group error boundary (app/(app)/error.tsx)', () => {
  it('renders the same Japanese fallback heading and body as the root error boundary', () => {
    render(
      React.createElement(AppGroupError, {
        error: new Error('secret-detail-xyz'),
        reset: vi.fn(),
      }),
    )

    expect(screen.getByText('予期しないエラーが発生しました')).toBeInTheDocument()
    expect(screen.getByText(/時間をおいて再度お試しください/)).toBeInTheDocument()
  })

  it('does NOT leak error.message to the UI', () => {
    render(
      React.createElement(AppGroupError, {
        error: new Error('secret-detail-xyz'),
        reset: vi.fn(),
      }),
    )

    expect(screen.queryByText(/secret-detail-xyz/)).not.toBeInTheDocument()
  })

  it('reports the error to the monitoring sink without leaking to the DOM (#83 と同じ契約)', () => {
    const testError = Object.assign(new Error('secret-detail-xyz'), { digest: 'dig-1' })

    render(React.createElement(AppGroupError, { error: testError, reset: vi.fn() }))

    expect(reportClientError).toHaveBeenCalledWith({
      source: 'web',
      kind: 'render',
      message: 'secret-detail-xyz',
      context: { digest: 'dig-1' },
    })
    expect(screen.queryByText(/secret-detail-xyz/)).not.toBeInTheDocument()
  })

  it('calls reset when 再試行 button is clicked', async () => {
    const resetFn = vi.fn()
    const user = userEvent.setup()

    render(
      React.createElement(AppGroupError, {
        error: new Error('test-error'),
        reset: resetFn,
      }),
    )

    await user.click(screen.getByRole('button', { name: '再試行' }))

    expect(resetFn).toHaveBeenCalledOnce()
  })
})
