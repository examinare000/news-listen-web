// Learning application の port。実装は infrastructure（learningGateway）が持つ（HTTP・DTO はここに現れない）。
// 型だけの module。
import type { QuizReceipt } from '@/lib/learning/application/commands'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

export interface LearningGateway {
  registerTerm(episodeId: string, term: string): Promise<Result<void, ApiFailure>>
  submitQuiz(episodeId: string, answers: ReadonlyArray<number>): Promise<Result<QuizReceipt, ApiFailure>>
  /** 登録済みの語。 */
  listRegisteredTerms(): Promise<Result<ReadonlyArray<string>, ApiFailure>>
}
