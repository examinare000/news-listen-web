'use client'

import { useEffect } from 'react'
import { reportClientError } from '@/lib/reportClientError'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  // WHY: the error object may contain sensitive stack traces or digests;
  // never log or render these to the UI. UI/console には出さず、監視基盤(backend /client-errors)へのみ送る。
  // backend の scrub() が PII/秘密を送出時に伏せる（no-leak 契約は UI/console が対象・issue #83）。
  useEffect(() => {
    reportClientError({
      source: 'web',
      kind: 'render',
      message: error.message,
      context: error.digest ? { digest: error.digest } : undefined,
    })
  }, [error])

  // WHY: 既存の empty-state デザイントークンを再利用し、独自クラスを増やさず統一感を保つ
  return (
    <main className="content-area">
      <div className="empty-state">
        <div className="empty-state-icon" aria-hidden="true">⚠</div>
        <h1 className="empty-state-title">予期しないエラーが発生しました</h1>
        <p className="empty-state-desc">
          時間をおいて再度お試しください。問題が続く場合は管理者にお問い合わせください。
        </p>
        <button onClick={() => reset()} className="btn btn-primary" style={{ marginTop: 16 }}>
          再試行
        </button>
      </div>
    </main>
  )
}
