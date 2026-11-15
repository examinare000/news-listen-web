import { createGateway } from '@/lib/api/gateway'
import { createErrorReporter } from '@/lib/platform/errorReporter'
import type { ReportClientError } from '@/lib/platform/application/errorReporting'

// root layout が壊れると Provider が無いので、専用 root が通報の操作を自分で組み立てる。
export function createGlobalErrorReporter(): ReportClientError {
  return createErrorReporter(createGateway())
}
