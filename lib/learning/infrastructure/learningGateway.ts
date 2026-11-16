// port LearningGateway の実装。lib/api の vocabulary・podcasts を呼び、DTO を application の型に写す。
import type { LearningGateway } from '@/lib/learning/application/ports'
import type { QuizReceipt } from '@/lib/learning/application/commands'
import type { ApiGateway } from '@/lib/api/gateway'
import { getVocabulary, getVocabularyTestSession, saveVocabulary, submitVocabularyTestResult } from '@/lib/api/vocabulary'
import { getDifficultySuggestion, getLearningDashboard, getListeningStreak } from '@/lib/api/users'
import { submitQuizAnswers } from '@/lib/api/podcasts'
import type { DashboardSnapshot, StreakSummary, VocabularySummary } from '@/lib/learning/application/readModels'
import type { ListeningStreak, QuizAnswerResponse, VocabularyListResponse, LearningDashboard } from '@/types'

// 日付だけの表示用の値は application が持つので、切り出しはここ（gateway）だけで行う。
const toDay = (timestamp: string): string => timestamp.slice(0, 10)

function toStreak(dto: ListeningStreak): StreakSummary {
  return Object.freeze({
    days: dto.current_streak_days,
    todayListened: dto.today_listened,
    lastListenedDay: dto.last_listened_day,
  })
}

// weekly_goal が null・欠落の応答は weeklyGoal: null（その節だけを出さない現行の挙動）にする。
function toSnapshot(dto: LearningDashboard): DashboardSnapshot {
  const goal = (dto as { weekly_goal?: LearningDashboard['weekly_goal'] | null }).weekly_goal ?? null
  return Object.freeze({
    streak: toStreak(dto.streak),
    totalEpisodes: dto.total_episodes,
    vocabularyAcquired: dto.vocabulary_acquired,
    currentDifficulty: dto.current_difficulty,
    weeklyGoal:
      goal === null
        ? null
        : Object.freeze({
            goalEpisodes: goal.goal_episodes,
            completedThisWeek: goal.completed_this_week,
            history: Object.freeze(
              goal.history.map((record) =>
                Object.freeze({ week: record.week, goal: record.goal, completed: record.completed }),
              ),
            ),
          }),
    monthly: Object.freeze(
      dto.monthly_activity.map((entry) => Object.freeze({ month: entry.month, activeDays: entry.active_days })),
    ),
    quiz: Object.freeze({
      quizzedEpisodes: dto.quiz.quizzed_episodes,
      averageCorrectRate: dto.quiz.average_correct_rate,
      trend: Object.freeze(
        dto.quiz.trend.map((point) =>
          Object.freeze({
            gradedAt: point.graded_at,
            gradedDay: toDay(point.graded_at),
            correctRate: point.correct_rate,
          }),
        ),
      ),
    }),
    achievements: Object.freeze(
      dto.achievements.map((a) => Object.freeze({ id: a.id, unlockedAt: a.unlocked_at })),
    ),
  })
}

function toVocabularySummary(dto: VocabularyListResponse): VocabularySummary {
  return Object.freeze({
    count: dto.count,
    items: Object.freeze(
      dto.vocabulary.map((item) =>
        Object.freeze({
          id: item.vocabulary_id,
          term: item.term,
          meaning: item.meaning,
          registeredAt: item.registered_at,
          registeredDay: toDay(item.registered_at),
        }),
      ),
    ),
  })
}

// correct_rate は application が持たないので捨てる。
function toReceipt(dto: QuizAnswerResponse): QuizReceipt {
  return Object.freeze({
    correct: dto.correct_count,
    total: dto.total,
    results: Object.freeze(
      dto.results.map((r) =>
        Object.freeze({
          questionIndex: r.question_index,
          selectedIndex: r.selected_index,
          correctIndex: r.correct_index,
          isCorrect: r.is_correct,
        }),
      ),
    ),
  })
}

export function createLearningGateway(gateway: ApiGateway): LearningGateway {
  return {
    async registerTerm(episodeId, term) {
      const result = await saveVocabulary(gateway, episodeId, term)
      return result.ok ? { ok: true, value: undefined } : result
    },
    async submitQuiz(episodeId, answers) {
      // lib/api は可変の number[] を受けるので、複製して渡す。
      const result = await submitQuizAnswers(gateway, episodeId, [...answers])
      return result.ok ? { ok: true, value: toReceipt(result.value) } : result
    },
    async listRegisteredTerms() {
      const result = await getVocabulary(gateway)
      return result.ok ? { ok: true, value: result.value.vocabulary.map((v) => v.term) } : result
    },
    async getListeningStreak() {
      const result = await getListeningStreak(gateway)
      return result.ok ? { ok: true, value: toStreak(result.value) } : result
    },
    async getLearningDashboard() {
      const result = await getLearningDashboard(gateway)
      return result.ok ? { ok: true, value: toSnapshot(result.value) } : result
    },
    async getVocabularySummary() {
      const result = await getVocabulary(gateway)
      return result.ok ? { ok: true, value: toVocabularySummary(result.value) } : result
    },
    async countDueTestItems() {
      const result = await getVocabularyTestSession(gateway)
      return result.ok ? { ok: true, value: result.value.items.length } : result
    },
    async getDifficultySuggestion() {
      const result = await getDifficultySuggestion(gateway)
      if (!result.ok) return result
      const { has_suggestion, suggested, reason } = result.value
      return { ok: true, value: Object.freeze({ hasSuggestion: has_suggestion, suggested, reason }) }
    },
    async getVocabularyTestSession() {
      const result = await getVocabularyTestSession(gateway)
      if (!result.ok) return result
      const words = result.value.items.map((item) => ({
        vocabularyId: item.vocabulary_id,
        term: item.term,
        meaning: item.meaning,
        example: item.example,
        distractors: [...item.distractors],
      }))
      return { ok: true, value: words }
    },
    async submitVocabularyTestResults(results) {
      // DTO の key（snake_case）はここだけが持つ（web-rule-learning-03・web-rule-learning-07）。
      const payload = results.map((r) => ({ vocabulary_id: r.vocabularyId, self_known: r.selfKnown, retest_correct: r.retestCorrect }))
      const result = await submitVocabularyTestResult(gateway, payload)
      return result.ok ? { ok: true, value: undefined } : result
    },
  }
}
