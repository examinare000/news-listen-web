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

/** 単語テストの出題の 1 語。domain の VocabularyTestWord と同じ形（DTO 名と衝突させない）。 */
export interface VocabularyTestWordRecord {
  readonly vocabularyId: string
  readonly term: string
  readonly meaning: string
  readonly example: string
  readonly distractors: ReadonlyArray<string>
}

/** 単語テストの 1 語の回答。domain の VocabularyTestAnswer と同じ形。 */
export interface VocabularyTestAnswerRecord {
  readonly vocabularyId: string
  readonly selfKnown: boolean
  readonly retestCorrect: boolean | null
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
  /** 単語テストの出題（打ち切りは domain）。 */
  getVocabularyTestSession(): Promise<Result<ReadonlyArray<VocabularyTestWordRecord>, ApiFailure>>
  /** 単語テストの結果の送信。応答の件数は使わない。 */
  submitVocabularyTestResults(results: ReadonlyArray<VocabularyTestAnswerRecord>): Promise<Result<void, ApiFailure>>
}

/** 既読の実績の id の保存庫。 */
export interface SeenAchievementsStore {
  read(): ReadonlySet<string>
  write(ids: ReadonlyArray<string>): void
  clear(): void
}
