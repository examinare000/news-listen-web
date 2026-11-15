// Learning の command（web-cmd-learning-03・04）: 語の登録とクイズの送信。gateway へ委譲し、失敗は Result で返す。
import type { LearningGateway } from '@/lib/learning/application/ports'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

/** 採点結果の全体（receipt）。合否は持たない（presentation が domain の passed で決める）。 */
export interface QuizReceipt {
  readonly correct: number
  readonly total: number
  readonly results: readonly {
    readonly questionIndex: number
    readonly selectedIndex: number
    readonly correctIndex: number
    readonly isCorrect: boolean
  }[]
}

export interface LearningCommands {
  registerTerm(episodeId: string, term: string): Promise<Result<void, ApiFailure>>
  submitQuiz(episodeId: string, answers: ReadonlyArray<number>): Promise<Result<QuizReceipt, ApiFailure>>
}

export function createLearningCommands({ gateway }: { readonly gateway: LearningGateway }): LearningCommands {
  return {
    registerTerm: (episodeId, term) => gateway.registerTerm(episodeId, term),
    submitQuiz: (episodeId, answers) => gateway.submitQuiz(episodeId, answers),
  }
}
