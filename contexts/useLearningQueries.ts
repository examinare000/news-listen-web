'use client'

import { useMemo } from 'react'
import { useApiClient } from '@/contexts/ApiClientProvider'
import { createLearningQueries, type LearningQueries } from '@/lib/learning/application/queries'
import { createLearningGateway } from '@/lib/learning/infrastructure/learningGateway'

/** composition root: useApiClient() の gateway から LearningQueries を組み立てる（gateway が同じ間は同じ object）。 */
export function useLearningQueries(): LearningQueries {
  const gateway = useApiClient()
  return useMemo(() => createLearningQueries({ gateway: createLearningGateway(gateway) }), [gateway])
}
