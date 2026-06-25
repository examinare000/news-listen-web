'use client'

export default function Error({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  // WHY: the error object may contain sensitive stack traces or digests;
  // never log or render these to the UI. Log handling deferred to monitoring platform.
  // TODO 監視基盤へ送る場合はここ
  // Do NOT log error.message / error.stack / error.digest — they may leak internals

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
