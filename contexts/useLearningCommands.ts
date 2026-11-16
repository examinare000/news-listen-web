'use client'

import { useMemo } from 'react'
import { useApiClient } from '@/contexts/ApiClientProvider'
import { createLearningCommands, type LearningCommands } from '@/lib/learning/application/commands'
import { createBrowserSeenAchievementsStore } from '@/contexts/seenAchievementsSession'
import { createLearningGateway } from '@/lib/learning/infrastructure/learningGateway'

/** composition root: useApiClient() の gateway から LearningCommands を組み立てる（gateway が同じ間は同じ object）。 */
export function useLearningCommands(): LearningCommands {
  const gateway = useApiClient()
  return useMemo(() => createLearningCommands({ gateway: createLearningGateway(gateway), seenAchievements: createBrowserSeenAchievementsStore() }), [gateway])
}
