// Preferences application の port。実装は infrastructure（preferencesGateway）が持つ（HTTP・DTO はここに現れない）。
// 型だけの module。
import type { WeeklyGoal as WeeklyGoalChoice } from '@/lib/preferences/domain/settings'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { DifficultyLevel } from '@/lib/shared/difficulty'
import type { Result } from '@/lib/shared/result'

/** gateway が DTO から写した材料。難易度は未知の値を含みうるので string、週の目標の欠落は null。 */
export interface ServerPreferencesRecord {
  readonly defaultDifficulty: string
  readonly weeklyGoal: WeeklyGoalChoice | null
  readonly digest: { readonly enabled: boolean; readonly articleCount: number }
}

/** 1 回の保存で送る変更は 1 field だけ。 */
export type PreferencesPatch =
  | { readonly kind: 'defaultDifficulty'; readonly value: DifficultyLevel }
  | { readonly kind: 'weeklyGoal'; readonly value: WeeklyGoalChoice }

export interface PreferencesGateway {
  get(): Promise<Result<ServerPreferencesRecord, ApiFailure>>
  patch(patch: PreferencesPatch): Promise<Result<void, ApiFailure>>
}
