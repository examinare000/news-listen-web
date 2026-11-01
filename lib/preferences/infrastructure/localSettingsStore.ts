import {
  defaultPlaybackSpeed,
  seenAchievementIds,
  sfxEnabled,
  theme,
  timeFormat,
  volume,
} from '@/lib/preferences/domain/settings'
import type { SettingDescriptor } from '@/lib/preferences/domain/settings'
import type { KeyValueStore } from '@/lib/platform/keyValueStore'

export const KEY_DEFAULT_PLAYBACK_SPEED = 'default_playback_speed'
export const KEY_SEEN_ACHIEVEMENT_IDS = 'seen_achievement_ids'
export const KEY_TIME_FORMAT = 'time_format'
// app/layout.tsx の inline theme script が同じ key を生文字列で読むため、key 名と生値の形式を変えない。
export const KEY_THEME = 'theme'
export const KEY_SFX_ENABLED = 'sfx_enabled'
export const KEY_PLAYER_VOLUME = 'player_volume'

interface Binding<T> {
  readonly setting: SettingDescriptor<T>
  readonly key: string
  /** 保存文字列（欠落は null）を値域検査前の値へ戻す。壊れた値は undefined。 */
  readonly decode: (stored: string | null) => unknown
  /** 値域検査済みの値を保存文字列にする。 */
  readonly encode: (value: unknown) => string
}

function decodeJson(stored: string | null): unknown {
  if (stored === null) return undefined
  try {
    return JSON.parse(stored) as unknown
  } catch {
    return undefined
  }
}

const encodeJson = (value: unknown): string => JSON.stringify(value)

function jsonBinding<T>(setting: SettingDescriptor<T>, key: string): Binding<T> {
  return Object.freeze({ setting, key, decode: decodeJson, encode: encodeJson })
}

export const LOCAL_SETTING_BINDINGS = Object.freeze({
  defaultPlaybackSpeed: jsonBinding(defaultPlaybackSpeed, KEY_DEFAULT_PLAYBACK_SPEED),
  seenAchievementIds: jsonBinding(seenAchievementIds, KEY_SEEN_ACHIEVEMENT_IDS),
  timeFormat: jsonBinding(timeFormat, KEY_TIME_FORMAT),
  theme: Object.freeze<Binding<typeof theme.default>>({
    setting: theme,
    key: KEY_THEME,
    decode: (stored) => stored,
    encode: (value) => String(value),
  }),
  sfxEnabled: jsonBinding(sfxEnabled, KEY_SFX_ENABLED),
  volume: jsonBinding(volume, KEY_PLAYER_VOLUME),
})

const REGISTERED: ReadonlyMap<SettingDescriptor<unknown>, Binding<unknown>> = new Map(
  Object.values(LOCAL_SETTING_BINDINGS).map((binding): [SettingDescriptor<unknown>, Binding<unknown>] => [
    binding.setting,
    binding,
  ]),
)

export interface LocalSettingsStore {
  readonly read: <T>(setting: SettingDescriptor<T>) => T
  readonly write: <T>(setting: SettingDescriptor<T>, value: T) => T
  /** 主体依存の key だけを消す。既定値は書き戻さない（shared-dec-02）。 */
  readonly clearSubjectScoped: () => void
}

export function createLocalSettingsStore(kv: KeyValueStore): LocalSettingsStore {
  return {
    read(setting) {
      const binding = REGISTERED.get(setting)
      if (binding === undefined) return setting.default
      return setting.normalize(binding.decode(kv.get(binding.key)))
    },
    write(setting, value) {
      const binding = REGISTERED.get(setting)
      if (binding === undefined) return setting.default
      const normalized = setting.normalize(value)
      kv.set(binding.key, binding.encode(normalized))
      return normalized
    },
    clearSubjectScoped() {
      for (const binding of Object.values(LOCAL_SETTING_BINDINGS)) {
        if (binding.setting.subjectScoped) kv.remove(binding.key)
      }
    },
  }
}
