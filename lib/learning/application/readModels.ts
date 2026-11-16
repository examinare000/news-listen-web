// Learning の read model: Catalog の語彙と登録済みの集合を合成する（web-query-learning-04・web-rule-learning-04）。
import type { GlossaryEntry } from '@/lib/catalog/domain/episode'
import { isRegistered } from '@/lib/learning/domain/vocabulary'
import type { DifficultyLevel } from '@/lib/shared/difficulty'

export interface GlossaryView {
  readonly term: string
  readonly meaning: string
  readonly example: string
  readonly registered: boolean
}

export function toGlossaryViews(
  glossary: ReadonlyArray<GlossaryEntry>,
  registered: ReadonlySet<string>,
): ReadonlyArray<GlossaryView> {
  return Object.freeze(
    glossary.map((entry) =>
      Object.freeze({
        term: entry.term,
        meaning: entry.meaningJa,
        example: entry.example,
        registered: isRegistered(entry.term, registered),
      }),
    ),
  )
}

/** ストリークの取得結果。lastListenedDay は日付だけの文字列（未聴取は null）。 */
export interface StreakSummary {
  readonly days: number
  readonly todayListened: boolean
  readonly lastListenedDay: string | null
}

/** Provider が前の値と比べて演出するかを、application が決めて渡す（justIncreased）。 */
export interface StreakView extends StreakSummary {
  readonly justIncreased: boolean
}

export interface WeeklyGoalHistoryView {
  readonly week: string
  readonly goal: number
  readonly completed: number
}

export interface WeeklyGoalView {
  readonly goalEpisodes: number
  readonly completedThisWeek: number
  readonly history: ReadonlyArray<WeeklyGoalHistoryView>
}

export interface MonthlyActivityView {
  readonly month: string
  readonly activeDays: number
}

export interface QuizTrendView {
  /** key と time 要素の dateTime に使う全体の時刻。 */
  readonly gradedAt: string
  /** 表示用の日付だけの文字列（gateway が作る）。 */
  readonly gradedDay: string
  readonly correctRate: number
}

export interface QuizSummary {
  readonly quizzedEpisodes: number
  readonly averageCorrectRate: number | null
  readonly trend: ReadonlyArray<QuizTrendView>
}

export interface AchievementView {
  readonly id: string
  readonly unlockedAt: string
}

/** 学習ダッシュボード本体。weeklyGoal は応答に無ければ null（その節だけを出さない現行の挙動）。 */
export interface DashboardView {
  readonly streak: StreakSummary
  readonly totalEpisodes: number
  readonly vocabularyAcquired: number
  readonly currentDifficulty: string
  readonly weeklyGoal: WeeklyGoalView | null
  readonly monthly: ReadonlyArray<MonthlyActivityView>
  readonly quiz: QuizSummary
  readonly achievements: ReadonlyArray<AchievementView>
  /** achievements の順の、未通知の実績の id。 */
  readonly newlyUnlocked: ReadonlyArray<string>
}

/** gateway が返す形。newlyUnlocked は既読を読む application が作るので含めない。 */
export type DashboardSnapshot = Omit<DashboardView, 'newlyUnlocked'>

export interface VocabularyEntryView {
  readonly id: string
  readonly term: string
  readonly meaning: string
  readonly registeredAt: string
  readonly registeredDay: string
}

export interface VocabularySummary {
  readonly count: number
  readonly items: ReadonlyArray<VocabularyEntryView>
}

/** null はこの回は取れなかったことを表す（3 つは独立）。 */
export interface DashboardResult {
  readonly dashboard: DashboardView | null
  readonly vocabulary: VocabularySummary | null
  readonly dueTestCount: number | null
}

export interface SuggestionView {
  readonly suggested: DifficultyLevel | null
  readonly reason: string | null
}
