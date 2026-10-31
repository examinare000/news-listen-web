import { PLAYBACK_SPEEDS } from '@/lib/playback/domain/session'
import type { PlaybackSpeed } from '@/lib/playback/domain/session'

/** 端末に保存する設定 1 件の宣言。値域の検査（normalize）と既定値、主体依存かどうかを持つ。 */
export interface SettingDescriptor<T> {
  readonly id: string
  readonly scope: 'local'
  readonly default: T
  readonly subjectScoped: boolean
  /** 値域外・型違いは default へ丸める全域関数。 */
  readonly normalize: (raw: unknown) => T
}

export type TimeFormat = 'absolute' | 'relative'
export type Theme = 'dark' | 'light'

export const WEEKLY_GOALS = Object.freeze([3, 5, 7, 10] as const)
export type WeeklyGoal = (typeof WEEKLY_GOALS)[number]

const NO_ACHIEVEMENTS: readonly string[] = Object.freeze([])

function describe<T>(
  id: string,
  subjectScoped: boolean,
  defaultValue: T,
  normalize: (raw: unknown) => T,
): SettingDescriptor<T> {
  return Object.freeze({ id, scope: 'local', default: defaultValue, subjectScoped, normalize })
}

export const defaultPlaybackSpeed: SettingDescriptor<PlaybackSpeed> = describe<PlaybackSpeed>(
  'defaultPlaybackSpeed',
  true,
  1.0,
  (raw) => PLAYBACK_SPEEDS.find((speed) => speed === raw) ?? 1.0,
)

export const seenAchievementIds: SettingDescriptor<readonly string[]> = describe<readonly string[]>(
  'seenAchievementIds',
  true,
  NO_ACHIEVEMENTS,
  (raw) => {
    if (!Array.isArray(raw)) return NO_ACHIEVEMENTS
    const items: unknown[] = raw
    if (!items.every((item): item is string => typeof item === 'string')) return NO_ACHIEVEMENTS
    return Object.freeze([...items] as string[])
  },
)

export const timeFormat: SettingDescriptor<TimeFormat> = describe<TimeFormat>(
  'timeFormat',
  false,
  'absolute',
  (raw) => (raw === 'absolute' || raw === 'relative' ? raw : 'absolute'),
)

export const theme: SettingDescriptor<Theme> = describe<Theme>(
  'theme',
  false,
  'dark',
  (raw) => (raw === 'dark' || raw === 'light' ? raw : 'dark'),
)

export const sfxEnabled: SettingDescriptor<boolean> = describe<boolean>(
  'sfxEnabled',
  false,
  true,
  (raw) => raw !== false,
)

export const volume: SettingDescriptor<number> = describe<number>(
  'volume',
  false,
  1.0,
  (raw) => (typeof raw === 'number' && raw >= 0 && raw <= 1 ? raw : 1.0),
)

/** 分類だけを宣言する。key と codec は lib/playback/infrastructure/localPositionStore.ts が持つ。 */
export const podcastPosition: SettingDescriptor<number> = describe<number>(
  'podcastPosition',
  true,
  0,
  (raw) => (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : 0),
)

export const SETTING_CLASSIFICATION: readonly SettingDescriptor<unknown>[] = Object.freeze([
  defaultPlaybackSpeed,
  seenAchievementIds,
  podcastPosition,
  timeFormat,
  theme,
  sfxEnabled,
  volume,
])
