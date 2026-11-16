// Learning の query（web-query-learning-03〜06）: 登録済みの語・ストリーク・ダッシュボード・難易度の提案。読むだけで書かない。
import { newlyUnlocked } from '@/lib/learning/domain/achievements'
import { isOffered } from '@/lib/learning/domain/difficultySuggestion'
import { increased } from '@/lib/learning/domain/streak'
import type { LearningGateway, SeenAchievementsStore } from '@/lib/learning/application/ports'
import type {
  DashboardResult,
  StreakSummary,
  StreakView,
  SuggestionView,
} from '@/lib/learning/application/readModels'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

export interface LearningQueries {
  getRegisteredTerms(): Promise<Result<ReadonlySet<string>, ApiFailure>>
  /** 取得できなかったとき・throw は null（呼び手は前の値を保つ）。reject しない。 */
  getStreak(previous: StreakSummary | null): Promise<StreakView | null>
  /** 3 つを並行に取り、各 slot は失敗なら null（独立）。reject しない。 */
  getDashboard(): Promise<DashboardResult>
  /** 提案なし・取得失敗はどちらも null。reject しない。 */
  getDifficultySuggestion(): Promise<SuggestionView | null>
}

export interface LearningQueryDeps {
  readonly gateway: LearningGateway
  /** query は読むだけ（読む操作に書込みを付けない）。 */
  readonly seenAchievements: Pick<SeenAchievementsStore, 'read'>
}

// 入れ子の object・配列を複製して全階層を凍結する。gateway の値を共有せず、呼ぶたびに別の凍結済みの値を返す（web-check-06）。
// 戻り値の型は入力と同じ形（複製なので構造は変わらない）。
function frozenCopy<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map((item: unknown) => frozenCopy(item))) as T
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).map(([key, child]): [string, unknown] => [key, frozenCopy(child)])
    return Object.freeze(Object.fromEntries(entries)) as T
  }
  return value
}

// 失敗・reject・同期 throw をまとめて null にする。
async function valueOrNull<T>(call: () => Promise<Result<T, ApiFailure>>): Promise<T | null> {
  try {
    const result = await call()
    return result.ok ? result.value : null
  } catch {
    return null
  }
}

export function createLearningQueries({ gateway, seenAchievements }: LearningQueryDeps): LearningQueries {
  return {
    async getRegisteredTerms() {
      const result = await gateway.listRegisteredTerms()
      // Set は凍結しても add が throw しないが、呼ぶたびに新しい凍結済みの値を返して共有を避ける。
      return result.ok ? { ok: true, value: Object.freeze(new Set(result.value)) } : result
    },
    async getStreak(previous) {
      const next = await valueOrNull(() => gateway.getListeningStreak())
      if (next === null) return null
      return frozenCopy({
        days: next.days,
        todayListened: next.todayListened,
        lastListenedDay: next.lastListenedDay,
        justIncreased: increased(previous, next),
      })
    },
    async getDashboard() {
      const [snapshot, vocabulary, dueTestCount] = await Promise.all([
        valueOrNull(() => gateway.getLearningDashboard()),
        valueOrNull(() => gateway.getVocabularySummary()),
        valueOrNull(() => gateway.countDueTestItems()),
      ])
      const dashboard =
        snapshot === null
          ? null
          : frozenCopy({
              ...snapshot,
              newlyUnlocked: newlyUnlocked(snapshot.achievements, seenAchievements.read()),
            })
      return Object.freeze({ dashboard, vocabulary: frozenCopy(vocabulary), dueTestCount })
    },
    async getDifficultySuggestion() {
      const record = await valueOrNull(() => gateway.getDifficultySuggestion())
      if (record === null || !isOffered(record.hasSuggestion)) return null
      return frozenCopy({ suggested: record.suggested, reason: record.reason })
    },
  }
}
