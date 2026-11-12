'use client'

import { useState } from 'react'
import { GlobalErrorFallback } from '@/components/GlobalErrorFallback'
import { createGlobalErrorReporter } from '@/lib/composition/globalError'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const [report] = useState(createGlobalErrorReporter)
  return <GlobalErrorFallback error={error} reset={reset} report={report} />
}
