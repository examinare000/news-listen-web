// Preferences のリードモデル（web-model-prefs）: ServerPreferencesRecord から画面が読む view を作る。
// 呼ぶたびに新しく作った値で、record とその入れ子と参照を共有せず、全深さで凍結する。
import type { ServerPreferencesRecord } from '@/lib/preferences/application/ports'
import { DEFAULT_WEEKLY_GOAL, type WeeklyGoal as WeeklyGoalChoice } from '@/lib/preferences/domain/settings'
import { normalizeDifficulty, type DifficultyLevel } from '@/lib/shared/difficulty'

export interface ServerPreferencesView {
  readonly defaultDifficulty: DifficultyLevel
  readonly weeklyGoal: WeeklyGoalChoice
  readonly digest: { readonly enabled: boolean; readonly articleCount: number }
}

function freezeDeep<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const v of Object.values(value)) freezeDeep(v)
    Object.freeze(value)
  }
  return value
}

export function toServerPreferencesView(record: ServerPreferencesRecord): ServerPreferencesView {
  return freezeDeep({
    defaultDifficulty: normalizeDifficulty(record.defaultDifficulty),
    weeklyGoal: record.weeklyGoal ?? DEFAULT_WEEKLY_GOAL,
    digest: { enabled: record.digest.enabled, articleCount: record.digest.articleCount },
  })
}
