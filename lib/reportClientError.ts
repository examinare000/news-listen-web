// クライアントエラーを監視基盤（backend /client-errors → Cloud Logging）へ送る（issue #83）。
//
// 設計:
// - BFF プロキシ経由で POST する（サーバー側で X-API-Key 注入・/client-errors は CSRF 免除）。
// - 送信失敗は握りつぶす（エラー報告で本処理を壊さない）。
// - keepalive: ページ遷移・unload 中のエラーも送れるようにする。
// - no-leak 契約は UI/console 非表示が対象。監視基盤への送信は TODO の本来用途であり、
//   PII/秘密は backend の scrub() が送出時に伏せる。

export interface ClientErrorReport {
  source: 'web'
  kind: 'render' | 'global' | 'window' | 'unhandledrejection'
  message?: string
  context?: Record<string, unknown>
}

export function reportClientError(report: ClientErrorReport): void {
  try {
    // backend スキーマの message 上限（4000 字）に合わせて切り詰める（超過で 422 → 無言ドロップを防ぐ）。
    const safe: ClientErrorReport =
      report.message !== undefined ? { ...report, message: report.message.slice(0, 4000) } : report
    void fetch('/api/backend/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      keepalive: true,
      body: JSON.stringify(safe),
    }).catch(() => {
      // 送信失敗はサイレント（報告で本処理を壊さない）
    })
  } catch {
    // fetch 自体が投げても握りつぶす
  }
}
