'use client'

import { useEffect } from 'react'
import { useErrorReporting } from '@/contexts/ErrorReportingProvider'

// グローバルな未捕捉エラーを監視基盤へ送る（issue #83）。
// error.tsx / global-error.tsx は React のレンダリングエラーのみを捕捉するため、
// 非同期・イベントハンドラ由来のエラーは window の error / unhandledrejection で拾う。
export function ClientErrorReporter() {
  const report = useErrorReporting()
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      report({ source: 'web', kind: 'window', message: e.message })
    }
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason as unknown
      const message =
        reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : 'unhandledrejection'
      report({ source: 'web', kind: 'unhandledrejection', message })
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [report])

  return null
}
