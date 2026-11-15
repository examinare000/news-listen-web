'use client'

import React, { createContext, useContext, useState } from 'react'
import { createGateway } from '@/lib/api/gateway'
import { createErrorReporter } from '@/lib/platform/errorReporter'
import type { ReportClientError } from '@/lib/platform/application/errorReporting'

export type { ClientErrorReport, ReportClientError } from '@/lib/platform/application/errorReporting'

// 通報の unauthorized では expire を起こさない（現行と同じ）ため、ApiClientProvider の gateway は使わない。
const ErrorReportingContext = createContext<ReportClientError | null>(null)

export function ErrorReportingProvider({ children }: { children: React.ReactNode }) {
  const [report] = useState<ReportClientError>(() => createErrorReporter(createGateway()))
  return <ErrorReportingContext.Provider value={report}>{children}</ErrorReportingContext.Provider>
}

export function useErrorReporting(): ReportClientError {
  const ctx = useContext(ErrorReportingContext)
  if (!ctx) {
    throw new Error('useErrorReporting must be used within ErrorReportingProvider')
  }
  return ctx
}
