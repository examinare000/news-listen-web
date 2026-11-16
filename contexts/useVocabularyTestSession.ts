'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { useApiClient } from '@/contexts/ApiClientProvider'
import { createBrowserSeenAchievementsStore } from '@/contexts/seenAchievementsSession'
import { createLearningQueries } from '@/lib/learning/application/queries'
import type { VocabularyTestView } from '@/lib/learning/application/readModels'
import { createVocabularyTestSession, type VocabularyTestSession } from '@/lib/learning/application/vocabularyTestSession'
import { createLearningGateway } from '@/lib/learning/infrastructure/learningGateway'

export interface UseVocabularyTestSession {
  readonly view: VocabularyTestView
  readonly commands: Pick<VocabularyTestSession, 'startVocabularyTest' | 'assessVocabulary' | 'answerRetest' | 'submitVocabularyTest'>
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

// Fisher-Yates。呼ぶのは session の command の中だけで、render の中では呼ばない。
function shuffle(choices: ReadonlyArray<string>): ReadonlyArray<string> {
  const shuffled = [...choices]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

/** composition root: マウントごとに 1 つの単語テスト session を持ち、view を購読する（Provider は作らない。state は session が所有する）。 */
export function useVocabularyTestSession(): UseVocabularyTestSession {
  const apiGateway = useApiClient()
  // useMemo にしない: メモは捨てられうるので、session（状態の所有者）はマウントごとに 1 つ作る。gateway は ApiClientProvider が固定している。
  const [{ session, commands }] = useState(() => {
    const learningGateway = createLearningGateway(apiGateway)
    const queries = createLearningQueries({ gateway: learningGateway, seenAchievements: createBrowserSeenAchievementsStore() })
    const created = createVocabularyTestSession({ queries, gateway: learningGateway, wait, shuffle })
    return {
      session: created,
      commands: {
        startVocabularyTest: created.startVocabularyTest,
        assessVocabulary: created.assessVocabulary,
        answerRetest: created.answerRetest,
        submitVocabularyTest: created.submitVocabularyTest,
      },
    }
  })
  const view = useSyncExternalStore(session.subscribe, session.vocabularyTestView, session.vocabularyTestView)
  useEffect(() => () => session.dispose(), [session])
  return { view, commands }
}
