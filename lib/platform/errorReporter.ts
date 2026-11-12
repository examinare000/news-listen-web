// クライアントエラーを監視基盤（backend /client-errors → Cloud Logging）へ gateway 経由で送る（web-usecase-21）。
//
// - 送信失敗は握りつぶす（エラー通報で本処理を壊さない）。retry はしない。
// - keepalive: ページ遷移・unload 中のエラーも送れるようにする。
// - no-leak 契約は UI/console 非表示が対象。PII/秘密は backend の scrub() が送出時に伏せる。
import type { ApiGateway } from '@/lib/api/gateway'
import type { ClientErrorReport, ReportClientError } from '@/lib/platform/application/errorReporting'

// backend スキーマの message 上限（超過で 422 → 無言ドロップを防ぐ）。
const MESSAGE_LIMIT = 4000

export function createErrorReporter(gateway: ApiGateway): ReportClientError {
  return (report) => {
    try {
      const safe: ClientErrorReport =
        report.message !== undefined && report.message.length > MESSAGE_LIMIT
          ? { ...report, message: report.message.slice(0, MESSAGE_LIMIT) }
          : report
      gateway
        .request('/api/backend/client-errors', { method: 'POST', body: safe, keepalive: true, noContent: true })
        .catch(() => {
          // request の reject も握る（未処理の reject を残さない。送信失敗で本処理を壊さない）
        })
    } catch {
      // request 自体が同期で投げても握りつぶす
    }
  }
}
