// Preferences application の port。実装は infrastructure（preferencesGateway）が持つ（HTTP・DTO はここに現れない）。
// 型だけの module。
import type { SettingDescriptor, WeeklyGoal as WeeklyGoalChoice } from '@/lib/preferences/domain/settings'
import type { PlaybackSpeed } from '@/lib/playback/domain/session'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { DifficultyLevel } from '@/lib/shared/difficulty'
import type { Result } from '@/lib/shared/result'

/** gateway が DTO から写した材料。難易度は未知の値を含みうるので string、週の目標の欠落は null。 */
export interface ServerPreferencesRecord {
  readonly defaultDifficulty: string
  readonly weeklyGoal: WeeklyGoalChoice | null
  /** 値域は検査しない材料。正規化は application の readModels。 */
  readonly defaultPlaybackSpeed: number
  readonly digest: { readonly enabled: boolean; readonly articleCount: number }
}

/** 1 回の保存で送る変更は 1 field だけ。 */
export type PreferencesPatch =
  | { readonly kind: 'defaultDifficulty'; readonly value: DifficultyLevel }
  | { readonly kind: 'weeklyGoal'; readonly value: WeeklyGoalChoice }
  | { readonly kind: 'defaultPlaybackSpeed'; readonly value: PlaybackSpeed }

/** 端末設定への書込の port。実装は composition root が registry の get・set で渡す。 */
export interface LocalSettingsPort {
  get<T>(setting: SettingDescriptor<T>): T
  set<T>(setting: SettingDescriptor<T>, value: T): void
}

export interface PreferencesGateway {
  get(): Promise<Result<ServerPreferencesRecord, ApiFailure>>
  patch(patch: PreferencesPatch): Promise<Result<void, ApiFailure>>
}
