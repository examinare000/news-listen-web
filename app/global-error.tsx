'use client'

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  // WHY: like error.tsx, never leak error.message / error.stack / error.digest to UI.
  // This boundary handles root layout initialization failures.
  // TODO 監視基盤へ送る場合はここ
  // Do NOT log sensitive error details

  return (
    <html lang="ja">
      <body style={{ margin: 0, padding: 0, fontFamily: 'system-ui, sans-serif' }}>
        <main
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            padding: '20px',
            textAlign: 'center',
          }}
        >
          <div style={{ maxWidth: '600px' }}>
            <h1 style={{ marginTop: 0, marginBottom: '16px', fontSize: '24px' }}>
              予期しないエラーが発生しました
            </h1>
            <p style={{ marginBottom: '32px', color: '#666' }}>
              時間をおいて再度お試しください。問題が続く場合は管理者にお問い合わせください。
            </p>
            <button
              onClick={() => reset()}
              style={{
                padding: '10px 24px',
                fontSize: '16px',
                fontWeight: 600,
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                backgroundColor: '#0066cc',
                color: 'white',
              }}
            >
              再試行
            </button>
          </div>
        </main>
      </body>
    </html>
  )
}
