// Preferences の command: web-cmd-prefs-02（難易度。最新の要求だけを反映する: web-rule-prefs-03）・web-cmd-prefs-03（週の目標）。
// 元の値へ戻す・toast を出すのは presentation。ここは stale の判定だけを持つ。
import type { PreferencesGateway } from '@/lib/preferences/application/ports'
import type { WeeklyGoal as WeeklyGoalChoice } from '@/lib/preferences/domain/settings'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { DifficultyLevel } from '@/lib/shared/difficulty'
import type { Result } from '@/lib/shared/result'

export interface PreferencesCommands {
  /** stale: true は「先に送った古い要求の結果」で、presentation は何もしない。最新の reject は握りつぶさず再 throw する。 */
  setDefaultDifficulty(level: DifficultyLevel): Promise<Result<{ readonly stale: boolean }, ApiFailure>>
  setWeeklyGoal(goal: WeeklyGoalChoice): Promise<Result<void, ApiFailure>>
}

const STALE = Object.freeze({ stale: true })
const LATEST = Object.freeze({ stale: false })

export function createPreferencesCommands({ gateway }: { readonly gateway: PreferencesGateway }): PreferencesCommands {
  // 連打や提案の適用で要求が重なったとき、最新の要求だけを反映するための連番。instance ごとの closure に置く。
  let latestRequest = 0
  return {
    async setDefaultDifficulty(level) {
      const requestId = ++latestRequest
      const isLatest = () => requestId === latestRequest
      let result: Result<void, ApiFailure>
      try {
        result = await gateway.patch({ kind: 'defaultDifficulty', value: level })
      } catch (error) {
        if (isLatest()) throw error
        return { ok: true, value: STALE }
      }
      if (!isLatest()) return { ok: true, value: STALE }
      return result.ok ? { ok: true, value: LATEST } : result
    },
    async setWeeklyGoal(goal) {
      return gateway.patch({ kind: 'weeklyGoal', value: goal })
    },
  }
}
