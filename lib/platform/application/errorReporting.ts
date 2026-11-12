export interface ClientErrorReport {
  readonly source: 'web'
  readonly kind: 'render' | 'global' | 'window' | 'unhandledrejection'
  readonly message?: string
  readonly context?: Readonly<Record<string, unknown>>
}

// 送信の成否は呼び手へ伝えない（通報で本処理を壊さない）。
export type ReportClientError = (report: ClientErrorReport) => void
