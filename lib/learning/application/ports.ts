// Learning application の port。実装は infrastructure（learningGateway・seenAchievementsStore）が持つ（HTTP・DTO・保存庫はここに現れない）。
// 型だけの module。
import type { QuizReceipt } from '@/lib/learning/application/commands'
import type { DashboardSnapshot, StreakSummary, VocabularySummary } from '@/lib/learning/application/readModels'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { DifficultyLevel } from '@/lib/shared/difficulty'
import type { Result } from '@/lib/shared/result'

/** 難易度の提案の取得結果。提案を出すかの判断は domain（isOffered）。 */
export interface SuggestionRecord {
  readonly hasSuggestion: boolean
  readonly suggested: DifficultyLevel | null
  readonly reason: string | null
}

export interface LearningGateway {
  registerTerm(episodeId: string, term: string): Promise<Result<void, ApiFailure>>
  submitQuiz(episodeId: string, answers: ReadonlyArray<number>): Promise<Result<QuizReceipt, ApiFailure>>
  /** 登録済みの語。 */
  listRegisteredTerms(): Promise<Result<ReadonlyArray<string>, ApiFailure>>
  getListeningStreak(): Promise<Result<StreakSummary, ApiFailure>>
  getLearningDashboard(): Promise<Result<DashboardSnapshot, ApiFailure>>
  getVocabularySummary(): Promise<Result<VocabularySummary, ApiFailure>>
  /** 期限の来た語の件数（出題の items.length）。 */
  countDueTestItems(): Promise<Result<number, ApiFailure>>
  getDifficultySuggestion(): Promise<Result<SuggestionRecord, ApiFailure>>
}

/** 既読の実績の id の保存庫。 */
export interface SeenAchievementsStore {
  read(): ReadonlySet<string>
  write(ids: ReadonlyArray<string>): void
  clear(): void
}
